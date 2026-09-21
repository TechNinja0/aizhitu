import { chromium, expect, type Page } from "playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../apps/local-server/server.ts";
import {
  enterEditing,
  registerPage,
  waitForEditable,
} from "./account-fixtures.ts";

const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "zhitu-adaptive-sync-"),
);
const lanHost =
  Object.values(os.networkInterfaces())
    .flat()
    .find((n) => n?.family === "IPv4" && !n.internal)?.address || "127.0.0.1";
const server = await startServer({
  port: 0,
  shared: true,
  lanHost,
  dataDirectory: directory,
});
const browser = await chromium.launch({ channel: "chromium", headless: true });
const ca = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
});
const cb = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
});
const a = await ca.newPage(),
  b = await cb.newPage();
const errors: string[] = [],
  checks: string[] = [];
const pass = (text: string) => {
  checks.push(text);
  console.log("PASS", text);
};
for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
const scope = a.getByLabel("图稿分享范围");
const members = a.getByLabel("在线协同成员");
let stateRequests = 0,
  syncRequests = 0;
a.on("request", (req) => {
  if (req.url().endsWith("/collaboration/state")) stateRequests++;
  if (req.url().endsWith("/collaboration/sync")) syncRequests++;
});
const frame = (p: Page) => p.frames().find((f) => f !== p.mainFrame())!;
try {
  await fs.mkdir("artifacts", { recursive: true });
  for (const p of [a, b]) {
    await p.goto(server.publicOrigin);
    await registerPage(p, "测试成员");
  }
  const token = await a.evaluate(() => localStorage.getItem("zhitu-session"));
  const actor = server.workspace!.actor(token!)!;
  const doc = server.workspace!.create(
    "私有测试",
    await fs.readFile("fixtures/examples/flow.drawio", "utf8"),
    actor,
  );
  const url = server.publicOrigin + "/documents/" + doc.id;
  await a.goto(url);
  await waitForEditable(a);
  await expect(scope).toHaveText("仅自己可见");
  await expect(members).toHaveCount(0);
  await expect(a.locator(".shared-notice")).toContainText("已保存");
  await b.goto(url);
  await b.getByRole("heading", { name: "无法访问此图稿" }).waitFor();
  await expect(b.locator("iframe")).toHaveCount(0);
  await frame(a).evaluate(() => {
    (window as any).snapshotRequests = 0;
    window.addEventListener("message", (e) => {
      if (
        e.data?.channel === "diagram-workbench" &&
        e.data.method === "snapshot"
      )
        (window as any).snapshotRequests++;
    });
  });
  let before = stateRequests;
  await a.waitForTimeout(6200);
  assert.ok(
    stateRequests - before >= 1 && stateRequests - before <= 2,
    `单页空闲请求数 ${stateRequests - before}`,
  );
  assert.equal(syncRequests, 0);
  assert.equal(
    await frame(a).evaluate(() => (window as any).snapshotRequests),
    0,
  );
  assert.equal(server.workspace!.get(doc.id).revision, 1);
  await a.screenshot({ path: "artifacts/private-editing-status.png" });
  pass(
    "私有文件单页隐藏协同成员，拒绝未授权访问；空闲 6 秒仅 1–2 次检查，无快照序列化、写入或新增版本",
  );

  await a.getByLabel("图稿文件名").fill("空闲后立即修改");
  await expect
    .poll(() => server.workspace!.get(doc.id).name, { timeout: 3000 })
    .toBe("空闲后立即修改");
  pass("单页空闲降频后，真实修改仍在约一秒内自动保存");
  const twin = await ca.newPage();
  await twin.goto(url);
  await waitForEditable(twin);
  await a.bringToFront();
  await expect(members).toHaveText("测试成员（你）在 2 个页面编辑", {
    timeout: 8000,
  });
  await expect(members).toContainText("2 个页面编辑");
  before = stateRequests;
  await a.waitForTimeout(3200);
  assert.ok(
    stateRequests - before >= 2 && stateRequests - before <= 4,
    `前台多页请求数 ${stateRequests - before}，可见性 ${await a.evaluate(() => document.visibilityState)}`,
  );
  await twin.getByLabel("图稿文件名").fill("另一页修改");
  await expect(a.getByLabel("图稿文件名")).toHaveValue("另一页修改");
  pass("同账号第二页面自动发现，显示多页面编辑并恢复每秒同步");
  await twin.getByRole("link", { name: "← 文件库", exact: true }).click();
  await twin.close();
  await expect(members).toHaveCount(0);

  await a.getByRole("button", { name: "分享链接", exact: true }).click();
  const dialog = a.getByRole("dialog", { name: "分享图稿", exact: true });
  await dialog.getByRole("radio", { name: "所有成员", exact: true }).check();
  await dialog.getByRole("radio", { name: "可编辑", exact: true }).check();
  await dialog
    .getByRole("button", { name: "保存分享权限", exact: true })
    .click();
  await expect(scope).toHaveText("已分享");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(a.getByText("编辑中", { exact: true })).toBeVisible();
  await expect(members).toHaveCount(0);
  await b.goto(url);
  await enterEditing(b);
  await expect(members).toContainText("测试成员（你）", { timeout: 8000 });
  await expect(members).toContainText("、");
  await expect(members).toContainText("正在编辑");
  await a.screenshot({ path: "artifacts/shared-editing-status.png" });
  pass(
    "保存分享权限立即更新范围；已分享单人不显示人数，同名的两个账号仍统计为两人",
  );

  // Simulate the browser visibility event; real browser suspension is not a timing guarantee.
  await a.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  before = stateRequests;
  await a.waitForTimeout(11200);
  assert.ok(
    stateRequests - before >= 1 && stateRequests - before <= 2,
    `后台空闲请求数 ${stateRequests - before}`,
  );
  assert.equal(server.workspace!.collaboration.members(doc.id).length, 2);
  await a.getByLabel("图稿文件名").fill("后台仍需保存");
  await expect
    .poll(() => server.workspace!.get(doc.id).name, { timeout: 3000 })
    .toBe("后台仍需保存");
  await expect(a.locator(".shared-notice")).toContainText("已保存");
  const online = a.waitForRequest(
    (req) => req.url().endsWith("/collaboration/state"),
    { timeout: 1500 },
  );
  await a.evaluate(() => window.dispatchEvent(new Event("online")));
  await online;
  const wake = a.waitForRequest(
    (req) => req.url().endsWith("/collaboration/state"),
    { timeout: 1500 },
  );
  await a.evaluate(() => {
    delete (document as any).visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await wake;
  pass(
    "模拟后台空闲每 10 秒检查并维持会话；待保存修改优先，恢复网络或回到前台立即检查",
  );

  await b.getByRole("link", { name: "← 文件库", exact: true }).click();
  await expect(members).toHaveCount(0);
  await expect(a.getByText("编辑中", { exact: true })).toBeVisible();
  await a.getByRole("button", { name: "分享链接", exact: true }).click();
  await dialog.getByRole("radio", { name: "仅自己", exact: true }).check();
  await dialog
    .getByRole("button", { name: "保存分享权限", exact: true })
    .click();
  await expect(scope).toHaveText("仅自己可见");
  await expect(a.getByText("编辑中", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(a.locator(".shared-notice")).toContainText("已保存");
  pass("其他页面离开后自动回到单人状态，收回分享立即恢复私有显示");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "artifacts/collaboration-policy-report.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
  await fs.rm(directory, { recursive: true, force: true });
}
