import { chromium, expect } from "playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../apps/local-server/server.ts";
import { registerPage } from "./account-fixtures.ts";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-https-"));
const cert = path.join(dir, "cert.pem"),
  key = path.join(dir, "key.pem");
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
  ],
  { stdio: "ignore" },
);
const lanHost = Object.values(os.networkInterfaces())
  .flat()
  .find((n) => n?.family === "IPv4" && !n.internal)?.address;
assert.ok(lanHost);
const server = await startServer({
  port: 0,
  shared: true,
  lanHost,
  dataDirectory: dir,
  tlsCert: cert,
  tlsKey: key,
  workbenchDirectory: process.env.ZHITU_TEST_WORKBENCH,
});
const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  await page.goto(server.publicOrigin);
  assert.match(page.url(), /^https:/);
  await registerPage(page, "TLS 成员", "tls-user");
  const token = await page.evaluate(() =>
    localStorage.getItem("zhitu-session"),
  );
  const actor = server.workspace!.actor(token!)!;
  const xml = await fs.readFile(
    "fixtures/examples/architecture.drawio",
    "utf8",
  );
  const d = server.workspace!.create("HTTPS 图稿", xml, actor);
  await page.goto(server.publicOrigin + "/documents/" + d.id);
  await page.getByText("9 个节点 · 6 条连线").waitFor();
  assert.ok(
    page
      .frames()
      .find((f) => f !== page.mainFrame() && f.url().startsWith("https:")),
  );
  const pdf = page.waitForEvent("download", { timeout: 40000 });
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page
    .getByRole("button", { name: "PDF 单页完整图稿", exact: true })
    .click();
  await page.getByRole("button", { name: "生成 PDF", exact: true }).click();
  const downloaded = await pdf;
  assert.equal(await downloaded.failure(), null);
  console.log(
    "PASS HTTPS 工作台注册登录、HTTPS 画布加载、受限本机渲染导出 PDF",
  );
  await page.goto(server.origin + "/admin/users");
  await expect(
    page.getByRole("heading", { name: "用户管理", exact: true }),
  ).toBeVisible();
  console.log(
    "PASS HTTPS 本机管理员用户管理；测试仅临时信任自签名证书，未修改系统信任",
  );
} finally {
  await browser.close();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
