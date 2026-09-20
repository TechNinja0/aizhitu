import { chromium, expect } from "playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../apps/local-server/server.ts";
import { validate } from "../packages/document-core/index.ts";
import { templates } from "../packages/diagram-templates/index.ts";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-personal-browser-"));
const server = await startServer({ port: 0, shared: true, dataDirectory: dir });
const browser = await chromium.launch({ channel: "chromium" });
const context = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
  }),
  page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => void d.accept());
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
const mine = async () => {
  await picker()
    .getByRole("button", { name: /我的模板/ })
    .click();
};
const headers = {
  Authorization: `Bearer ${server.token}`,
  "Content-Type": "application/json",
};
const api = async (url: string, body?: unknown, method?: string) =>
  fetch(server.origin + "/api/" + url, {
    method: method || (body ? "POST" : "GET"),
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
try {
  await page.goto(server.origin + "/local");
  await page.getByText("9 个节点 · 6 条连线").waitFor();
  const original = validate((await invoke("snapshot")).xml);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await picker().getByRole("button", { name: "进阶模板", exact: true }).click();
  await expect(picker().locator(".template-card")).toHaveCount(
    templates.filter((t) => t.complexity === "advanced").length + 1,
  );
  await picker()
    .getByRole("button", { name: "选择模板：电商平台全景架构", exact: true })
    .click();
  await picker().getByRole("button", { name: "放大预览", exact: true }).click();
  await picker()
    .getByAltText("电商平台全景架构大图预览")
    .evaluate((i: HTMLImageElement) => i.decode());
  await page.screenshot({ path: "artifacts/advanced-template-preview.png" });
  await picker().getByRole("button", { name: "放大", exact: true }).click();
  await expect(picker().getByText("150%", { exact: true })).toBeVisible();
  await picker().getByRole("button", { name: "收起预览", exact: true }).click();
  await mine();
  await picker().getByText("还没有个人模板").waitFor();
  await picker().getByRole("button", { name: "取消", exact: true }).click();
  console.log("PASS 进阶模板可筛选、查看大图并缩放，个人模板空状态有指引");

  await page.getByRole("button", { name: "保存为模板", exact: true }).click();
  const save = page.getByRole("dialog", { name: "保存为模板", exact: true });
  await save.getByLabel("模板名称", { exact: true }).fill("我的订单架构");
  await save
    .getByLabel("模板说明", { exact: true })
    .fill("保留原有配色、分组和连线");
  await save.getByAltText("个人模板预览").waitFor({ timeout: 45000 });
  await save
    .getByAltText("个人模板预览")
    .evaluate((i: HTMLImageElement) => i.decode());
  await page.screenshot({ path: "artifacts/save-personal-template.png" });
  await page.route("**/api/templates", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "模拟保存失败" }),
        })
      : route.continue(),
  );
  await save
    .getByRole("button", { name: "保存到我的模板", exact: true })
    .click();
  await expect(save.getByRole("alert")).toContainText("模拟保存失败");
  await expect(save.getByLabel("模板名称", { exact: true })).toHaveValue(
    "我的订单架构",
  );
  await page.unroute("**/api/templates");
  await save
    .getByRole("button", { name: "保存到我的模板", exact: true })
    .click();
  await expect(save).toHaveCount(0);
  assert.equal(
    validate((await invoke("snapshot")).xml).contentHash,
    original.contentHash,
  );
  const saved = (await (await api("templates")).json())[0];
  assert.equal(saved.name, "我的订单架构");
  const other = server.workspace!.enter("另一用户");
  assert.deepEqual(
    await (
      await fetch(server.origin + "/api/templates", {
        headers: { Authorization: `Bearer ${other.token}` },
      })
    ).json(),
    [],
  );
  assert.equal(
    (
      await fetch(server.origin + `/api/templates/${saved.id}/instantiate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${other.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "越权副本" }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await api("templates", {
        id: saved.id,
        name: "假预览",
        description: "",
        category: "flow",
        xml: original.xml,
        previewJobId: "bad",
      })
    ).status,
    409,
  );
  console.log(
    "PASS 图稿快照与真实 PNG 预览保存，失败可重试；不修改原图，身份隔离及预览校验生效",
  );

  await page.reload();
  await page.getByText("9 个节点 · 6 条连线").waitFor();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await mine();
  await picker()
    .getByRole("button", { name: "选择模板：我的订单架构", exact: true })
    .click();
  await picker()
    .getByAltText("我的订单架构大图预览")
    .evaluate((i: HTMLImageElement) => i.decode());
  await page.screenshot({ path: "artifacts/my-templates.png" });
  await picker().getByRole("button", { name: "编辑信息", exact: true }).click();
  await picker().getByLabel("编辑模板名称").fill("团队订单蓝图");
  await picker().getByLabel("编辑模板分类").selectOption("planning");
  await picker()
    .getByRole("button", { name: "保存模板信息", exact: true })
    .click();
  await picker()
    .getByRole("button", { name: "选择模板：团队订单蓝图", exact: true })
    .waitFor();
  await picker()
    .getByRole("button", { name: "使用此模板", exact: true })
    .click();
  await expect(picker()).toHaveCount(0);
  await expect(page.getByLabel("图稿文件名")).toHaveValue(
    "团队订单蓝图.drawio",
  );
  const clone = validate((await invoke("snapshot")).xml);
  assert.notEqual(clone.metadata!.documentId, original.metadata!.documentId);
  assert.deepEqual(
    clone.cells!.filter((c) => c.id !== "0"),
    original.cells!.filter((c) => c.id !== "0"),
  );
  await invoke("focus", { ids: ["service"] });
  await invoke("color", { key: "fillColor", value: "#123456" });
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await picker()
    .getByRole("button", { name: "创建空白画布", exact: true })
    .click();
  await page
    .getByRole("button", { name: "放弃当前修改并继续", exact: true })
    .click();
  await page.getByText("0 个节点 · 0 条连线").waitFor();
  await page.getByRole("button", { name: "选择模板", exact: true }).click();
  const fill = page.getByRole("dialog", { name: "选择模板", exact: true });
  await fill.getByRole("button", { name: /我的模板/ }).click();
  await fill
    .getByRole("button", { name: "选择模板：团队订单蓝图", exact: true })
    .click();
  const blankId = validate((await invoke("snapshot")).xml).metadata!.documentId;
  await fill
    .getByRole("button", { name: "应用到当前草稿", exact: true })
    .click();
  await page.getByText("9 个节点 · 6 条连线").waitFor();
  const filled = validate((await invoke("snapshot")).xml);
  assert.equal(filled.metadata!.documentId, blankId);
  assert.deepEqual(
    filled.cells!.filter((c) => c.id !== "0"),
    original.cells!.filter((c) => c.id !== "0"),
  );
  console.log(
    "PASS 个人模板刷新后保留、信息可编辑；新建产生新身份，填充保留当前身份，修改副本不影响模板",
  );

  await page.getByRole("button", { name: "新建", exact: true }).click();
  await mine();
  await picker()
    .getByRole("button", { name: "选择模板：团队订单蓝图", exact: true })
    .click();
  await picker().getByRole("button", { name: "删除模板", exact: true }).click();
  await picker().getByRole("button", { name: "保留模板", exact: true }).click();
  await expect(
    picker().getByRole("button", {
      name: "选择模板：团队订单蓝图",
      exact: true,
    }),
  ).toBeVisible();
  await picker().getByRole("button", { name: "删除模板", exact: true }).click();
  await picker()
    .getByRole("button", { name: "确认删除模板", exact: true })
    .click();
  await picker().getByText("还没有个人模板").waitFor();
  await picker().getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(
    validate((await invoke("snapshot")).xml).contentHash,
    filled.contentHash,
  );
  assert.equal(
    (await api(`templates/${saved.id}/instantiate`, { title: "已删除" }))
      .status,
    404,
  );
  assert.deepEqual(errors, []);
  console.log("PASS 删除模板需确认且不影响已创建图稿；全流程无浏览器运行错误");
} finally {
  await browser.close();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
