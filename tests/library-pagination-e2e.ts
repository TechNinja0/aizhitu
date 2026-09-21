import { chromium, expect } from "playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../apps/local-server/server.ts";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-pages-ui-"));
const server = await startServer({ port: 0, shared: true, dataDirectory: dir });
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const actor = { id: "local-admin", name: "管理员", admin: true };
  for (let i = 0; i < 25; i++) {
    const d = server.workspace!.create(
      i === 0 ? "唯一末页文件" : `分页文件 ${String(i).padStart(2, "0")}`,
      undefined,
      actor,
    );
    server
      .workspace!.db.prepare("UPDATE documents SET updatedAt=? WHERE id=?")
      .run(1000 + i, d.id);
  }
  const page = await browser.newPage({
    viewport: { width: 1600, height: 760 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => void d.accept());
  await page.goto(server.origin);
  const rows = page.locator(".shared-row:not(.shared-table-head)");
  await expect(rows).toHaveCount(10);
  await expect(page.getByLabel("每页显示数量")).toHaveValue("10");
  const before = await page.locator(".shared-table-head").boundingBox();
  const header = await page.locator(".shared-library header").boundingBox();
  const toolbar = await page.locator(".shared-files-toolbar").boundingBox();
  const list = page.getByRole("region", { name: "文件列表", exact: true });
  await list.hover();
  await page.mouse.wheel(0, 1000);
  await expect
    .poll(() => list.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  assert.deepEqual(
    await page.locator(".shared-library header").boundingBox(),
    header,
  );
  assert.deepEqual(
    await page.locator(".shared-files-toolbar").boundingBox(),
    toolbar,
  );
  const after = await page.locator(".shared-table-head").boundingBox();
  assert.ok(Math.abs(after!.y - before!.y) < 1);
  assert.equal(
    await page.locator(".shared-library").evaluate((el) => el.scrollTop),
    0,
  );
  await page.screenshot({ path: "artifacts/library-pagination-scroll.png" });
  console.log("PASS 顶部、工具栏、表头固定，仅文件列表滚动");
  await page.getByRole("button", { name: "第 3 页", exact: true }).click();
  await expect(rows).toHaveCount(5);
  assert.equal(await list.evaluate((el) => el.scrollTop), 0);
  await page.getByLabel("搜索图稿", { exact: true }).fill("唯一末页");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("唯一末页文件");
  await expect(
    page.getByRole("button", { name: "第 1 页", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByLabel("搜索图稿", { exact: true }).fill("无此文件");
  await expect(rows).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "下一页", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("搜索图稿", { exact: true }).fill("");
  await expect(rows).toHaveCount(10);
  await page.getByLabel("全选可管理文件", { exact: true }).check();
  await expect(page.getByText("已选 10 份", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByText("已选 0 份", { exact: true })).toBeVisible();
  await page.getByLabel("每页显示数量").selectOption("20");
  await expect(rows).toHaveCount(20);
  await page.reload();
  await expect(rows).toHaveCount(20);
  await expect(page.getByLabel("每页显示数量")).toHaveValue("20");
  console.log("PASS 跨页搜索、空结果、翻页清空选择、每页数量记忆");
  await page.getByRole("button", { name: "第 2 页", exact: true }).click();
  await expect(rows).toHaveCount(5);
  await page.getByLabel("全选可管理文件", { exact: true }).check();
  await page
    .getByRole("button", { name: "批量移入回收站", exact: true })
    .click();
  await expect(rows).toHaveCount(20);
  await expect(
    page.getByRole("button", { name: "第 1 页", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await expect(rows).toHaveCount(5);
  await page.getByRole("button", { name: "全部文件", exact: true }).click();
  await expect(rows).toHaveCount(20);
  await page.getByLabel("每页显示数量").selectOption("10");
  await expect(rows).toHaveCount(10);
  await page.screenshot({ path: "artifacts/library-pagination.png" });
  console.log("PASS 删除末页自动回退，回收站独立计数");
  await page.setViewportSize({ width: 760, height: 840 });
  await expect(page.getByLabel("每页显示数量")).toBeInViewport();
  await page.screenshot({ path: "artifacts/library-pagination-narrow.png" });
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
