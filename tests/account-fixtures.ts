import { randomUUID } from "node:crypto";
import { expect, type Page } from "playwright/test";
export const testPassword = "123456";
export async function registerPage(
  page: Page,
  name: string,
  login = "member-" + randomUUID().slice(0, 12),
) {
  await page.getByRole("button", { name: "注册新账号", exact: true }).click();
  await page.getByLabel("登录名", { exact: true }).fill(login);
  await page.getByLabel("显示姓名", { exact: true }).fill(name);
  await page.getByLabel("设置密码", { exact: true }).fill(testPassword);
  await page.getByLabel("确认密码", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "注册并进入", exact: true }).click();
  await page.getByRole("heading", { name: "文件库", exact: true }).waitFor();
  return login;
}

export async function waitForEditable(page: Page) {
  await expect(page.getByLabel("图稿文件名", { exact: true })).toBeEnabled({
    timeout: 20000,
  });
}

// Use explicitly for scenarios that intend to edit a received share.
export async function enterEditing(page: Page) {
  const toggle = page.getByRole("button", { name: "编辑", exact: true });
  await expect(toggle).toBeEnabled({ timeout: 20000 });
  if ((await toggle.getAttribute("aria-pressed")) !== "true")
    await toggle.click();
  await waitForEditable(page);
}
