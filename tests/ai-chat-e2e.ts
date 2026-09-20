import { chromium } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { AIService } from "../packages/ai-service/index.ts";
import { startServer } from "../apps/local-server/server.ts";
import { validate } from "../packages/document-core/index.ts";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-chat-e2e-"));
let delayed = false;
let hold = false;
let release: (() => void) | undefined;
let received = "";
const ai = await new AIService(dir, async (_file, args, o) => {
  if (args[0] === "--version") return "test-cli 1.0";
  received = o.input || "";
  if (hold) await new Promise<void>(resolve => { release = resolve; });
  if (delayed)
    o.onStdout?.(
      JSON.stringify({
        type: "stream_event",
        event: { delta: { type: "text_delta", text: "<mxfile>" } },
      }) + "\n",
    );
  if (delayed)
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 3000);
      o.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(Error("cancelled"));
        },
        { once: true },
      );
    });
  let answer = "ZHITU_OK";
  if (o.input?.includes("当前完整图稿：")) {
    const xml = o.input.split("当前完整图稿：\n")[1].split("\n用户需求：")[0];
    answer = xml.replace('value="订单服务"', 'value="订单处理服务"');
  }
  if (args[0] === "exec") {
    await fs.writeFile(args[args.indexOf("-o") + 1], answer);
    return "{}";
  }
  return JSON.stringify({ type: "result", result: answer });
}).init();
await ai.save({
  defaultProvider: "codex",
  providers: {
    codex: { path: process.execPath, model: "" },
    qoder: { path: process.execPath, model: "" },
  },
});
const server = await startServer({ port: 0, aiService: ai }),
  browser = await chromium.launch({ channel: "chromium" }),
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  checks: string[] = [];
const check = (s: string) => {
  checks.push(s);
  console.log("PASS", s);
};
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  assert.equal((await fetch(server.origin + "/api/ai/settings")).status, 401);
  assert.equal(
    (
      await fetch(server.origin + "/api/ai/settings", {
        headers: {
          Authorization: "Bearer " + server.token,
          Origin: "https://evil.example",
        },
      })
    ).status,
    403,
  );
  check(
    "AI configuration and execution APIs require local session authorization",
  );
  await page.goto(server.origin);
  await page.getByText("9 个节点 · 6 条连线").waitFor();
  const frame = page.frames()[1],
    invoke = (method: string, args: any = {}) =>
      frame.evaluate(
        ({ method, args }) => (window as any).workbench.invoke(method, args),
        { method, args },
      );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "AI 客户端设置" });
  await settings
    .getByRole("button", { name: "检测 Codex（不调用模型）" })
    .click();
  await settings.getByText("test-cli 1.0", { exact: true }).waitFor();
  await settings
    .getByRole("button", { name: "测试 AI 连接（消耗少量额度）" })
    .click();
  await settings.getByText(/AI 连接测试通过/).waitFor();
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "AI 会话", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "AI 会话" });
  await panel.getByText("AI 已连接", { exact: true }).waitFor();
  check(
    "settings detect without model, explicit AI probe updates conversation status",
  );
  assert.equal(await panel.getByLabel("会话模型", { exact: true }).count(), 0);
  await panel.getByLabel("会话 AI 客户端").selectOption("qoder");
  assert.deepEqual(
    await panel
      .getByLabel("会话模型", { exact: true })
      .locator("option")
      .allTextContents(),
    [
      "Auto",
      "Qwen3.8-Max",
      "Qwen3.8-Flash",
      "Qwen3.7-Max",
      "Qwen3.7-Plus",
      "Kimi-K3",
      "Kimi-K2.8-Preview",
      "GLM-5.3",
    ],
  );
  await panel
    .getByLabel("会话模型", { exact: true })
    .selectOption("Qwen3.8-Flash");
  const inputBox = await panel.getByLabel("AI 绘图要求").boundingBox(),
    modelBox = await panel
      .getByLabel("会话模型", { exact: true })
      .boundingBox();
  assert.ok(modelBox!.y >= inputBox!.y + inputBox!.height);
  await panel.getByLabel("会话 AI 客户端").selectOption("codex");
  check(
    "Qoder has requested model choices below input; Codex inherits local model",
  );
  const zoomBase = await invoke("snapshot");
  await page.getByRole("button", { name: "放大画布", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="恢复 100% 缩放"]')?.textContent !==
      "100%",
  );
  assert.ok((await invoke("snapshot")).zoom > zoomBase.zoom);
  await page
    .getByRole("button", { name: "恢复 100% 缩放", exact: true })
    .click();
  const canvas = frame.locator(".geDiagramContainer");
  const bounds = await canvas.boundingBox();
  await page.mouse.move(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height / 2,
  );
  const topBefore = await canvas.evaluate(e => e.scrollTop);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(200);
  assert.equal((await invoke("snapshot")).zoom, 1);
  assert.ok(await canvas.evaluate(e => e.scrollTop) > topBefore);
  await page.keyboard.down("Meta");
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(150);
  const wheelZoom = await invoke("snapshot");
  assert.ok(wheelZoom.zoom > 1);
  assert.equal(wheelZoom.revision, zoomBase.revision);
  assert.equal(
    validate(wheelZoom.xml).contentHash,
    validate(zoomBase.xml).contentHash,
  );
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(150);
  assert.ok((await invoke("snapshot")).zoom < wheelZoom.zoom);
  await page.keyboard.up("Meta");
  // Space works even if the last focused element was a workbench toolbar button.
  const scrollBeforeSpace = await canvas.evaluate(e => e.scrollTop);
  await page.keyboard.down("Space");
  await frame.waitForFunction(() => document.querySelector(".geDiagramContainer")?.classList.contains("workbench-pan"));
  await page.waitForTimeout(150);
  assert.equal(await canvas.evaluate(e => e.scrollTop), scrollBeforeSpace);
  const node = frame.getByText("订单服务", {exact:true});
  await node.scrollIntoViewIfNeeded();
  const point = await node.boundingBox();assert.ok(point);
  const beforePan = await canvas.evaluate(e => ({left:e.scrollLeft,top:e.scrollTop}));
  await page.mouse.move(point.x+point.width/2, point.y+point.height/2);
  await page.mouse.down();
  await page.mouse.move(point.x+point.width/2-60, point.y+point.height/2-60, {steps:8});
  await page.mouse.up();await page.keyboard.up("Space");
  const afterPan = await canvas.evaluate(e => ({left:e.scrollLeft,top:e.scrollTop}));
  assert.notDeepEqual(afterPan,beforePan);
  assert.equal(await canvas.evaluate(e => e.classList.contains("workbench-pan")),false);
  const panResult=await invoke("snapshot");
  assert.equal(panResult.revision,zoomBase.revision);
  assert.equal(validate(panResult.xml).contentHash,validate(zoomBase.xml).contentHash);
  assert.equal(panResult.canUndo,zoomBase.canUndo);
  await panel.getByLabel("AI 绘图要求").fill("a");
  await page.keyboard.press("Space");
  assert.equal(await panel.getByLabel("AI 绘图要求").inputValue(),"a ");
  await panel.getByLabel("AI 绘图要求").fill("");
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  await page
    .getByRole("button", { name: "恢复 100% 缩放", exact: true })
    .click();
  check(
    "plain wheel scrolls, Command+wheel zooms, Space+drag pans over nodes; text input and document history preserved",
  );
  const base = await invoke("snapshot");
  const baseHash = validate(base.xml).contentHash;
  async function send() {
    await panel.getByLabel("AI 绘图要求").fill("将订单服务改为订单处理服务");
    await panel.getByRole("button", { name: "发送给 AI" }).click();
    await panel.getByText(/项变化 · 待应用/).waitFor();
  }
  async function preview() {
    await panel.getByRole("button", { name: "预览候选", exact: true }).click();
    await panel.getByAltText("AI 生成候选预览").waitFor();
    await panel.getByRole("button",{name:"关闭候选预览",exact:true}).click();
    await panel
      .getByRole("button", { name: "应用到画布" })
      .waitFor({ state: "visible" });
  }
  await send();
  assert.ok(received.includes(base.metadata.documentId));
  assert.equal(validate((await invoke("snapshot")).xml).contentHash, baseHash);
  assert.equal(
    await panel.getByRole("button", { name: "应用到画布" }).isDisabled(),
    true,
  );
  await preview();
  await panel.getByRole("button", { name: "应用到画布" }).click();
  await panel.getByText("候选已应用，可一步撤销").waitFor();
  assert.ok((await invoke("snapshot")).xml.includes("订单处理服务"));
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  for (
    let i = 0;
    i < 30 && validate((await invoke("snapshot")).xml).contentHash !== baseHash;
    i++
  )
    await page.waitForTimeout(100);
  assert.equal(validate((await invoke("snapshot")).xml).contentHash, baseHash);
  check(
    "chat captures unsaved canvas, requires preview, applies candidate and undoes atomically",
  );
  await send();
  await invoke("beautify");
  const changedHash = validate((await invoke("snapshot")).xml).contentHash;
  await preview();
  await panel.getByRole("button", { name: "应用到画布" }).click();
  const overwrite = page.getByRole("dialog", { name: "图稿已变化", exact: true });
  await overwrite.waitFor();
  assert.equal(
    validate((await invoke("snapshot")).xml).contentHash,
    changedHash,
  );
  await overwrite.getByRole("button", { name: "保留当前图稿" }).click();
  assert.equal(validate((await invoke("snapshot")).xml).contentHash, changedHash);
  await panel.getByText(/项变化 · 待应用/).waitFor();
  check("stale candidates require explicit overwrite; declining preserves canvas and candidate");

  // Completed tasks can be recovered even when the original canvas has changed.
  await panel.getByRole("button", { name: "丢弃", exact: true }).click();
  await panel.getByRole("button", { name: "最近 AI 任务", exact: true }).click();
  await panel.getByRole("region", { name: "最近 AI 任务" })
    .getByRole("article").filter({ hasText: "将订单服务改为订单处理服务" })
    .first().getByRole("button", { name: "接回任务" }).click();
  await panel.getByText("原稿已变化，候选已接回；预览后可选择强制覆盖").waitFor();
  assert.equal(await panel.getByRole("button", { name: "应用到画布" }).isDisabled(), true);
  await preview();
  await panel.getByRole("button", { name: "应用到画布" }).click();
  await overwrite.waitFor();
  await page.screenshot({ path: "artifacts/ai-chat-overwrite.png", fullPage: true });
  await overwrite.getByRole("button", { name: "强制覆盖", exact: true }).click();
  await panel.getByText("候选已强制覆盖，原稿已自动备份，可一步撤销").waitFor();
  const appliedHash = validate((await invoke("snapshot")).xml).contentHash;
  assert.ok((await invoke("snapshot")).xml.includes("订单处理服务"));
  assert.notEqual(appliedHash, changedHash);
  const backups = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("diagram-versions", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<any[]>((resolve, reject) => {
        const r = db.transaction("versions").objectStore("versions").getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally { db.close(); }
  });
  const backup = backups.find(v => v.label === "AI 强制覆盖前自动备份");
  assert.ok(backup);
  assert.equal(validate(backup.xml).contentHash, changedHash);
  await invoke("action", { name: "undo" });
  assert.equal(validate((await invoke("snapshot")).xml).contentHash, changedHash);
  check("recovered stale candidate can overwrite explicitly, backs up latest edits and undoes in one step");

  // A change after opening the confirmation requires a fresh confirmation.
  await invoke("action", { name: "undo" });
  assert.equal(validate((await invoke("snapshot")).xml).contentHash, baseHash);
  await send();
  await invoke("beautify");
  await preview();
  await panel.getByRole("button", { name: "应用到画布" }).click();
  await overwrite.waitFor();
  await invoke("action", { name: "undo" });
  await overwrite.getByRole("button", { name: "强制覆盖", exact: true }).click();
  await panel.getByText("确认期间图稿再次变化，请重新确认覆盖").waitFor();
  assert.equal(validate((await invoke("snapshot")).xml).contentHash, baseHash);
  await overwrite.getByRole("button", { name: "强制覆盖", exact: true }).click();
  await panel.getByText("候选已强制覆盖，原稿已自动备份，可一步撤销").waitFor();
  assert.equal(validate((await invoke("snapshot")).xml).contentHash, appliedHash);
  await invoke("action", { name: "undo" });
  assert.equal(validate((await invoke("snapshot")).xml).contentHash, baseHash);
  await invoke("beautify");
  assert.equal(validate((await invoke("snapshot")).xml).contentHash, changedHash);
  check("changes during overwrite confirmation require reconfirmation and preserve atomic undo");
  delayed = true;
  await panel.getByLabel("AI 绘图要求").fill("取消测试");
  await panel.getByRole("button", { name: "发送给 AI" }).click();
  await panel.locator(".ai-user").filter({ hasText: "取消测试" }).waitFor();
  await panel
    .locator(".ai-progress summary")
    .filter({ hasText: "已生成 8 个字符" })
    .waitFor();
  assert.equal(
    await panel.locator(".ai-user").filter({ hasText: "取消测试" }).count(),
    1,
  );
  await page.screenshot({ path: "artifacts/ai-chat-running.png" });
  check("user message appears during generation with live execution progress");
  await panel.getByRole("button", { name: "取消任务" }).click();
  await panel.getByText("任务已取消", { exact: true }).waitFor();
  assert.equal(
    validate((await invoke("snapshot")).xml).contentHash,
    changedHash,
  );
  check("cancel stops CLI and preserves current diagram");
  delayed = false;
  hold = true;
  ai.generate({ provider: "codex", prompt: "接回等待中的过期候选", xml: base.xml, revision: base.revision, mode: "edit" });
  await panel.getByRole("button", { name: "最近 AI 任务", exact: true }).click();
  await panel.getByRole("region", { name: "最近 AI 任务" })
    .getByRole("article").filter({ hasText: "接回等待中的过期候选" })
    .getByRole("button", { name: "接回任务" }).click();
  await panel.getByText("已接回任务，继续等待结果").waitFor();
  assert.ok(release);
  hold = false;
  release();
  await panel.getByText("原稿已变化，候选已保留；预览后可选择强制覆盖").waitFor();
  assert.equal(validate((await invoke("snapshot")).xml).contentHash, changedHash);
  assert.equal(await panel.getByRole("button", { name: "应用到画布" }).isDisabled(), true);
  await preview();
  await panel.getByRole("button", { name: "应用到画布" }).click();
  await overwrite.waitFor();
  await page.keyboard.press("Escape");
  await overwrite.waitFor({ state: "hidden" });
  assert.equal(validate((await invoke("snapshot")).xml).contentHash, changedHash);
  check("running task recovery preserves stale result for preview and explicit overwrite; Escape cancels confirmation");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "artifacts/ai-chat-ui.png", fullPage: true });
  check("conversation UI has no browser runtime errors");
  await fs.writeFile(
    "artifacts/ai-chat-e2e.json",
    JSON.stringify({ ok: true, checks }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
