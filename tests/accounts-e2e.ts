import { chromium, expect, type Page } from "playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../apps/local-server/server.ts";
import { waitForEditable, registerPage, testPassword } from "./account-fixtures.ts";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-accounts-ui-"));
const lanHost = Object.values(os.networkInterfaces())
  .flat()
  .find((n) => n?.family === "IPv4" && !n.internal)?.address;
assert.ok(lanHost);
const server = await startServer({
  port: 0,
  shared: true,
  lanHost,
  dataDirectory: dir,
  workbenchDirectory: process.env.ZHITU_TEST_WORKBENCH,
});
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const errors: string[] = [];
async function page() {
  const c = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
const userRow = (p: Page, login: string) =>
  p.locator("tbody tr").filter({ has: p.getByText(login, { exact: true }) });
async function resetForm(p: Page, code: string, password = testPassword) {
  await p.getByRole("button", { name: "忘记账号或密码", exact: true }).click();
  await p.getByLabel("一次性设置凭证", { exact: true }).fill(code);
  await p.getByLabel("设置密码", { exact: true }).fill(password);
  await p.getByLabel("确认密码", { exact: true }).fill(password);
  await p.getByRole("button", { name: "设置密码并进入", exact: true }).click();
}
try {
  const old = server.workspace!.enter("旧王强"),
    doc = server.workspace!.create("原身份私有稿", undefined, old.actor);
  let a = await page();
  await a.goto(server.publicOrigin);
  await a.getByRole("heading", { name: "登录工作区", exact: true }).waitFor();
  await a.evaluate(
    (token) => localStorage.setItem("zhitu-session", token),
    old.token,
  );
  await a.reload();
  await a.getByRole("heading", { name: "为原身份设置账号" }).waitFor();
  await a.getByLabel("登录名", { exact: true }).fill("oldwang");
  await a.getByLabel("设置密码", { exact: true }).fill(testPassword);
  await a.getByLabel("确认密码", { exact: true }).fill(testPassword);
  await a.getByRole("button", { name: "保留原身份并设置账号" }).click();
  await a.getByRole("link", { name: "原身份私有稿", exact: true }).waitFor();
  assert.equal(server.workspace!.get(doc.id).owner, old.actor.id);
  const state = await a.context().storageState();
  await a.context().close();
  const reopened = await browser.newContext({
    storageState: state,
    viewport: { width: 1440, height: 1000 },
  });
  a = await reopened.newPage();
  a.on("pageerror", (e) => errors.push(e.message));
  await a.goto(server.publicOrigin);
  await a.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  await a.getByRole("link", { name: "原身份私有稿", exact: true }).waitFor();
  console.log(
    "PASS 旧身份补设账号保留 ID 和私有文件；关闭浏览器并恢复站点存储后自动登录",
  );
  const b = await page();
  await b.goto(server.publicOrigin);
  await registerPage(b, "接收人", "recipient");
  const admin = await page();
  admin.on("dialog", (d) => void d.accept());
  await admin.goto(server.origin);
  await admin.getByRole("link", { name: "用户管理", exact: true }).click();
  await admin.getByRole("heading", { name: "用户管理", exact: true }).waitFor();
  await admin.getByLabel("登录名", { exact: true }).fill("invited");
  await admin.getByLabel("显示姓名", { exact: true }).fill("新同事");
  await admin
    .getByRole("button", { name: "创建并生成设置凭证", exact: true })
    .click();
  const credential = admin.getByRole("region", { name: "密码设置凭证" });
  await credential.waitFor();
  const code = await credential.getByLabel("一次性设置凭证").inputValue();
  const invited = await page();
  await invited.goto(server.publicOrigin);
  await resetForm(invited, code);
  await invited.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  await admin.getByRole("button", { name: "关闭凭证", exact: true }).click();
  await admin.getByRole("button", { name: "刷新列表", exact: true }).click();
  await userRow(admin, "oldwang")
    .getByRole("button", { name: "管理", exact: true })
    .click();
  await a.getByRole("link", { name: "原身份私有稿", exact: true }).click();
  await waitForEditable(a);
  await admin
    .getByRole("button", { name: "生成一次性设置凭证", exact: true })
    .click();
  await credential.waitFor();
  const reset = await credential.getByLabel("一次性设置凭证").inputValue();
  assert.equal(server.workspace!.collaboration.members(doc.id).length, 0);
  await a
    .getByRole("heading", { name: "登录工作区", exact: true })
    .waitFor({ timeout: 20000 });
  await resetForm(a, reset);
  await waitForEditable(a);
  await a.getByRole("link", { name: "← 文件库", exact: true }).click();
  await a.getByRole("link", { name: "账号设置", exact: true }).click();
  const otherLogin = await server.workspace!.accounts.login({
    login: "oldwang",
    password: testPassword,
  });
  await a.getByLabel("原密码", { exact: true }).fill(testPassword);
  await a.getByLabel("新密码", { exact: true }).fill(testPassword + "-new");
  await a.getByLabel("确认新密码", { exact: true }).fill(testPassword + "-new");
  await a.getByRole("button", { name: "修改密码", exact: true }).click();
  await a.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  assert.equal(server.workspace!.actor(otherLogin.token), undefined);
  console.log(
    "PASS 管理员创建账号、一次性凭证设置密码、重置撤销旧登录与协同会话、自助改密码撤销其他设备",
  );
  await admin.getByRole("button", { name: "关闭凭证", exact: true }).click();
  await admin.getByRole("button", { name: "刷新列表", exact: true }).click();
  await userRow(admin, "oldwang")
    .getByRole("button", { name: "管理", exact: true })
    .click();
  await admin.getByRole("button", { name: "停用用户", exact: true }).click();
  await admin.getByText("用户状态已更新", { exact: true }).waitFor();
  await expect(
    admin.getByRole("button", { name: "删除用户", exact: true }),
  ).toBeDisabled();
  await admin
    .getByLabel("接收人", { exact: true })
    .selectOption({ label: "接收人（recipient）" });
  await admin.getByRole("button", { name: "转移图稿", exact: true }).click();
  await admin
    .getByText("已转移 1 份图稿，接收人可重新设置分享权限", { exact: true })
    .waitFor();
  await b.getByRole("link", { name: "原身份私有稿", exact: true }).waitFor();
  assert.equal(server.workspace!.get(doc.id).createdBy, "旧王强");
  await admin.getByRole("button", { name: "删除用户", exact: true }).click();
  await admin.getByText("用户已删除", { exact: true }).waitFor();
  await expect(userRow(admin, "oldwang")).toHaveCount(0);
  await a
    .getByRole("heading", { name: "登录工作区", exact: true })
    .waitFor({ timeout: 20000 });
  await b.goto(server.publicOrigin + "/admin/users");
  await b.getByRole("heading", { name: "仅本机管理员可管理用户" }).waitFor();
  await admin.screenshot({
    path: "artifacts/accounts-admin.png",
    fullPage: true,
  });
  await a.screenshot({ path: "artifacts/accounts-login.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS 停用即时撤销、名下有图稿禁止删除、转移保留历史与创建人、空账号删除、普通成员无管理权限、无浏览器异常",
  );
} finally {
  await browser.close();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
