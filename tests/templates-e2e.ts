import { chromium, expect, type Page } from "playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../apps/local-server/server.ts";
import { validate } from "../packages/document-core/index.ts";
import { templates, templateXml } from "../packages/diagram-templates/index.ts";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-templates-"));
const server = await startServer({ port: 0, shared: true, dataDirectory: dir });
const browser = await chromium.launch({ channel: "chromium" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors: string[] = [],
  external: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (
    [server.origin, server.engine.origin].some((origin) =>
      url.startsWith(origin + "/"),
    ) ||
    /^(data|blob):/.test(url)
  )
    return route.continue();
  external.push(url);
  return route.abort();
});
const invoke = (method: string, args: any = {}) =>
  page
    .frames()
    .find((f) => f !== page.mainFrame())!
    .evaluate(
      ({ method, args }) => (window as any).workbench.invoke(method, args),
      { method, args },
    );
const picker = () =>
  page.getByRole("dialog", { name: "新建图稿", exact: true });
const openPicker = () =>
  page.getByRole("button", { name: "新建", exact: true }).click();
const pass = (s: string) => console.log("PASS", s);
try {
  await page.goto(server.origin + "/local");
  await page.getByText("9 个节点 · 6 条连线").waitFor();
  const original = validate((await invoke("snapshot")).xml);
  await openPicker();
  await expect(picker().locator(".template-card")).toHaveCount(13);
  await picker()
    .getByRole("button", { name: /系统架构/ })
    .click();
  await expect(picker().locator(".template-card")).toHaveCount(5);
  await picker().getByLabel("搜索模板").fill("WORKER");
  await expect(picker().locator(".template-card")).toHaveCount(2);
  await picker().getByLabel("搜索模板").fill("不存在的模板");
  await picker().getByText("没有找到匹配的模板").waitFor();
  await picker().getByRole("button", { name: "查看全部模板" }).click();
  await picker()
    .getByRole("button", { name: "选择模板：微服务架构", exact: true })
    .click();
  await picker()
    .getByAltText("微服务架构大图预览")
    .evaluate((i: HTMLImageElement) => i.decode());
  await page.screenshot({ path: "artifacts/template-picker.png" });
  await picker().getByRole("button", { name: "放大预览" }).click();
  assert.ok(
    (await picker().getByAltText("微服务架构大图预览").boundingBox())!.width >
      800,
  );
  await page.screenshot({ path: "artifacts/template-preview.png" });
  await page.keyboard.press("Escape");
  await expect(picker()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker()).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "新建", exact: true }),
  ).toBeFocused();
  assert.equal(
    validate((await invoke("snapshot")).xml).contentHash,
    original.contentHash,
  );
  pass("分类、搜索、空结果、大小预览、Escape 及焦点恢复；浏览不改变当前图稿");

  await openPicker();
  await picker()
    .getByRole("button", { name: "选择模板：微服务架构", exact: true })
    .click();
  await picker().getByLabel("新建图稿名称").fill("测试服务架构");
  await picker().getByRole("button", { name: "使用此模板" }).click();
  await page.getByText("8 个节点 · 7 条连线").waitFor();
  await expect(page.getByLabel("图稿文件名")).toHaveValue(
    "测试服务架构.drawio",
  );
  await expect(page.locator(".save-state")).toHaveText(/尚未保存/);
  const first = validate((await invoke("snapshot")).xml);
  await invoke("focus", { ids: ["orders"] });
  await invoke("color", { key: "fillColor", value: "#123456" });
  assert.ok(
    validate((await invoke("snapshot")).xml)
      .cells!.find((c) => c.id === "orders")!
      .style.includes("#123456"),
  );
  await invoke("action", { name: "undo" });
  assert.equal(
    validate((await invoke("snapshot")).xml).contentHash,
    first.contentHash,
  );
  await openPicker();
  await picker()
    .getByRole("button", { name: "创建空白画布", exact: true })
    .click();
  await page.getByRole("dialog", { name: "当前图稿还有未保存修改" }).waitFor();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  assert.equal(
    validate((await invoke("snapshot")).xml).contentHash,
    first.contentHash,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存副本", exact: true }).click();
  assert.equal(
    validate(await fs.readFile((await (await download).path())!, "utf8"))
      .contentHash,
    first.contentHash,
  );
  await openPicker();
  await picker()
    .getByRole("button", { name: "创建空白画布", exact: true })
    .click();
  await page.getByText("0 个节点 · 0 条连线").waitFor();
  pass("模板创建后可编辑、撤销、下载；未保存保护与空白创建正常");

  // Exercise all templates in the real draw.io codec, including nested swimlanes.
  for (const template of templates) {
    const xml = validate(templateXml(template, template.name)).xml!;
    const result = await invoke("load", { xml });
    const actual = validate(result.xml);
    assert.ok(actual.ok, template.name);
    assert.equal(actual.stats.nodes, template.nodes.length, template.name);
    assert.equal(actual.stats.edges, template.edges.length, template.name);
    for (const node of template.nodes)
      assert.equal(
        actual.cells!.find((c) => c.id === node.id)!.label,
        node.label,
      );
    if (template.id === "swimlane")
      await page.screenshot({ path: "artifacts/template-swimlane-canvas.png" });
  }
  pass("12 个模板在真实编辑器中加载，节点、连线、泳道嵌套和文字完整");

  // File library uses the same picker and persists the actual template, then reloads it.
  await page.goto(server.origin);
  await page.getByRole("button", { name: "新建共享图稿", exact: true }).click();
  await picker()
    .getByRole("button", { name: "选择模板：申请审批流程", exact: true })
    .click();
  await picker().getByLabel("新建图稿名称").fill("共享审批模板");
  let createCalls = 0;
  await page.route("**/api/documents", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createCalls++;
    if (createCalls === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "模拟创建失败" }),
      });
    return route.continue();
  });
  await picker().getByRole("button", { name: "使用此模板" }).click();
  await picker()
    .getByRole("alert")
    .filter({ hasText: "模拟创建失败" })
    .waitFor();
  await expect(picker().getByLabel("新建图稿名称")).toHaveValue("共享审批模板");
  await picker().getByRole("button", { name: "使用此模板" }).click();
  await page.waitForURL(/\/documents\//);
  await page.getByText("5 个节点 · 5 条连线").waitFor();
  const sharedId = validate((await invoke("snapshot")).xml).metadata!
    .documentId;
  await page.reload();
  await page.getByText("5 个节点 · 5 条连线").waitFor();
  assert.equal(
    validate((await invoke("snapshot")).xml).metadata!.documentId,
    sharedId,
  );
  pass("共享文件库支持模板创建、失败重试与刷新后持久化");

  await page.getByRole("link", { name: "← 文件库" }).click();
  await page.getByRole("button", { name: "新建共享图稿", exact: true }).click();
  await page.setViewportSize({ width: 760, height: 840 });
  await picker()
    .getByRole("button", { name: "选择模板：跨部门泳道流程", exact: true })
    .click();
  const bounds = await picker().boundingBox();
  assert.ok(bounds!.x >= 0 && bounds!.x + bounds!.width <= 760);
  await expect(
    picker().getByRole("button", { name: "使用此模板" }),
  ).toBeInViewport();
  await page.screenshot({ path: "artifacts/template-picker-narrow.png" });
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  pass("窄屏浮窗无溢出；模板选择与创建无需访问外网，浏览器无运行错误");
} finally {
  await browser.close();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
