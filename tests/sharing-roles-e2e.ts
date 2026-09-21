import { chromium, expect, type Page } from "playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../apps/local-server/server.ts";
import {
  registerPage,
  waitForEditable,
  enterEditing,
} from "./account-fixtures.ts";
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-roles-ui-"));
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
  }),
  cb = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const a = await ca.newPage(),
  b = await cb.newPage();
const errors: string[] = [],
  checks: string[] = [];
for (const p of [a, b]) {
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => void d.accept());
}
const pass = (s: string) => {
  checks.push(s);
  console.log("PASS", s);
};
const toggle = (p: Page) =>
  p.getByRole("button", { name: "编辑", exact: true });
const frame = (p: Page) => p.frames().find((f) => f !== p.mainFrame())!;
async function changeCell(p: Page, from: string, to: string) {
  await frame(p).getByText(from, { exact: true }).dblclick();
  const e = frame(p).locator(".mxCellEditor");
  await e.fill(to);
  // Leave the cell editor open: finishing must commit text composition before saving.
}
try {
  for (const [p, name] of [
    [a, "王强"],
    [b, "小张"],
  ] as const) {
    await p.goto(server.publicOrigin);
    await registerPage(p, name);
  }
  const s = server.workspace!;
  const actorA = s.actor(
    (await a.evaluate(() => localStorage.getItem("zhitu-session")))!,
  )!;
  const actorB = s.actor(
    (await b.evaluate(() => localStorage.getItem("zhitu-session")))!,
  )!;
  const d = s.create(
    "读写分离",
    await fs.readFile("fixtures/examples/flow.drawio", "utf8"),
    actorA,
  );
  const url = server.publicOrigin + "/documents/" + d.id;
  await a.goto(url);
  await waitForEditable(a);
  await expect(toggle(a)).toHaveAttribute("aria-pressed", "true");
  await a.getByRole("button", { name: "分享链接", exact: true }).click();
  const dialog = a.getByRole("dialog", { name: "分享图稿", exact: true });
  await dialog.getByRole("radio", { name: "所有成员", exact: true }).check();
  await expect(
    dialog.getByRole("radio", { name: "仅查看", exact: true }),
  ).toBeChecked();
  await dialog
    .getByRole("button", { name: "保存分享权限", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "保存分享权限", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await b.goto(url);
  await expect(b.locator(".shared-notice")).toContainText("已更新");
  await expect(b.getByLabel("图稿文件名")).toBeDisabled();
  await expect(toggle(b)).toHaveCount(0);
  await expect(b.getByLabel("当前编辑状态")).toHaveText("仅查看");
  await expect(b.getByLabel("在线协同成员")).toHaveText("王强正在编辑");
  assert.equal(s.collaboration.members(d.id).length, 1);
  await frame(b).getByText("提交申请", { exact: true }).dblclick();
  await expect(frame(b).locator(".mxCellEditor")).toHaveCount(0);
  pass("新分享默认仅查看：接收者标题、画布不可改，无编辑按钮、不占编辑会话");
  await a.getByLabel("图稿文件名").fill("查看页自动更新");
  await expect(b.getByLabel("图稿文件名")).toHaveValue("查看页自动更新");
  await expect(b.getByLabel("图稿文件名")).toBeDisabled();
  pass("查看页面自动接收服务器更新，保持只读");
  await a.getByRole("button", { name: "分享链接", exact: true }).click();
  await dialog.getByRole("radio", { name: "指定成员", exact: true }).check();
  await dialog.getByRole("checkbox", { name: new RegExp(actorB.id) }).check();
  await dialog.getByRole("combobox").selectOption("edit");
  await dialog
    .getByRole("button", { name: "保存分享权限", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "保存分享权限", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(toggle(b)).toBeEnabled({ timeout: 12000 });
  await expect(toggle(b)).toHaveAttribute("aria-pressed", "false");
  await b.reload();
  await expect(b.locator(".shared-notice")).toContainText("已更新");
  await expect(toggle(b)).toHaveAttribute("aria-pressed", "false");
  assert.equal(s.collaboration.members(d.id).length, 1);
  let joins = 0;
  await b.route("**/collaboration/join", (route) =>
    ++joins === 1
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "首次加入失败" }),
        })
      : route.continue(),
  );
  await enterEditing(b);
  assert.ok(joins >= 2);
  await b.unroute("**/collaboration/join");
  pass("主动进入编辑遇到临时失败会自动重试，恢复后保留编辑意图");
  await expect(toggle(b)).toHaveAttribute("aria-pressed", "true");
  await expect(b.getByLabel("在线协同成员")).toHaveText("王强、小张（你）正在编辑");
  await expect(a.getByLabel("在线协同成员")).toHaveText("王强（你）、小张正在编辑", {timeout:8000});
  await expect(b.getByLabel("当前编辑状态")).toHaveCount(0);
  await expect(b.locator(".shared-notice")).toHaveText("已保存");
  await expect(b.locator(".shared-notice")).toHaveAttribute("title", /服务器版本/);
  await b.screenshot({ path: "artifacts/share-editing-toggle.png" });
  assert.equal(s.collaboration.members(d.id).length, 2);
  await changeCell(b, "提交申请", "退出时提交文字");
  await toggle(b).click();
  await expect(toggle(b)).toHaveAttribute("aria-pressed", "false");
  await expect(b.getByLabel("当前编辑状态")).toHaveText("仅查看");
  await expect(b.getByLabel("在线协同成员")).toHaveText("王强正在编辑");
  await expect(a.getByLabel("在线协同成员")).toHaveCount(0,{timeout:8000});
  await expect(a.getByLabel("当前编辑状态")).toHaveText("编辑中");
  assert.ok(s.get(d.id).xml.includes("退出时提交文字"));
  assert.equal(s.collaboration.members(d.id).length, 1);
  await expect(b.getByLabel("图稿文件名")).toBeDisabled();
  await frame(a).getByText("退出时提交文字", { exact: true }).waitFor();
  pass(
    "指定成员可编辑仍默认查看；按钮选中后加入，再次点击提交未结束文字并保存、退回只读",
  );
  // Viewers do not block whole-document management.
  const session = s.db
    .prepare("SELECT token FROM collaborators WHERE documentId=? AND owner=?")
    .get(d.id, actorA.id)!;
  const restored = s.restore(
    d.id,
    1,
    { revision: s.get(d.id).revision, collaborationToken: session.token },
    actorA,
  );
  assert.ok(restored.xml.includes("提交申请"));
  await frame(b).getByText("提交申请", { exact: true }).waitFor();
  pass("只有查看者在线时不阻止作者恢复历史，查看者自动加载恢复内容");
  await enterEditing(b);
  await b.route("**/collaboration/sync", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "测试保存失败" }),
    }),
  );
  await b.getByLabel("图稿文件名").fill("失败后保留标题");
  await toggle(b).click();
  await expect(b.locator(".shared-notice")).toContainText("连接中断");
  await expect(toggle(b)).toHaveAttribute("aria-pressed", "true");
  await expect(b.getByLabel("图稿文件名")).toBeEnabled();
  await expect(b.getByLabel("图稿文件名")).toHaveValue("失败后保留标题");
  assert.notEqual(s.get(d.id).name, "失败后保留标题");
  await b.unroute("**/collaboration/sync");
  await toggle(b).click();
  await expect(toggle(b)).toHaveAttribute("aria-pressed", "false");
  assert.equal(s.get(d.id).name, "失败后保留标题");
  pass("退出编辑遇到保存失败保留内容和编辑态，重试保存后才退出");
  await enterEditing(b);
  s.share(
    d.id,
    {
      visibility: "selected",
      recipients: [actorB.id],
      role: "view",
      recipientRoles: { [actorB.id]: "view" },
      accessRevision: s.get(d.id).accessRevision,
    },
    actorA,
  );
  await expect(toggle(b)).toHaveCount(0, { timeout: 10000 });
  await expect(b.getByLabel("图稿文件名")).toBeDisabled();
  await expect(b.locator(".shared-notice")).toContainText("仅查看");
  assert.equal(s.collaboration.members(d.id).length, 1);
  pass("编辑授权收回后，未修改的页面自动退回查看，服务器即时清除会话");
  s.share(
    d.id,
    {
      visibility: "selected",
      recipients: [actorB.id],
      recipientRoles: { [actorB.id]: "edit" },
      accessRevision: s.get(d.id).accessRevision,
    },
    actorA,
  );
  await expect(toggle(b)).toBeEnabled({ timeout: 12000 });
  await enterEditing(b);
  await b.route("**/collaboration/sync", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "待保存" }),
    }),
  );
  await b.getByLabel("图稿文件名").fill("降权时保留本地修改");
  s.share(
    d.id,
    {
      visibility: "selected",
      recipients: [actorB.id],
      recipientRoles: { [actorB.id]: "view" },
      accessRevision: s.get(d.id).accessRevision,
    },
    actorA,
  );
  await expect(b.locator(".shared-notice")).toContainText("同步已暂停", {
    timeout: 10000,
  });
  await expect(b.getByLabel("图稿文件名")).toHaveValue("降权时保留本地修改");
  await expect(b.getByLabel("图稿文件名")).toBeDisabled();
  assert.notEqual(s.get(d.id).name, "降权时保留本地修改");
  const downloaded = b.waitForEvent("download");
  await b.getByRole("button", { name: "下载副本", exact: true }).click();
  assert.match((await downloaded).suggestedFilename(), /降权时保留本地修改/);
  await b.unroute("**/collaboration/sync");
  await b.getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(b.locator(".shared-notice")).toContainText("已更新");
  await expect(toggle(b)).toHaveCount(0);
  pass("有待保存修改时降权会暂停并保留可下载副本，确认重新连接后恢复只读");
  // New document navigation must flush dirty content first; a failure must keep current document.
  await a.route("**/collaboration/sync", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "切换前保存失败" }),
    }),
  );
  await a.getByLabel("图稿文件名").fill("新建前保存旧文件");
  const create = async () => {
    await a.getByRole("button", { name: "新建", exact: true }).click();
    await a
      .getByRole("dialog", { name: "新建图稿", exact: true })
      .getByRole("button", { name: "创建空白画布", exact: true })
      .click();
  };
  await create();
  await expect(a.locator(".shared-notice")).toContainText("连接中断");
  assert.equal(a.url(), url);
  await expect(a.getByLabel("图稿文件名")).toHaveValue("新建前保存旧文件");
  await a.unroute("**/collaboration/sync");
  await create();
  await a.waitForURL("**/new/*");
  assert.equal(s.get(d.id).name, "新建前保存旧文件");
  pass(
    "新建其他图稿前先保存当前文件，保存失败留在原文件，重试成功才进入空白新建页",
  );
  await a.goto(url);
  await waitForEditable(a);
  await a.route("**/collaboration/sync", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "打开前保存失败" }),
    }),
  );
  await a.getByLabel("图稿文件名").fill("打开前保存旧文件");
  const openFile = async () => {
    const chooser = a.waitForEvent("filechooser");
    await a.getByRole("button", { name: "打开", exact: true }).click();
    await (await chooser).setFiles("fixtures/examples/flow.drawio");
  };
  await openFile();
  await expect(a.locator(".shared-notice")).toContainText("连接中断");
  assert.equal(a.url(), url);
  await expect(a.getByLabel("图稿文件名")).toHaveValue("打开前保存旧文件");
  await a.unroute("**/collaboration/sync");
  await openFile();
  await a.waitForURL("**/new/*");
  assert.equal(s.get(d.id).name, "打开前保存旧文件");
  pass("打开其他文件前同样先保存；失败不覆盖当前内容，成功后进入新文件");
  await a.goto(url);
  await waitForEditable(a);
  await a.getByRole("button", { name: "移入回收站", exact: true }).click();
  await a.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  await b.getByRole("heading", { name: "无法访问此图稿" }).waitFor();
  assert.equal(s.get(d.id, true).deleted, 1);
  pass("查看者不阻止作者删除；删除后查看页停止显示文件");
  assert.deepEqual(errors, []);
  await fs.mkdir("artifacts", { recursive: true });
  await fs.writeFile(
    "artifacts/sharing-roles-report.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
  await fs.rm(directory, { recursive: true, force: true });
}
