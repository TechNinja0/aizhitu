import { registerPage } from "./account-fixtures.ts";
import { chromium, expect, type Page } from "playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../apps/local-server/server.ts";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-library-"));
const lanHost = Object.values(os.networkInterfaces())
  .flat()
  .find((n) => n?.family === "IPv4" && !n.internal)?.address;
assert.ok(lanHost);
const server = await startServer({
  port: 0,
  workbenchDirectory: process.env.ZHITU_TEST_WORKBENCH,
  shared: true,
  lanHost,
  dataDirectory: dir,
  leaseMs: 6000,
});
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const ca = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
});
const cb = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
});
const a = await ca.newPage(),
  b = await cb.newPage();
const errors: string[] = [];
for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
const row = (p: Page, name: string) =>
  p
    .locator(".shared-row:not(.shared-table-head)")
    .filter({ has: p.getByRole("link", { name, exact: true }) });
const count = () =>
  Number(
    server.workspace!.db.prepare("SELECT count(*) AS n FROM documents").get()!
      .n,
  );
const frame = (p: Page) => p.frames().find((f) => f !== p.mainFrame())!;
const invoke = (p: Page, method: string, args: any = {}) =>
  frame(p).evaluate(
    ({ method, args }) => (window as any).workbench.invoke(method, args),
    { method, args },
  );
async function back(p: Page) {
  await p.getByRole("link", { name: "← 文件库", exact: true }).click();
  await p.getByRole("heading", { name: "文件库", exact: true }).waitFor();
}
async function create(name: string, template = false) {
  await a.getByLabel("新图稿名称", { exact: true }).fill(name);
  await a.getByRole("button", { name: "新建图稿", exact: true }).click();
  if (template) {
    await a.getByPlaceholder("搜索模板，例如：微服务、审批、ER").fill("MVVM");
    await a
      .locator(".template-card")
      .filter({ hasText: "Android APP" })
      .click();
    await a.getByRole("button", { name: "使用此模板", exact: true }).click();
  } else
    await a.getByRole("button", { name: "创建空白画布", exact: true }).click();
  await a.waitForURL("**/new/*");
  await expect(
    a.getByRole("button", { name: "保存到文件库", exact: true }),
  ).toBeEnabled();
}
try {
  await a.goto(server.publicOrigin);
  await registerPage(a, "测试创建者");
  await b.goto(server.publicOrigin);
  await registerPage(b, "测试访问者");
  await create("不保存空白");
  await invoke(a, "zoom", { action: "in" });
  await invoke(a, "panMode", { active: true });
  await invoke(a, "panMode", { active: false });
  await a.waitForTimeout(2300);
  assert.equal(count(), 0);
  await back(a);
  assert.equal(count(), 0);
  await create("不保存模板", true);
  const before = await invoke(a, "snapshot");
  assert.ok(before.counts.nodes > 0);
  await invoke(a, "action", { name: "selectAll" });
  await invoke(a, "zoom", { action: "fit" });
  await a.waitForTimeout(2300);
  await back(a);
  assert.equal(count(), 0);
  await create("空白稿再选模板");
  await a.getByRole("button", { name: "选择模板", exact: true }).click();
  await a.getByPlaceholder("搜索模板，例如：微服务、审批、ER").fill("MVVM");
  await a.locator(".template-card").filter({ hasText: "Android APP" }).click();
  await a.getByRole("button", { name: "应用到当前草稿", exact: true }).click();
  await a
    .getByRole("dialog", { name: "选择模板", exact: true })
    .waitFor({ state: "hidden" });
  await a.waitForTimeout(2300);
  assert.equal(count(), 0);
  await back(a);
  console.log(
    "PASS 空白和模板初次打开、缩放、选择、平移及直接返回均不创建服务器文件",
  );

  await create("模板自动保存", true);
  // A real graph style edit triggers autosave, unlike selection/viewport operations.
  await invoke(a, "action", { name: "selectAll" });
  await invoke(a, "color", { key: "fillColor", value: "#abcdef" });
  await a.waitForURL("**/documents/*", { timeout: 20000 });
  await a.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  const id = a.url().split("/").pop()!;
  assert.equal(count(), 1);
  assert.match(server.workspace!.get(id).xml, /abcdef/);
  assert.equal(server.workspace!.get(id).draft, 0);
  assert.equal(server.workspace!.get(id).visibility, "private");
  await a.getByLabel("图稿文件名").fill("返回前改名");
  await back(a);
  await row(a, "返回前改名").waitFor();
  await expect(
    a.getByRole("button", { name: "我的草稿", exact: true }),
  ).toHaveCount(0);
  await b.reload();
  await b.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  await expect(row(b, "返回前改名")).toHaveCount(0);
  await b.goto(server.publicOrigin + "/documents/" + id);
  await b.getByRole("heading", { name: "无法访问此图稿" }).waitFor();
  await b.goto(server.publicOrigin);
  console.log(
    "PASS 首次内容修改自动进入全部文件、返回前保存名称、默认私有且另一用户无法直链访问",
  );

  await create("主动保存空白");
  await a.getByRole("button", { name: "保存到文件库", exact: true }).click();
  await a.waitForURL("**/documents/*");
  await a.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  await back(a);
  assert.equal(count(), 2);
  await create("只改名称");
  await a.getByLabel("图稿文件名").fill("名称修改后返回");
  await back(a);
  await row(a, "名称修改后返回").waitFor();
  assert.equal(count(), 3);
  console.log("PASS 未修改时主动保存有效；新稿改名立即返回会先保存再离开");
  await create("名称校验后恢复");
  await a.getByLabel("图稿文件名").fill("   ");
  await a.getByRole("alert").filter({ hasText: "请修正后重新保存" }).waitFor();
  await expect(a.getByLabel("图稿文件名")).toBeEnabled();
  assert.equal(count(), 3);
  await a.getByLabel("图稿文件名").fill("修正后的文件名");
  await a.waitForURL("**/documents/*");
  await a.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  await back(a);
  await row(a, "修正后的文件名").waitFor();
  console.log("PASS 首次保存名称校验失败后可以修正，修正后自动保存成功");

  await create("重试只创建一次");
  let dropped = false;
  await a.route("**/api/documents", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await a.getByLabel("图稿文件名").fill("重试只创建一次_修改");
  await a
    .getByRole("button", { name: "重试保存", exact: true })
    .waitFor({ timeout: 15000 });
  assert.equal(count(), 5);
  a.once("dialog", (d) => void d.accept());
  await a.reload();
  await a.getByRole("button", { name: "重试保存", exact: true }).waitFor();
  await a.getByRole("button", { name: "重试保存", exact: true }).click();
  await a.waitForURL("**/documents/*");
  await a.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  assert.equal(count(), 5);
  await a.unroute("**/api/documents");
  await back(a);
  console.log("PASS 首次保存已落库但响应丢失，刷新保留内容，重试不重复创建");
  await create("空白内容立即返回");
  await invoke(a, "image", {
    data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=",
    width: 80,
    height: 80,
  });
  await back(a);
  await row(a, "空白内容立即返回").waitFor();
  assert.equal(count(), 6);
  console.log("PASS 空白稿增加图形后立即返回，尚未触发定时保存也不会丢失内容");

  await row(a, "返回前改名")
    .getByRole("button", { name: "分享图稿", exact: true })
    .click();
  const permissions = a.getByRole("dialog", { name: "分享图稿", exact: true });
  await permissions
    .getByRole("radio", { name: "所有成员", exact: true })
    .check();
  await permissions
    .getByRole("button", { name: "保存分享权限", exact: true })
    .click();
  await permissions
    .getByText("分享权限已保存，可以复制链接发送给已授权成员", { exact: true })
    .waitFor();
  await permissions.getByRole("button", { name: "关闭", exact: true }).click();
  await row(b, "返回前改名").waitFor();
  await row(b, "返回前改名")
    .getByRole("link", { name: "返回前改名", exact: true })
    .click();
  await b.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await b.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  await expect(
    row(a, "返回前改名").getByRole("button", {
      name: "移入回收站",
      exact: true,
    }),
  ).toBeDisabled();
  await back(b);
  await expect(
    row(a, "返回前改名").getByRole("button", {
      name: "移入回收站",
      exact: true,
    }),
  ).toBeEnabled();
  await a
    .getByRole("checkbox", { name: "全选可管理文件", exact: true })
    .check();
  a.once("dialog", (d) => void d.accept());
  await a.getByRole("button", { name: "批量移入回收站", exact: true }).click();
  await expect(a.locator(".shared-row:not(.shared-table-head)")).toHaveCount(0);
  await a.getByRole("button", { name: "回收站", exact: true }).click();
  await a
    .locator(".shared-row:not(.shared-table-head)")
    .filter({ hasText: "返回前改名" })
    .getByRole("button", { name: "恢复文件", exact: true })
    .click();
  await a.getByRole("button", { name: "全部文件", exact: true }).click();
  await row(a, "返回前改名").waitFor();
  await a.screenshot({ path: "artifacts/library-management.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS 分享后其他成员可见、单人编辑锁、批量回收和恢复、浏览器无异常",
  );
} finally {
  await browser.close();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
