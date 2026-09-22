import { chromium, type Page } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../apps/local-server/server.ts";
import { AIService } from "../packages/ai-service/index.ts";
import {
  enterEditing,
  waitForEditable,
  registerPage,
} from "./account-fixtures.ts";
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "zhitu-collaboration-browser-"),
);
const lanHost =
  Object.values(os.networkInterfaces())
    .flat()
    .find((n) => n?.family === "IPv4" && !n.internal)?.address || "127.0.0.1";
// Exercise real shared authorization and candidate application without calling a model.
const ai = await new AIService(directory, async (_file, args, options) => {
  if (args[0] === "--version") return "test-cli";
  const xml = options
    .input!.split("当前完整图稿：\n")[1]
    .split("\n用户需求：")[0];
  await fs.writeFile(
    args[args.indexOf("-o") + 1],
    xml.replace('value="资料校验"', 'value="AI校验"'),
  );
  return "{}";
}).init();
await ai.save({
  defaultProvider: "codex",
  providers: {
    codex: { path: process.execPath, model: "" },
    qoder: { path: process.execPath, model: "" },
  },
});
const server = await startServer({
  port: 0,
  shared: true,
  lanHost,
  dataDirectory: directory,
  aiService: ai,
});
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const contexts = await Promise.all([
  browser.newContext({ viewport: { width: 1600, height: 1000 } }),
  browser.newContext({ viewport: { width: 1600, height: 1000 } }),
]);
const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
const legacyRequests: string[] = [];
const errors: string[] = [],
  checks: string[] = [];
for (const p of [a, b]) {
  p.on("request", (r) => {
    if (
      /\/api\/documents\/[^/]+\/(lock|heartbeat|release)$/.test(
        new URL(r.url()).pathname,
      )
    )
      legacyRequests.push(r.url());
  });
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => void d.accept());
}
const pass = (s: string) => {
  checks.push(s);
  console.log("PASS", s);
};
const frame = (p: Page) => p.frames().find((f) => f !== p.mainFrame())!;
const invoke = (p: Page, method: string, args: any = {}) =>
  frame(p).evaluate(
    ({ method, args }) => (window as any).workbench.invoke(method, args),
    { method, args },
  );
const api = (p: Page, url: string, body?: any, method?: string) =>
  p.evaluate(
    async ({ url, body, method }) => {
      const response = await fetch("/api/" + url, {
        method: method || (body ? "POST" : "GET"),
        headers: {
          Authorization:
            "Bearer " +
            (localStorage.getItem("zhitu-session") ||
              sessionStorage.getItem("zhitu-session")),
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json();
      if (!response.ok) throw Error(JSON.stringify(result));
      return result;
    },
    { url, body, method },
  );
async function edit(p: Page, from: string, to: string) {
  await frame(p).getByText(from, { exact: true }).dblclick();
  const editor = frame(p).locator(".mxCellEditor");
  await editor.fill(to);
  await editor.press("ControlOrMeta+Enter");
  await p.getByRole("button", { name: "下载副本", exact: true }).focus();
}
const label = (p: Page, name: string) =>
  frame(p).getByText(name, { exact: true }).waitFor({ timeout: 25000 });
const open = async (p: Page, url: string) => {
  await p.goto(url);
  await p.getByText("5 个节点 · 5 条连线").waitFor();
  await enterEditing(p);
};
try {
  await fs.mkdir("artifacts", { recursive: true });
  for (const [p, name] of [
    [a, "协同甲"],
    [b, "协同乙"],
  ] as const) {
    await p.goto(server.publicOrigin);
    await registerPage(p, name);
  }
  const xml = await fs.readFile("fixtures/examples/flow.drawio", "utf8");
  const d = await api(a, "documents", { name: "多人方案", xml });
  await api(
    a,
    `documents/${d.id}/sharing`,
    { visibility: "everyone", role: "edit", recipients: [], accessRevision: 1 },
    "PUT",
  );
  const url = server.publicOrigin + "/documents/" + d.id;
  await open(a, url);
  await open(b, url);
  await a
    .getByLabel("在线协同成员")
    .filter({ hasText: "正在编辑" })
    .waitFor();
  assert.match(
    (await a.getByLabel("在线协同成员").getAttribute("title"))!,
    /协同乙/,
  );
  pass("两个独立账号同时加入同一图稿，显示在线成员");
  await a.getByRole("button", { name: "AI 会话", exact: true }).click();
  const chat = a.getByRole("complementary", { name: "AI 会话" });
  await chat.getByLabel("AI 绘图要求").fill("将资料校验改为 AI校验");
  await chat.getByRole("button", { name: "发送给 AI" }).click();
  await chat.getByText(/项变化 · 待应用/).waitFor();
  await chat.getByRole("button", { name: "预览候选", exact: true }).click();
  await chat.getByAltText("AI 生成候选预览").waitFor();
  await chat.getByRole("button", { name: "关闭候选预览", exact: true }).click();
  await chat.getByRole("button", { name: "应用到画布", exact: true }).click();
  await label(b, "AI校验");
  await invoke(a, "action", { name: "undo" });
  await label(b, "资料校验");
  await a.getByRole("button", { name: "AI 会话", exact: true }).click();
  pass(
    "普通成员自动携带协同会话调用 AI，候选应用及本人撤销同步到另一页面（测试 CLI）",
  );
  // Hold outgoing writes so both edits originate from exactly the same baseline.
  let allow = false;
  for (const p of [a, b])
    await p.route("**/collaboration/sync", async (route) => {
      while (!allow) await new Promise((r) => setTimeout(r, 30));
      await route.continue();
    });
  await edit(a, "提交申请", "甲提交");
  await edit(b, "资料校验", "乙校验");
  allow = true;
  await label(a, "乙校验");
  await label(b, "甲提交");
  await a.unroute("**/collaboration/sync");
  await b.unroute("**/collaboration/sync");
  pass("同一基线并发编辑不同对象，两端与服务器保留双方修改");
  await invoke(a, "action", { name: "undo" });
  await label(b, "提交申请");
  await label(a, "乙校验");
  await invoke(a, "action", { name: "redo" });
  await label(b, "甲提交");
  await label(a, "乙校验");
  pass("撤销与重做仅作用于本人修改，保留其他成员内容");
  await invoke(a, "focus", { ids: ["start"] });
  await invoke(a, "zoom", { action: "in" });
  const viewport = await invoke(a, "snapshot");
  await edit(b, "乙校验", "乙再次校验");
  await label(a, "乙再次校验");
  const retained = await invoke(a, "snapshot");
  assert.equal(retained.zoom, viewport.zoom);
  assert.deepEqual(retained.selection, ["start"]);
  pass("远端同步保留画布缩放和选区");
  // Keep an accepted response in flight while the same user makes a newer local edit.
  let releaseResponse = false,
    accepted = false;
  await a.route("**/collaboration/sync", async (route) => {
    const response = await route.fetch();
    accepted = true;
    const deadline = Date.now() + 20_000;
    while (!releaseResponse && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 30));
    await route.fulfill({ response });
  });
  await edit(a, "甲提交", "第一段修改");
  while (!accepted) await new Promise((r) => setTimeout(r, 30));
  await edit(a, "第一段修改", "请求中追加修改");
  releaseResponse = true;
  await label(b, "请求中追加修改");
  await label(a, "请求中追加修改");
  await a.unroute("**/collaboration/sync");
  pass("请求在途时继续修改同一对象，确认响应不会抹掉新输入");
  const beforeDrops = (await api(a, `documents/${d.id}/versions`)).length;
  // An acknowledged request whose response is lost must not overwrite a later edit on retry.
  let dropped = false;
  await a.route("**/collaboration/sync", async (route) => {
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await edit(a, "请求中追加修改", "响应丢失的修改");
  await label(b, "响应丢失的修改");
  await edit(b, "乙再次校验", "响应丢失期间乙编辑");
  await label(a, "响应丢失期间乙编辑");
  await a.unroute("**/collaboration/sync");
  assert.equal(
    (await api(a, `documents/${d.id}/versions`)).length,
    beforeDrops + 2,
  );
  pass("服务器提交后丢失响应，自动重试幂等且保留他人后续修改");
  await contexts[0].setOffline(true);
  await edit(a, "响应丢失的修改", "甲离线修改");
  await edit(b, "响应丢失期间乙编辑", "乙在线修改");
  await a.getByText(/连接中断/).waitFor();
  await contexts[0].setOffline(false);
  await label(a, "乙在线修改");
  await label(b, "甲离线修改");
  pass("断线期间继续编辑，重连后自动合并两端修改");
  await frame(a).getByText("甲离线修改", { exact: true }).dblclick();
  await frame(a).locator(".mxCellEditor").fill("正在输入的文字");
  await edit(b, "乙在线修改", "乙在甲输入期间编辑");
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(await frame(a).locator(".mxCellEditor").isVisible(), true);
  await frame(a).locator(".mxCellEditor").press("ControlOrMeta+Enter");
  await label(a, "乙在甲输入期间编辑");
  await label(b, "正在输入的文字");
  pass("远端同步不打断文字输入，提交后补齐远端更新");
  let releaseA = false,
    releaseB = false,
    committedA = false;
  await a.route("**/collaboration/sync", async (route) => {
    const deadline = Date.now() + 20_000;
    while (!releaseA && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 30));
    const response = await route.fetch();
    committedA = true;
    await route.fulfill({ response });
  });
  await b.route("**/collaboration/sync", async (route) => {
    const deadline = Date.now() + 20_000;
    while (!releaseB && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 30));
    await route.continue();
  });
  await edit(a, "正在输入的文字", "甲同时改标签");
  await edit(b, "正在输入的文字", "乙同时改标签");
  releaseA = true;
  const deadline = Date.now() + 20_000;
  while (!committedA && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 30));
  assert.ok(committedA);
  releaseB = true;
  await label(a, "乙同时改标签");
  await label(b, "乙同时改标签");
  await a.unroute("**/collaboration/sync");
  await b.unroute("**/collaboration/sync");
  pass("双端同时修改同一文字属性，按服务端后提交顺序收敛");
  await Promise.all([
    invoke(a, "focus", { ids: ["fix"] }),
    invoke(b, "focus", { ids: ["approved"] }),
  ]);
  await Promise.all([
    invoke(a, "action", { name: "duplicate" }),
    invoke(b, "action", { name: "duplicate" }),
  ]);
  await a.getByText("7 个节点 · 5 条连线").waitFor();
  await b.getByText("7 个节点 · 5 条连线").waitFor();
  const added = (await invoke(a, "snapshot")).xml.match(/id="co-[^"]+"/g) || [];
  assert.equal(added.length, 2);
  assert.equal(new Set(added).size, 2);
  pass("两个页面并发新增对象使用不同 ID，两端保留所有新对象");
  await a.screenshot({ path: "artifacts/collaboration.png", fullPage: true });
  await a.getByRole("button", { name: "分享链接", exact: true }).click();
  const sharing = a.getByRole("dialog", { name: "分享图稿", exact: true });
  await sharing.getByRole("radio", { name: "仅自己", exact: true }).check();
  await sharing
    .getByRole("button", { name: "保存分享权限", exact: true })
    .click();
  await sharing.getByRole("button", { name: "关闭", exact: true }).click();
  await b.getByText("同步已暂停", { exact: true }).waitFor();
  const readOnlyXml = (await invoke(b, "snapshot")).xml;
  await assert.rejects(invoke(b, "action", { name: "delete" }), /当前仅查看/);
  assert.equal((await invoke(b, "snapshot")).xml, readOnlyXml);
  pass("所有者收回分享权限后，被撤权端暂停同步且画布只读");
  await a.getByRole("link", { name: "← 文件库", exact: true }).click();
  await a.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  await a.goto(url);
  await waitForEditable(a);
  await label(a, "乙同时改标签");
  assert.equal(
    await a
      .getByRole("button", {
        name: /获取编辑权|结束编辑|加入多人协同|退出协同/,
      })
      .count(),
    0,
  );
  pass("返回文件库后重新打开自动接入协同，无旧编辑锁按钮");
  assert.deepEqual(legacyRequests, [], "所有协同操作不再请求旧独占锁接口");
  assert.deepEqual(errors, []);
  pass("浏览器无未捕获 JavaScript 异常");
  await fs.writeFile(
    "artifacts/collaboration-e2e-report.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (e) {
  console.error("BROWSER ERRORS", errors);
  console.error(
    "A",
    await a
      .locator("body")
      .innerText()
      .catch(() => ""),
  );
  console.error(
    "B",
    await b
      .locator("body")
      .innerText()
      .catch(() => ""),
  );
  throw e;
} finally {
  await browser.close();
  await server.close();
  await fs.rm(directory, { recursive: true, force: true });
}
