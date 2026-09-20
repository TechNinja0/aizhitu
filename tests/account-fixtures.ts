import { randomUUID } from "node:crypto";
import type { Page } from "playwright/test";
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
