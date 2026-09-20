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
  await p.getByLabel("用户名", { exact: true }).fill(name);
  assert.equal(
    await p.getByRole("textbox").count(),
    1,
    "入口仅一个用户名输入框",
  );
  assert.equal(await p.locator('input[type="password"]').count(), 0);
  await p.getByRole("button", { name: "进入工作区" }).click();
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
  await p.getByRole("button", { name: "保存副本", exact: true }).focus();
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
  pass("局域网 HTTP 访问、只填用户名进入、非安全上下文兼容");
  await a.getByLabel("新图稿名称").fill("空白共享图");
  await a.getByRole("button", { name: "新建共享图稿" }).click();
  await a.getByRole("button", { name: "创建空白画布", exact: true }).click();
  await a.getByText("0 个节点 · 0 条连线").waitFor();
  assert.match(a.url(), /\/documents\//);
  await a.getByRole("link", { name: "← 文件库" }).click();
  await a
    .getByLabel("导入共享图稿")
    .setInputFiles("fixtures/examples/architecture.drawio");
  await a.getByText("9 个节点 · 6 条连线").waitFor();
  const url = a.url();
  await open(b, url);
  await a.screenshot({ path: "artifacts/shared-readonly.png" });
  await assert.rejects(invoke(b, "action", { name: "delete" }), /只读/);
  pass("文件新建、导入、独立地址、默认只读与画布命令保护");
  await a.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await a.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  await b.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await b.getByText("浏览器甲 正在编辑，请稍后重试", { exact: true }).waitFor();
  await b.getByRole("button", { name: "知道了", exact: true }).click();
  const twin = await aContext.newPage();
  twin.on("dialog", (d) => void d.accept());
  await open(twin, url);
  await twin.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await twin
    .getByText("浏览器甲 正在编辑，请稍后重试", { exact: true })
    .waitFor();
  await twin.close();
  pass("不同浏览器身份和同一身份不同标签页均不能同时取得编辑锁");
  await edit(a, "订单服务", "团队订单中心");
  await waitLabel(b, "团队订单中心");
  await a.getByLabel("图稿文件名").fill("团队架构图");
  await b.getByLabel("图稿文件名").filter({ visible: true }).waitFor();
  await b.waitForFunction(
    () =>
      (document.querySelector('[aria-label="图稿文件名"]') as HTMLInputElement)
        ?.value === "团队架构图",
  );
  await b.reload();
  await b.getByText("9 个节点 · 6 条连线").waitFor();
  await waitLabel(b, "团队订单中心");
  pass("真实节点编辑与重命名自动保存、其他浏览器自动更新、刷新恢复同一文档");
  await a.getByRole("button", { name: "结束编辑", exact: true }).click();
  await a.getByRole("button", { name: "获取编辑权", exact: true }).waitFor();
  await b.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await b.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  await edit(b, "团队订单中心", "乙已保存");
  await waitLabel(a, "乙已保存");
  await b.getByRole("button", { name: "服务器版本", exact: true }).click();
  const dialog = b.getByRole("dialog", { name: "服务器版本" });
  await dialog
    .getByRole("button", { name: "恢复此版本", exact: true })
    .last()
    .click();
  await waitLabel(a, "订单服务");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  pass("主动交接编辑权、反向同步、服务器历史版本恢复");
  await b.getByRole("button", { name: "结束编辑", exact: true }).click();
  await b.getByRole("button", { name: "获取编辑权", exact: true }).waitFor();
  await a.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await a.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  await aContext.setOffline(true);
  await edit(a, "订单服务", "甲的离线修改");
  await a
    .getByRole("button", { name: "获取编辑权", exact: true })
    .waitFor({ timeout: 15000 });
  await b.waitForTimeout(7000);
  await b.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await b.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  await edit(b, "订单服务", "乙接管后保存");
  await b.getByText(/已保存到服务器/).waitFor();
  await aContext.setOffline(false);
  await a.waitForTimeout(3000);
  await waitLabel(a, "甲的离线修改");
  await b.getByRole("button", { name: "结束编辑", exact: true }).click();
  await b.getByRole("button", { name: "获取编辑权", exact: true }).waitFor();
  await a.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await a.getByText(/服务器已有新版本。请先下载当前副本/).waitFor();
  await a.getByRole("button", { name: "知道了", exact: true }).click();
  const download = a.waitForEvent("download");
  await a.getByRole("button", { name: "保存副本", exact: true }).click();
  await (await download).saveAs("artifacts/shared-offline-recovery.drawio");
  assert.match(
    await fs.readFile("artifacts/shared-offline-recovery.drawio", "utf8"),
    /甲的离线修改/,
  );
  await a.getByRole("button", { name: "加载最新版本", exact: true }).click();
  await waitLabel(a, "乙接管后保存");
  pass("断线自动只读、锁超时接管、离线修改保留、拒绝旧版本覆盖、下载恢复副本");
  await a.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await a.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  await a.getByRole("button", { name: "移入回收站", exact: true }).click();
  await a.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  await b.getByText(/文档不存在或已移入回收站/).waitFor();
  await a.getByRole("button", { name: "回收站", exact: true }).click();
  await a.getByRole("button", { name: "恢复文件", exact: true }).click();
  await a.getByRole("button", { name: "全部文件", exact: true }).click();
  await a.getByRole("link", { name: "打开图稿 →" }).first().waitFor();
  await a.screenshot({ path: "artifacts/shared-library.png", fullPage: true });
  await b.getByRole("button", { name: "加载最新版本", exact: true }).click();
  await waitLabel(b, "乙接管后保存");
  pass("创建者删除、其他页面收到删除状态、回收站恢复后继续访问");
  const pdf = b.waitForEvent("download", { timeout: 40000 });
  await b.getByRole("button", { name: "导出", exact: true }).click();
  await b.getByRole("button", { name: "PDF 单页完整图稿" }).click();
  await b.getByRole("button", { name: "生成 PDF" }).click();
  await (await pdf).saveAs("artifacts/shared-readonly-export.pdf");
  assert.ok(
    (await fs.stat("artifacts/shared-readonly-export.pdf")).size > 1000,
  );
  pass("只读成员仍可导出真实 PDF");
  await b.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await b.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  await frame(b).getByText("乙接管后保存", { exact: true }).dblclick();
  const typing = frame(b).locator(".mxCellEditor");
  await typing.fill("仍在输入中");
  await b.waitForTimeout(3000);
  assert.equal(await typing.isVisible(), true, "自动保存不打断正在输入的文字");
  await b.getByRole("button", { name: "结束编辑", exact: true }).click();
  await b.getByRole("button", { name: "获取编辑权", exact: true }).waitFor();
  await open(a, url);
  await waitLabel(a, "仍在输入中");
  pass("持续文字输入不被自动保存打断，结束编辑提交尚未退出的文字编辑");
  await b.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await b.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  await b.close();
  await a.waitForTimeout(700);
  await a.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await a.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  pass("正常关闭标签页即时释放编辑权，另一人可接手");
  pass("访问者时钟快 5 分钟不影响编辑锁续约和超时判断");
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
