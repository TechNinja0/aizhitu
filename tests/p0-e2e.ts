import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AIService } from "../packages/ai-service/index.ts";
import { startServer } from "../apps/local-server/server.ts";
import { validate } from "../packages/document-core/index.ts";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-p0-e2e-"));
const ai = await new AIService(dir, async (_file, args, o) => {
  const base = o.input!.split("当前完整图稿：\n")[1].split("\n用户需求：")[0];
  await fs.writeFile(
    args[args.indexOf("-o") + 1],
    base
      .replace('value="订单服务"', 'value="订单处理服务"')
      .replace("fontSize=14", "fontSize=18"),
  );
  return "{}";
}).init();
await ai.save({
  defaultProvider: "codex",
  providers: {
    codex: { path: process.execPath, model: "" },
    qoder: { path: "", model: "" },
  },
});
let server = await startServer({ port: 0, aiService: ai, dataDirectory: dir });
const browser = await chromium.launch({ channel: "chromium" }),
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  errors: string[] = [],
  checks: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const pass = (s: string) => {
  checks.push(s);
  console.log("PASS", s);
};
try {
  await page.goto(server.origin);
  await page.getByText("9 个节点 · 6 条连线").waitFor();
  let frame = page.frames()[1];
  const invoke = (method: string, args: any = {}) =>
    frame.evaluate(
      ({ method, args }) => (window as any).workbench.invoke(method, args),
      { method, args },
    );
  const original = await invoke("snapshot");
  await page.getByRole("button", { name: "排版与检查", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "排版与交付检查" });
  await panel.getByRole("button", { name: "生成排版预览" }).click();
  const review = page.getByRole("dialog", { name: "可视化改稿审阅" });
  await review.getByRole("button", { name: "放大对比" }).waitFor();
  await page.waitForFunction(
    () =>
      !(document.querySelector(".p0-review nav button") as HTMLButtonElement)
        ?.disabled,
    {},
    { timeout: 30000 },
  );
  assert.equal(
    validate((await invoke("snapshot")).xml).contentHash,
    validate(original.xml).contentHash,
  );
  await review.getByRole("button", { name: "放大对比" }).click();
  const previewFrames = page
    .frames()
    .filter((f) => f !== page.mainFrame() && f !== frame);
  assert.equal(previewFrames.length, 2);
  const views = await Promise.all(
    previewFrames.map((f) =>
      f.evaluate(() => (window as any).workbench.invoke("reviewView")),
    ),
  );
  assert.equal(views[0].scale, views[1].scale);
  await page.screenshot({ path: "artifacts/p0-layout-review.png" });
  await review.getByRole("button", { name: "关闭修改审阅" }).click();
  await panel.getByRole("button", { name: "应用排版" }).click();
  await panel.getByText("排版已应用，可一步撤销").waitFor();
  assert.notEqual(
    validate((await invoke("snapshot")).xml).contentHash,
    validate(original.xml).contentHash,
  );
  await panel.getByRole("button", { name: "关闭", exact: true }).click();
  await invoke("action", { name: "undo" });
  assert.equal(
    validate((await invoke("snapshot")).xml).contentHash,
    validate(original.xml).contentHash,
  );
  pass("真实双画布排版预览、同步缩放、应用和一次撤销");
  await page.getByRole("button", { name: "AI 会话", exact: true }).click();
  const chat = page.getByRole("complementary", { name: "AI 会话" });
  await chat.getByLabel("AI 绘图要求").fill("修改订单服务及字号");
  await chat.getByRole("button", { name: "发送给 AI" }).click();
  await chat.getByText(/项变化 · 待应用/).waitFor();
  await chat.getByRole("button", { name: "审阅修改", exact: true }).click();
  await page.waitForFunction(
    () =>
      !(document.querySelector(".p0-review nav button") as HTMLButtonElement)
        ?.disabled,
    {},
    { timeout: 30000 },
  );
  await review.getByRole("checkbox", { name: /样式/ }).uncheck();
  await review.getByRole("button", { name: "定位变化" }).first().click();
  await page.screenshot({ path: "artifacts/p0-ai-review.png" });
  await review.getByRole("button", { name: "生成所选修改预览" }).click();
  await chat
    .getByText("已保留非冲突人工修改，请重新预览所选修改后应用")
    .waitFor();
  assert.equal(
    await chat
      .getByRole("button", { name: "应用到画布", exact: true })
      .isDisabled(),
    true,
  );
  await chat.getByRole("button", { name: "预览候选", exact: true }).click();
  await page.getByAltText("AI 生成候选预览").waitFor();
  await page.waitForFunction(() => {
    const i = document.querySelector(
      'img[alt="AI 生成候选预览"]',
    ) as HTMLImageElement;
    return i?.complete && i.naturalWidth > 0;
  });
  await page.getByRole("button", { name: "关闭候选预览" }).click();
  await chat.getByRole("button", { name: "应用到画布", exact: true }).click();
  await chat.getByText("候选已应用，可一步撤销").waitFor();
  const result = validate((await invoke("snapshot")).xml);
  assert.ok(result.cells!.some((c) => c.label === "订单处理服务"));
  assert.ok(!result.cells!.some((c) => c.style.includes("fontSize=18")));
  pass("AI 差异高亮、定位、按操作组部分接受、重新预览门槛与应用");
  await chat.getByRole("button", { name: "历史与候选", exact: true }).click();
  const history = chat.getByRole("region", { name: "图稿会话历史" });
  await history.getByLabel("候选方案名称").fill("方案 B");
  await history.getByLabel("历史保留期限").selectOption("90");
  await history.getByRole("button", { name: "刷新与清理过期记录" }).click();
  await history.getByText("方案 B", { exact: true }).waitFor();
  await page.screenshot({ path: "artifacts/p0-history.png" });
  const origin = server.origin;
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.deleteDatabase("diagram-workbench");
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
        r.onblocked = () => resolve();
      }),
  );
  await page.goto("about:blank");
  await server.close();
  server = await startServer({
    port: Number(new URL(origin).port),
    dataDirectory: dir,
  });
  await page.goto(server.origin);
  await page.getByText("9 个节点 · 6 条连线").waitFor();
  frame = page.frames()[1];
  const draft = page.getByRole("dialog", { name: "恢复浏览器草稿" });
  if (await draft.isVisible())
    await draft.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "AI 会话", exact: true }).click();
  await chat.getByRole("button", { name: "历史与候选", exact: true }).click();
  await history.getByText("方案 B", { exact: true }).waitFor();
  await history.getByRole("button", { name: "接回候选 / 继续修改" }).click();
  await chat.getByText(/项变化 · 待应用/).waitFor();
  assert.equal(
    await chat
      .getByRole("button", { name: "应用到画布", exact: true })
      .isDisabled(),
    true,
  );
  pass("服务重启后会话、命名候选恢复；历史候选必须重新预览");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "artifacts/p0-e2e-results.json",
    JSON.stringify({ ok: true, checks, errors }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
