import {
  enterEditing,
  waitForEditable,
  registerPage,
} from "./account-fixtures.ts";
import { chromium, type Page } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../apps/local-server/server.ts";

const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "zhitu-shared-browser-"),
);
const lanHost =
  Object.values(os.networkInterfaces())
    .flat()
    .find((n) => n?.family === "IPv4" && !n.internal)?.address || "127.0.0.1";
const server = await startServer({
  port: 0,
  workbenchDirectory: process.env.ZHITU_TEST_WORKBENCH,
  shared: true,
  lanHost,
  dataDirectory: directory,
  leaseMs: 6000,
});
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const aContext = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
  }),
  bContext = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
// Simulate a client clock five minutes ahead of the server.
await bContext.addInitScript(() => {
  const now = Date.now;
  Date.now = () => now() + 5 * 60 * 1000;
});
const a = await aContext.newPage(),
  b = await bContext.newPage();
const checks: string[] = [],
  errors: string[] = [];
for (const p of [a, b]) {
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => void d.accept());
}
const pass = (s: string) => {
  checks.push(s);
  console.log("PASS", s);
};
async function login(p: Page, name: string) {
  await p.goto(server.publicOrigin);
  await p.waitForLoadState("networkidle");
  await registerPage(p, name);
  await p.getByRole("heading", { name: "文件库", exact: true }).waitFor();
}
const frame = (p: Page) => p.frames().find((f) => f !== p.mainFrame())!;
const invoke = (p: Page, method: string, args: any = {}) =>
  frame(p).evaluate(
    ({ method, args }) => (window as any).workbench.invoke(method, args),
    { method, args },
  );
async function open(p: Page, url: string) {
  await p.goto(url);
  await p.getByText("9 个节点 · 6 条连线").waitFor();
}
async function edit(p: Page, oldText: string, newText: string) {
  await frame(p).getByText(oldText, { exact: true }).dblclick();
  const editor = frame(p).locator(".mxCellEditor");
  await editor.waitFor();
  await editor.fill(newText);
  await editor.press("ControlOrMeta+Enter");
  await p.getByRole("button", { name: "下载副本", exact: true }).focus();
}
async function waitLabel(p: Page, label: string) {
  await frame(p).getByText(label, { exact: true }).waitFor({ timeout: 20000 });
}
try {
  await login(a, "浏览器甲");
  await login(b, "浏览器乙");
  const identity = await a.evaluate(() =>
    localStorage.getItem("zhitu-session"),
  );
  await a.reload();
  await a.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  assert.equal(
    await a.evaluate(() => localStorage.getItem("zhitu-session")),
    identity,
  );
  await a.route("**/api/session", (route) => route.abort());
  await a.reload();
  await a.getByRole("heading", { name: "暂时无法连接工作区" }).waitFor();
  assert.equal(
    await a.evaluate(() => localStorage.getItem("zhitu-session")),
    identity,
    "网络失败不会清除记住的身份",
  );
  await a.unroute("**/api/session");
  await a.getByRole("button", { name: "重新连接" }).click();
  await a.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  const local = await browser.newPage();
  await local.goto(server.origin);
  await local.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  assert.match(await local.locator("header").innerText(), /本机管理员/);
  await local.close();
  if (lanHost !== "127.0.0.1") {
    const html = await (await fetch(server.publicOrigin)).text();
    assert.equal(
      JSON.parse(html.match(/window\.__BOOT__=(\{.*?\})<\/script>/)![1]).token,
      "",
      "局域网页面没有管理员凭证",
    );
    const forged = await (
      await fetch(server.publicOrigin, {
        headers: { Host: new URL(server.origin).host },
      })
    ).text();
    assert.equal(
      JSON.parse(forged.match(/window\.__BOOT__=(\{.*?\})<\/script>/)![1])
        .token,
      "",
      "伪造本机 Host 不能获得管理凭证",
    );
  }
  pass("刷新记住身份、断网保留身份、本机管理和局域网成员权限分离");

  if (lanHost !== "127.0.0.1")
    assert.equal(await a.evaluate(() => isSecureContext), false);
  pass("局域网 HTTP 访问、固定账号注册与记住登录、非安全上下文兼容");
  await a.getByRole("button", { name: "新建图稿" }).click();
  await a.getByLabel("新建图稿名称", { exact: true }).fill("空白共享图");
  await a.getByRole("button", { name: "创建空白画布", exact: true }).click();
  await a.getByText("0 个节点 · 0 条连线").waitFor();
  assert.match(a.url(), /\/new\//);
  await a.getByRole("link", { name: "← 文件库" }).click();
  await a
    .getByLabel("导入图稿")
    .setInputFiles("fixtures/examples/architecture.drawio");
  await a.getByText("9 个节点 · 6 条连线").waitFor();
  await a.getByRole("button", { name: "分享链接", exact: true }).waitFor();
  await a.getByRole("button", { name: "分享链接", exact: true }).click();
  const permissions = a.getByRole("dialog", { name: "分享图稿", exact: true });
  await permissions
    .getByRole("radio", { name: "所有成员", exact: true })
    .check();
  await a
    .getByRole("dialog")
    .getByRole("radio", { name: "可编辑", exact: true })
    .check();
  await permissions
    .getByRole("button", { name: "保存分享权限", exact: true })
    .click();
  await permissions
    .getByText("分享权限已保存，可以复制链接发送给已授权成员", { exact: true })
    .waitFor();
  await permissions.getByRole("button", { name: "关闭", exact: true }).click();

  const url = a.url();
  const id = url.split("/").pop()!;
  await waitForEditable(a);
  const initialRevision = server.workspace!.get(id).revision;
  await open(b, url);
  await enterEditing(b);
  const twin = await aContext.newPage();
  twin.on("dialog", (d) => void d.accept());
  await open(twin, url);
  await waitForEditable(twin);
  await a
    .getByLabel("在线协同成员")
    .filter({ hasText: "正在编辑" })
    .waitFor();
  assert.equal(
    server.workspace!.get(id).revision,
    initialRevision,
    "打开但不修改不产生版本",
  );
  assert.equal(server.workspace!.lock(id), undefined);
  await twin.getByRole("link", { name: "← 文件库", exact: true }).click();
  await twin.close();
  pass(
    "新建未修改不保存、导入后自动协同；多账号及同账号多页面同时可编辑，打开不新增版本",
  );
  await edit(a, "订单服务", "团队订单中心");
  await waitLabel(b, "团队订单中心");
  await a.getByLabel("图稿文件名").fill("团队架构图");
  await a.getByLabel("图稿文件名").evaluate((input: HTMLInputElement) => {
    input.setSelectionRange(2, 4, "backward");
  });
  await b.getByLabel("图稿文件名").filter({ visible: true }).waitFor();
  await b.waitForFunction(
    () =>
      (document.querySelector('[aria-label="图稿文件名"]') as HTMLInputElement)
        ?.value === "团队架构图",
  );
  assert.deepEqual(
    await a.getByLabel("图稿文件名").evaluate((input: HTMLInputElement) => ({
      focused: document.activeElement === input,
      start: input.selectionStart,
      end: input.selectionEnd,
      direction: input.selectionDirection,
    })),
    { focused: true, start: 2, end: 4, direction: "backward" },
    "标题自动保存后仍保留焦点、选区和选区方向",
  );
  // Simulate composition events across another automatic save; text must still
  // reach the title without refocusing it or selecting the locator again.
  await a.keyboard.press("End");
  await a
    .getByLabel("图稿文件名")
    .dispatchEvent("compositionstart", { data: "" });
  await a.keyboard.insertText("·中文");
  await b.waitForFunction(
    () =>
      (document.querySelector('[aria-label="图稿文件名"]') as HTMLInputElement)
        ?.value === "团队架构图·中文",
  );
  assert.equal(
    await a
      .getByLabel("图稿文件名")
      .evaluate((input) => document.activeElement === input),
    true,
    "模拟中文组词期间的自动保存不抢焦点",
  );
  await a
    .getByLabel("图稿文件名")
    .dispatchEvent("compositionend", { data: "中文" });
  await a.keyboard.insertText("输入");
  assert.equal(
    await a.getByLabel("图稿文件名").inputValue(),
    "团队架构图·中文输入",
  );
  pass("标题跨自动保存保留焦点和选区，模拟中文组词后可继续输入");
  await b.reload();
  await enterEditing(b);
  await b.getByText("9 个节点 · 6 条连线").waitFor();
  await waitLabel(b, "团队订单中心");
  pass("真实节点编辑与重命名自动保存、其他浏览器自动更新、刷新恢复同一文档");
  await edit(b, "团队订单中心", "乙已保存");
  await waitLabel(a, "乙已保存");
  await b.getByRole("button", { name: "服务器版本", exact: true }).click();
  const dialog = b.getByRole("dialog", { name: "服务器版本" });
  await dialog
    .getByRole("button", { name: "恢复此版本", exact: true })
    .last()
    .click();
  await b.getByText(/其他页面正在协同编辑/).waitFor();
  await b.getByRole("button", { name: "知道了", exact: true }).click();
  await waitLabel(a, "乙已保存");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await a.getByRole("button", { name: "移入回收站", exact: true }).click();
  await a.getByText(/其他页面正在协同编辑/).waitFor();
  await a.getByRole("button", { name: "知道了", exact: true }).click();
  assert.equal(server.workspace!.get(id).deleted, 0);
  await b.getByRole("link", { name: "← 文件库", exact: true }).click();
  await b.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  await a.getByRole("button", { name: "服务器版本", exact: true }).click();
  const history = a.getByRole("dialog", { name: "服务器版本" });
  await history
    .getByRole("button", { name: "恢复此版本", exact: true })
    .last()
    .click();
  await waitLabel(a, "订单服务");
  await history.getByRole("button", { name: "关闭", exact: true }).click();
  assert.equal(await a.getByLabel("图稿文件名").isEnabled(), true);
  await invoke(a, "action", { name: "undo" });
  await waitLabel(a, "订单服务");
  pass(
    "其他页面在线时服务器拒绝恢复和删除；只剩当前页面时可恢复历史并清空旧撤销记录",
  );

  // A failed final synchronization must never navigate away from local edits.
  await a.route("**/collaboration/sync", (route) => route.abort());
  await edit(a, "订单服务", "返回前的修改");
  await a.getByRole("link", { name: "← 文件库", exact: true }).click();
  await a.getByText(/连接中断/).waitFor();
  assert.equal(a.url(), url);
  await waitLabel(a, "返回前的修改");
  const download = a.waitForEvent("download");
  await a.getByRole("button", { name: "下载副本", exact: true }).click();
  await (await download).saveAs("artifacts/shared-offline-recovery.drawio");
  assert.match(
    await fs.readFile("artifacts/shared-offline-recovery.drawio", "utf8"),
    /返回前的修改/,
  );
  await a.unroute("**/collaboration/sync");
  let accepted = false,
    release = false;
  await a.route("**/collaboration/sync", async (route) => {
    const response = await route.fetch();
    accepted = true;
    const deadline = Date.now() + 15000;
    while (!release && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 30));
    await route.fulfill({ response });
  });
  await a.getByRole("link", { name: "← 文件库", exact: true }).click();
  const deadline = Date.now() + 10000;
  while (!accepted && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 30));
  assert.ok(accepted);
  assert.equal(a.url(), url, "同步响应在途时等待确认");
  assert.equal(await a.getByLabel("图稿文件名").isDisabled(), true);
  release = true;
  await a.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  await a.unroute("**/collaboration/sync");
  assert.match(server.workspace!.get(id).xml, /返回前的修改/);
  pass("返回前冻结并等待最后同步；失败保留页面和可下载副本，重试成功后才离开");
  let joinCalls = 0;
  await a.route("**/collaboration/join", async (route) => {
    if (++joinCalls === 1) await route.abort();
    else await route.continue();
  });
  await a.goto(url);
  await a.getByText(/正在自动重试连接/).waitFor();
  assert.equal(await a.getByLabel("图稿文件名").isDisabled(), true);
  await waitForEditable(a);
  assert.ok(joinCalls >= 2);
  await a.unroute("**/collaboration/join");
  pass("首次连接失败保持只读并自动重试，成功后自动可编辑");

  await a.getByRole("button", { name: "移入回收站", exact: true }).click();
  await a.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  await a.getByRole("button", { name: "回收站", exact: true }).click();
  await a.getByRole("button", { name: "恢复文件", exact: true }).click();
  await a.getByRole("button", { name: "全部文件", exact: true }).click();
  await a
    .locator(".shared-row:not(.shared-table-head) a[href]")
    .first()
    .waitFor();
  await a.screenshot({ path: "artifacts/shared-library.png", fullPage: true });
  await open(b, url);
  await enterEditing(b);
  await waitLabel(b, "返回前的修改");
  pass("单人在线时创建者删除成功；回收站恢复后授权成员自动协同");
  const pdf = b.waitForEvent("download", { timeout: 40000 });
  await b.getByRole("button", { name: "导出", exact: true }).click();
  await b.getByRole("button", { name: "PDF 单页完整图稿" }).click();
  await b.getByRole("button", { name: "生成 PDF" }).click();
  await (await pdf).saveAs("artifacts/shared-collaboration-export.pdf");
  assert.ok(
    (await fs.stat("artifacts/shared-collaboration-export.pdf")).size > 1000,
  );
  pass("协同成员可导出真实 PDF");
  await frame(b).getByText("返回前的修改", { exact: true }).dblclick();
  const typing = frame(b).locator(".mxCellEditor");
  await typing.fill("仍在输入中");
  await b.waitForTimeout(2200);
  assert.equal(await typing.isVisible(), true);
  await b.getByRole("link", { name: "← 文件库", exact: true }).click();
  await b.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  await open(a, url);
  await waitLabel(a, "仍在输入中");
  pass("持续文字输入不被同步打断，返回文件库提交尚未退出的文字编辑");
  await open(b, url);
  await enterEditing(b);
  await b.close();
  await a.getByLabel("在线协同成员").waitFor({ state: "hidden" });
  pass("正常关闭页面释放协同会话；客户端时钟快 5 分钟不影响服务端会话续约");
  assert.deepEqual(errors, []);
  pass("浏览器无未捕获 JavaScript 异常");
  await fs.writeFile(
    "artifacts/shared-e2e-report.json",
    JSON.stringify({ origin: server.publicOrigin, checks, errors }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
  await fs.rm(directory, { recursive: true, force: true });
}
