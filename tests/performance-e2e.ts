import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { chromium } from "playwright";
import { startServer } from "../apps/local-server/server.ts";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-perf-e2e-"));
const server = await startServer({ port: 0, shared: true, dataDirectory: dir });
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const page = await browser.newPage();
const errors: string[] = [],
  checks: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const pass = (message: string) => {
  checks.push(message);
  console.log("PASS", message);
};
try {
  // Run the actual IndexedDB module against a legacy database in a fresh profile.
  await page.route("**/audit.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body>audit</body></html>",
    }),
  );
  const draftsModule = stripTypeScriptTypes(
    await fs.readFile("apps/workbench/src/drafts.ts", "utf8"),
  );
  const pollingModule = stripTypeScriptTypes(
    await fs.readFile("apps/workbench/src/polling.ts", "utf8"),
  );
  await page.route("**/audit-drafts.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: draftsModule }),
  );
  await page.route("**/audit-polling.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: pollingModule }),
  );
  await page.goto(server.origin + "/audit.html");
  const draftResults = await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("diagram-workbench", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drafts", { keyPath: "key" });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction("drafts", "readwrite");
        for (let i = 0; i < 25; i++)
          tx.objectStore("drafts").put({
            key: "old-" + i,
            documentId: "doc-" + i,
            session: "legacy",
            name: "草稿" + i,
            xml: "<xml>原稿" + i + "</xml>",
            previous: "previous-" + i,
            revision: 1,
            time: Date.now() - i * 1000,
          });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    const moduleUrl = "/audit-drafts.js",
      drafts = await import(moduleUrl);
    const migrated = await drafts.allDrafts();
    const recovered = await drafts.getDraft("old-0");
    let metadataOnly = migrated.every(
      (d: any) => !("xml" in d) && !("previous" in d),
    );
    for (let i = 0; i < 5; i++)
      await drafts.storeDraft({
        ...recovered,
        key: "session-" + i,
        documentId: "one-document",
        session: String(i),
        xml: "first-" + i,
        time: Date.now() + i,
      });
    const saved = await drafts.getDraft("session-4");
    await drafts.storeDraft({ ...saved, xml: "second", time: Date.now() + 10 });
    const next = await drafts.getDraft("session-4");
    const list = await drafts.allDrafts();
    await drafts.deleteDraft("session-4");
    const deleted = !(await drafts.allDrafts()).some(
      (d: any) => d.key === "session-4",
    );
    let missingRejected = false;
    try {
      await drafts.getDraft("session-4");
    } catch {
      missingRejected = true;
    }
    return {
      migrated: migrated.length,
      metadataOnly,
      recovered,
      sessions: list.filter((d: any) => d.documentId === "one-document").length,
      next,
      deleted,
      missingRejected,
    };
  });
  assert.equal(draftResults.migrated, 20);
  assert.equal(draftResults.metadataOnly, true);
  assert.equal(draftResults.recovered.xml, "<xml>原稿0</xml>");
  assert.equal(draftResults.recovered.previous, "previous-0");
  assert.equal(draftResults.sessions, 3);
  assert.equal(draftResults.next.xml, "second");
  assert.equal(draftResults.next.previous, "first-4");
  assert.equal(draftResults.deleted && draftResults.missingRejected, true);
  pass(
    "旧 IndexedDB 草稿升级无损恢复；列表只读元信息；总量/会话限额、前版与删除一致",
  );

  // Virtual time covers visibility wake-up, slow requests and disposal deterministically.
  await page.clock.install();
  await page.evaluate(async () => {
    const moduleUrl = "/audit-polling.js",
      { startPolling } = await import(moduleUrl);
    const w = window as any;
    w.calls = 0;
    w.stopPolling = startPolling(
      () => {
        w.calls++;
      },
      3000,
      { background: 30000 },
    );
  });
  assert.equal(await page.evaluate(() => (window as any).calls), 1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(29900);
  assert.equal(await page.evaluate(() => (window as any).calls), 1);
  await page.clock.runFor(100);
  assert.equal(await page.evaluate(() => (window as any).calls), 2);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await page.evaluate(() => (window as any).calls), 3);
  await page.evaluate(async () => {
    const w = window as any;
    w.stopPolling();
    w.calls = 0;
    const moduleUrl = "/audit-polling.js",
      { startPolling } = await import(moduleUrl);
    w.stopPolling = startPolling(() => {
      w.calls++;
      return new Promise<void>((r) => {
        w.release = r;
      });
    }, 1000);
  });
  await page.clock.runFor(10000);
  assert.equal(await page.evaluate(() => (window as any).calls), 1);
  await page.evaluate(() => {
    const w = window as any;
    w.stopPolling();
    w.release();
  });
  await page.clock.runFor(10000);
  assert.equal(await page.evaluate(() => (window as any).calls), 1);
  pass("后台文件库 30 秒轮询、回前台立即刷新；慢请求不叠加，卸载后停止");
  await page.close();

  const editor = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  editor.on("pageerror", (e) => errors.push(e.message));
  let aiRequests = 0;
  editor.on("request", (r) => {
    if (/\/api\/ai\/(settings|jobs)$/.test(r.url())) aiRequests++;
  });
  const doc = server.workspace!.create(
    "性能测试",
    await fs.readFile("fixtures/examples/flow.drawio", "utf8"),
    { id: "local-admin", name: "管理员", admin: true },
  );
  await editor.goto(server.origin + "/documents/" + doc.id);
  await editor
    .locator(".shared-notice")
    .filter({ hasText: "已保存" })
    .waitFor();
  await editor.waitForLoadState("networkidle");
  const initialRequests = aiRequests;
  await editor.waitForTimeout(16500);
  assert.equal(
    aiRequests,
    initialRequests,
    "closed idle AI panel must not refresh every 15 seconds",
  );
  await editor.getByRole("button", { name: "AI 会话", exact: true }).click();
  await editor.waitForLoadState("networkidle");
  assert.ok(
    aiRequests >= initialRequests + 2,
    "opening AI panel refreshes settings and jobs",
  );
  await editor
    .getByRole("button", { name: "关闭 AI 会话", exact: true })
    .click();
  pass("实际编辑页关闭 AI 面板 16.5 秒不轮询，重新打开立即获取最新状态");
  await editor.close();
  assert.deepEqual(errors, []);
  await fs.mkdir("artifacts/performance-optimization-20260922", {
    recursive: true,
  });
  await fs.writeFile(
    "artifacts/performance-optimization-20260922/browser-regressions.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
