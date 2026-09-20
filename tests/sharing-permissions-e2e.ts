import { registerPage } from "./account-fixtures.ts";
import { chromium, expect, type Page } from "playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../apps/local-server/server.ts";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-acl-ui-"));
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
async function login(name: string) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(server.publicOrigin);
  await registerPage(p, name);
  await p.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  const token = await p.evaluate(() => localStorage.getItem("zhitu-session"));
  return { p, actor: server.workspace!.actor(token!)! };
}
const row = (p: Page) =>
  p
    .locator(".shared-row:not(.shared-table-head)")
    .filter({ has: p.getByRole("link", { name: "私有设计", exact: true }) });
try {
  const { p: a, actor: owner } = await login("创建者");
  const { p: b, actor: recipient } = await login("王强");
  const { p: c } = await login("王强");
  // Independent browser identities, including an identically named unauthorized member.
  const d = server.workspace!.create("私有设计", undefined, owner);
  const link = server.publicOrigin + "/documents/" + d.id;
  await row(a).waitFor();
  await expect(row(b)).toHaveCount(0);
  await b.goto(link);
  await b.getByRole("heading", { name: "无法访问此图稿" }).waitFor();
  await expect(b.locator("iframe")).toHaveCount(0);
  await b.goto(server.publicOrigin);
  await row(a).getByRole("button", { name: "分享图稿", exact: true }).click();
  const dialog = a.getByRole("dialog", { name: "分享图稿", exact: true });
  await expect(
    dialog.getByRole("radio", { name: "仅自己", exact: true }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "复制链接", exact: true }).click();
  assert.equal(
    server.workspace!.get(d.id).visibility,
    "private",
    "打开窗口、复制链接不开放权限",
  );
  await dialog.getByRole("radio", { name: "指定成员", exact: true }).check();
  await expect(
    dialog.getByRole("button", { name: "保存分享权限", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("checkbox", { name: new RegExp(recipient.id) })
    .check();
  await expect(
    dialog.getByRole("button", { name: "复制链接", exact: true }),
  ).toBeDisabled();
  await expect(row(b)).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "保存分享权限", exact: true })
    .click();
  await dialog
    .getByText("分享权限已保存，可以复制链接发送给已授权成员", { exact: true })
    .waitFor();
  await row(b).waitFor();
  await expect(row(c)).toHaveCount(0);
  await a.screenshot({ path: "artifacts/sharing-selected-members.png" });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await c.goto(link);
  await c.getByRole("heading", { name: "无法访问此图稿" }).waitFor();
  await expect(c.locator("iframe")).toHaveCount(0);
  await b.goto(link);
  await b.getByText(/已同步服务器版本/).waitFor();
  await b.getByRole("button", { name: "分享链接", exact: true }).click();
  const peerDialog = b.getByRole("dialog", { name: "分享图稿", exact: true });
  await peerDialog
    .getByText("你已获授权访问；只有文件所有者或本机管理员可以调整分享范围。", {
      exact: true,
    })
    .waitFor();
  await expect(peerDialog.getByRole("radio")).toHaveCount(0);
  await peerDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await b.getByRole("button", { name: "获取编辑权", exact: true }).click();
  await b.getByRole("button", { name: "结束编辑", exact: true }).waitFor();
  assert.equal(server.workspace!.lock(d.id)?.owner, recipient.id);
  console.log(
    "PASS 默认私有、复制不授权、保存选择才生效、指定身份可见、同名未授权直链拒绝、接收者不能转授权",
  );

  await row(a).getByRole("button", { name: "分享图稿", exact: true }).click();
  await dialog.getByRole("radio", { name: "仅自己", exact: true }).check();
  await dialog
    .getByRole("button", { name: "保存分享权限", exact: true })
    .click();
  await dialog
    .getByText("已收回分享，仅自己和本机管理员可见", { exact: true })
    .waitFor();
  await b.getByRole("heading", { name: "无法访问此图稿" }).waitFor();
  await expect(b.locator("iframe")).toHaveCount(0);
  assert.equal(server.workspace!.lock(d.id), undefined);
  console.log(
    "PASS 编辑中收回分享：租约失效、已打开页面移除画布、后续不能继续读写",
  );

  await dialog.getByRole("radio", { name: "所有成员", exact: true }).check();
  await dialog
    .getByRole("button", { name: "保存分享权限", exact: true })
    .click();
  await dialog
    .getByText("分享权限已保存，可以复制链接发送给已授权成员", { exact: true })
    .waitFor();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await c.goto(server.publicOrigin);
  await row(c).waitFor();
  const { p: newcomer } = await login("新成员");
  await row(newcomer).waitFor();
  await a.goto(link);
  await a.getByRole("button", { name: "分享链接", exact: true }).click();
  await expect(
    dialog.getByRole("radio", { name: "所有成员", exact: true }),
  ).toBeChecked();
  await dialog.getByRole("radio", { name: "仅自己", exact: true }).check();
  await dialog
    .getByRole("button", { name: "保存分享权限", exact: true })
    .click();
  await dialog
    .getByText("已收回分享，仅自己和本机管理员可见", { exact: true })
    .waitFor();
  await expect(row(c)).toHaveCount(0, { timeout: 7000 });
  await expect(row(newcomer)).toHaveCount(0, { timeout: 7000 });
  await a.setViewportSize({ width: 390, height: 844 });
  await a.screenshot({ path: "artifacts/sharing-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS 所有成员包含新加入身份、编辑页与文件库权限一致、收回后列表自动消失、无浏览器异常",
  );
} finally {
  await browser.close();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
