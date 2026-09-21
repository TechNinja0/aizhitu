import { waitForEditable } from "./account-fixtures.ts";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../apps/local-server/server.ts";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-share-"));
const lanHost = Object.values(os.networkInterfaces())
  .flat()
  .find((n) => n?.family === "IPv4" && !n.internal)?.address;
assert.ok(lanHost, "需要局域网地址验证 HTTP 复制");
const server = await startServer({
  port: 0,
  workbenchDirectory: process.env.ZHITU_TEST_WORKBENCH,
  shared: true,
  lanHost,
  dataDirectory: directory,
});
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  const member = await server.workspace!.accounts.register({
    login: "sharetest",
    name: "分享测试",
    password: "Account-testing-2026-safe",
  });
  const doc = server.workspace!.create("分享测试图稿", undefined, member.actor);
  await page.goto(server.publicOrigin);
  await page.getByLabel("登录名", { exact: true }).waitFor();
  await page.evaluate(
    (token) => localStorage.setItem("zhitu-session", token),
    member.token,
  );
  const link = `${server.publicOrigin}/documents/${doc.id}`;
  await page.goto(link);
  await waitForEditable(page);
  assert.equal(await page.evaluate(() => window.isSecureContext), false);
  const share = page.getByRole("button", { name: "分享链接", exact: true });
  await share.click();
  await page.getByRole("button", { name: "复制链接", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "分享图稿" });
  await dialog.waitFor({ timeout: 5000 });
  assert.equal(await dialog.getByLabel("图稿链接").inputValue(), link);
  await dialog.getByText("链接已复制，可以发送给同事").waitFor();
  // Paste into an independent field to verify the actual HTTP legacy copy path.
  await page.evaluate(() => {
    const field = document.createElement("textarea");
    field.id = "paste-check";
    document.querySelector("dialog")!.append(field);
  });
  await page.locator("#paste-check").focus();
  await page.keyboard.press("ControlOrMeta+V");
  assert.equal(await page.locator("#paste-check").inputValue(), link);
  await page.locator("#paste-check").evaluate((el) => el.remove());
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await share.evaluate((el) => document.activeElement === el),
    true,
  );
  console.log("PASS HTTP 实际复制和粘贴、分享窗口链接、Esc 关闭与焦点恢复");

  await page.evaluate(`Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: () => Promise.reject(new Error("denied")) }
  })`);
  await share.click();
  await page.getByRole("button", { name: "复制链接", exact: true }).click();
  await dialog.getByText("链接已复制，可以发送给同事").waitFor();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  console.log("PASS 剪贴板接口拒绝后使用备用复制方式");

  await page.evaluate("document.execCommand = () => false");
  await share.click();
  await page.getByRole("button", { name: "复制链接", exact: true }).click();
  await dialog.getByText("自动复制未成功，请选中下方链接手动复制").waitFor();
  assert.equal(await dialog.getByLabel("图稿链接").inputValue(), link);
  await dialog.getByLabel("图稿链接").click();
  await page.waitForFunction(() => {
    const input = document.querySelector(
      "dialog input[readonly]",
    ) as HTMLInputElement;
    return input.selectionEnd! - input.selectionStart! === input.value.length;
  });
  assert.equal(
    await dialog
      .getByLabel("图稿链接")
      .evaluate(
        (el) =>
          (el as HTMLInputElement).selectionEnd! -
          (el as HTMLInputElement).selectionStart!,
      ),
    link.length,
  );
  await dialog.getByRole("button", { name: "复制链接", exact: true }).click();
  await dialog.getByText("自动复制未成功，请选中下方链接手动复制").waitFor();
  await page.screenshot({ path: "artifacts/share-manual-fallback.png" });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  console.log("PASS 两种复制均失败时保留可选中链接、允许重试，无虚假成功提示");

  // Local admin links must still point at the LAN address for recipients.
  await page.goto(`${server.origin}/documents/${doc.id}`);
  await page.getByLabel("图稿文件名").waitFor();
  await page.getByRole("button", { name: "分享链接", exact: true }).click();
  assert.equal(await dialog.getByLabel("图稿链接").inputValue(), link);
  assert.deepEqual(errors, []);
  console.log("PASS 本机管理页面分享局域网地址，浏览器无未捕获异常");
} finally {
  await browser.close();
  await server.close();
  await fs.rm(directory, { recursive: true, force: true });
}
