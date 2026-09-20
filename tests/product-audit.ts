import { chromium, type Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { AIService } from "../packages/ai-service/index.ts";
import { startServer } from "../apps/local-server/server.ts";
import { validate } from "../packages/document-core/index.ts";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-product-audit-"));
let release: (() => void) | undefined,
  hold = false;
const ai = await new AIService(dir, async (_file, args, o) => {
  if (args[0] === "--version") return "audit-cli 1.0";
  if (hold)
    await new Promise<void>((r, j) => {
      release = r;
      o.signal!.addEventListener("abort", () => j(Error("cancelled")), {
        once: true,
      });
    });
  const input = o.input || "";
  const xml = input.includes("当前完整图稿：")
    ? input.split("当前完整图稿：\n")[1].split("\n用户需求：")[0]
    : "";
  const answer = xml
    ? xml.replace('value="订单服务"', 'value="订单处理服务"')
    : "ZHITU_OK";
  if (args[0] === "exec") {
    await fs.writeFile(args[args.indexOf("-o") + 1], answer);
    return "{}";
  }
  return JSON.stringify({ result: answer });
}).init();
await ai.save({
  defaultProvider: "codex",
  providers: {
    codex: { path: process.execPath, model: "" },
    qoder: { path: process.execPath, model: "" },
  },
});
const server = await startServer({ port: 0, aiService: ai }),
  browser = await chromium.launch({ channel: "chromium" });
const checks: string[] = [],
  errors: string[] = [];
const check = (s: string) => {
  checks.push(s);
  console.log("PASS", s);
};
async function open() {
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await p.addInitScript({ content: "window.__name = (fn) => fn;" });
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => void d.accept());
  await p.goto(server.origin);
  await p.getByText("9 个节点 · 6 条连线").waitFor();
  return p;
}
const invoke = (p: Page, m: string, args: any = {}) =>
  p
    .frames()[1]
    .evaluate(({ m, args }) => (window as any).workbench.invoke(m, args), {
      m,
      args,
    });
async function reload(p: Page) {
  await p.reload();
  await p.getByText("9 个节点 · 6 条连线").waitFor();
  await p.waitForTimeout(150);
  const modal = p.getByRole("dialog", { name: "恢复浏览器草稿" });
  if (await modal.count())
    await modal.getByRole("button", { name: "关闭", exact: true }).click();
}
try {
  const p = await open();
  await p.getByRole("button", { name: "设置", exact: true }).click();
  let settings = p.getByRole("dialog", { name: "AI 客户端设置" });
  await settings.getByLabel("Qoder 默认模型").selectOption("Qwen3.8-Flash");
  await settings
    .getByRole("button", { name: "检测 Codex（不调用模型）" })
    .click();
  await settings.getByText("audit-cli 1.0", { exact: true }).waitFor();
  assert.equal(ai.config.providers.qoder.model, "");
  assert.equal(
    await settings
      .getByRole("button", { name: "测试 AI 连接（消耗少量额度）" })
      .isDisabled(),
    true,
  );
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  await p.getByRole("button", { name: "设置", exact: true }).click();
  await p.waitForTimeout(100);
  assert.equal(
    await settings.getByLabel("Qoder 默认模型").inputValue(),
    "Auto",
  );
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  check(
    "client detection never saves draft settings; reopening discards unsaved fields",
  );
  await p.getByRole("button", { name: "查找对象", exact: true }).click();
  const search = p.getByRole("dialog", { name: "查找图稿对象" });
  await search.getByLabel("查找文字或对象 ID").fill("订单服务");
  await search
    .getByRole("button", { name: "订单服务 节点 · service", exact: true })
    .click();
  await search.waitFor({ state: "hidden" });
  let snap = await invoke(p, "snapshot");
  assert.equal(snap.selection.length, 1);
  assert.equal(
    validate(snap.xml).cells!.find((c) => c.id === snap.selection[0])!.label,
    "订单服务",
  );
  check("object search selects and focuses the matching structured node");
  const baseline = validate(snap.xml).contentHash;
  await p.getByRole("button", { name: "版本记录", exact: true }).click();
  let versions = p.getByRole("dialog", { name: "本地版本记录" });
  await versions.getByLabel("版本说明").fill("评审前");
  await versions.getByRole("button", { name: "保存当前版本" }).click();
  await versions.getByText("版本已保存", { exact: true }).waitFor();
  await versions.getByRole("button", { name: "关闭", exact: true }).click();
  await invoke(p, "focus", { ids: [] });
  await invoke(p, "beautify");
  const edited = validate((await invoke(p, "snapshot")).xml).contentHash;
  assert.notEqual(edited, baseline);
  await p.getByRole("button", { name: "版本记录", exact: true }).click();
  await versions
    .getByRole("article")
    .filter({ hasText: "评审前" })
    .getByRole("button", { name: "恢复此版本" })
    .click();
  await versions
    .getByText("已恢复版本，可一步撤销；恢复前画布也已备份。")
    .waitFor();
  await fs.writeFile("artifacts/version-before.drawio", snap.xml);
  await fs.writeFile(
    "artifacts/version-after.drawio",
    (await invoke(p, "snapshot")).xml,
  );
  assert.equal(
    validate((await invoke(p, "snapshot")).xml).contentHash,
    baseline,
  );
  await versions.getByRole("button", { name: "关闭", exact: true }).click();
  await invoke(p, "action", { name: "undo" });
  assert.equal(validate((await invoke(p, "snapshot")).xml).contentHash, edited);
  await reload(p);
  await p.getByRole("button", { name: "版本记录", exact: true }).click();
  await versions.getByRole("article").filter({ hasText: "评审前" }).waitFor();
  assert.equal(await versions.getByRole("article").count(), 2);
  check(
    "version restore preserves a pre-restore backup, supports undo and survives refresh",
  );
  await versions.getByRole("button", { name: "关闭", exact: true }).click();
  const importBase = await invoke(p, "snapshot");
  await p.getByLabel("候选图稿文件").setInputFiles({
    name: "candidate.drawio",
    mimeType: "application/xml",
    buffer: Buffer.from(
      importBase.xml.replace('value="订单服务"', 'value="外部候选验证"'),
    ),
  });
  const review = p.getByRole("dialog", { name: "AI 候选差异" });
  await review.waitFor();
  assert.equal(
    await review
      .getByRole("button", { name: "应用候选（可一步撤销）" })
      .isDisabled(),
    true,
  );
  await review.getByRole("button", { name: "预览候选图" }).click();
  await review.getByAltText("AI 候选图稿预览").waitFor();
  await review
    .getByRole("button", { name: "关闭候选预览", exact: true })
    .click();
  await review.getByRole("button", { name: "应用候选（可一步撤销）" }).click();
  await review.waitFor({ state: "hidden" });
  assert.ok((await invoke(p, "snapshot")).xml.includes("外部候选验证"));
  await invoke(p, "action", { name: "undo" });
  assert.equal(
    validate((await invoke(p, "snapshot")).xml).contentHash,
    validate(importBase.xml).contentHash,
  );
  await p.getByRole("button", { name: "版本记录", exact: true }).click();
  await versions.getByText("外部候选应用前自动备份", { exact: true }).waitFor();
  check(
    "external candidates require preview, preserve unrelated structure and save an automatic backup",
  );
  for (let i = 0; i < 22; i++) {
    await versions.getByLabel("版本说明").fill("版本-" + i);
    await versions.getByRole("button", { name: "保存当前版本" }).click();
    await versions
      .getByRole("article")
      .filter({ hasText: "版本-" + i })
      .last()
      .waitFor();
  }
  assert.equal(await versions.getByRole("article").count(), 20);
  assert.equal(await versions.getByText("评审前", { exact: true }).count(), 0);
  check(
    "per-document version retention is bounded to the latest 20 checkpoints",
  );
  await versions.getByRole("button", { name: "关闭", exact: true }).click();
  const { build } = await import("esbuild");
  const storageCode = (
    await build({
      entryPoints: ["apps/workbench/src/versions.ts"],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "auditVersions",
    })
  ).outputFiles[0].text;
  await p.addScriptTag({ content: storageCode });
  const counts = await p.evaluate(async () => {
    const v = (window as any).auditVersions;
    const xml = "x".repeat(14 * 1024 * 1024);
    for (const id of ["quota-a", "quota-b", "quota-c"])
      await v.addVersion({
        documentId: id,
        name: "quota.drawio",
        label: id,
        xml,
      });
    return Promise.all(
      ["quota-a", "quota-b", "quota-c"].map(
        async (id) => (await v.listVersions(id)).length,
      ),
    );
  });
  assert.deepEqual(counts, [0, 1, 1]);
  check(
    "global version storage evicts the oldest records across documents above 40 MiB",
  );
  await p.close();
  for (const phase of ["picker", "write"]) {
    const q = await open();
    await q.evaluate((phase) => {
      const w = window as any;
      w.audit = { writes: 0, closes: 0, aborts: 0 };
      const handle = {
        name: "original.drawio",
        createWritable: async () => ({
          write: async () => {
            w.audit.writes++;
            if (phase === "write")
              await new Promise((r) => (w.finishWrite = r));
          },
          close: async () => {
            w.audit.closes++;
          },
          abort: async () => {
            w.audit.aborts++;
          },
        }),
      };
      w.showSaveFilePicker =
        phase === "picker"
          ? () => new Promise((r) => (w.finishPicker = () => r(handle)))
          : async () => handle;
    }, phase);
    await q.getByRole("button", { name: "保存到文件", exact: true }).click();
    await q.waitForFunction(
      (phase) =>
        phase === "picker"
          ? !!(window as any).finishPicker
          : !!(window as any).finishWrite,
      phase,
    );
    await q.getByRole("button", { name: "新建", exact: true }).click();
    await q.getByRole("button", { name: "创建空白画布", exact: true }).click();
    await q.getByLabel("图稿文件名").waitFor();
    for (
      let i = 0;
      i < 30 &&
      (await q.getByLabel("图稿文件名").inputValue()) !== "未命名图稿.drawio";
      i++
    )
      await q.waitForTimeout(100);
    await q.evaluate(
      (phase) =>
        phase === "picker"
          ? (window as any).finishPicker()
          : (window as any).finishWrite(),
      phase,
    );
    await q
      .getByText("保存期间已切换图稿，本次写入已取消", { exact: true })
      .waitFor();
    const result = await q.evaluate(() => (window as any).audit);
    assert.equal(result.closes, 0);
    assert.equal(result.writes, phase === "picker" ? 0 : 1);
    assert.equal(result.aborts, phase === "write" ? 1 : 0);
    await q.close();
  }
  check(
    "switching documents during file picker or write aborts without committing to the wrong file",
  );
  const r = await open();
  await invoke(r, "beautify");
  await invoke(r, "action", { name: "undo" });
  hold = true;
  await r.getByRole("button", { name: "AI 会话", exact: true }).click();
  let panel = r.getByRole("complementary", { name: "AI 会话" });
  await panel.getByLabel("AI 绘图要求").fill("刷新后接回的改名任务");
  await panel.getByRole("button", { name: "发送给 AI" }).click();
  await panel.getByRole("button", { name: "取消任务", exact: true }).waitFor();
  await reload(r);
  await r.getByRole("button", { name: "AI 会话", exact: true }).click();
  await panel
    .getByRole("button", { name: "最近 AI 任务", exact: true })
    .click();
  await panel
    .getByRole("region", { name: "最近 AI 任务" })
    .getByRole("article")
    .filter({ hasText: "刷新后接回的改名任务" })
    .getByRole("button", { name: "接回任务" })
    .click();
  await panel.getByText("已接回任务，继续等待结果").waitFor();
  hold = false;
  release!();
  await panel.getByText(/项变化 · 待应用/).waitFor();
  await panel.getByRole("button", { name: "预览候选", exact: true }).click();
  await panel.getByAltText("AI 生成候选预览").waitFor();
  await panel
    .getByRole("button", { name: "关闭候选预览", exact: true })
    .click();
  await panel.getByRole("button", { name: "应用到画布" }).click();
  await panel.getByText("候选已应用，可一步撤销").waitFor();
  assert.ok((await invoke(r, "snapshot")).xml.includes("订单处理服务"));
  await r.getByRole("button", { name: "版本记录", exact: true }).click();
  await r
    .getByRole("dialog", { name: "本地版本记录" })
    .getByText("AI 应用前自动备份", { exact: true })
    .waitFor();
  await r
    .getByRole("dialog", { name: "本地版本记录" })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  check(
    "running AI task survives refresh, safely rebinds revisions and creates pre-apply backup",
  );
  hold = true;
  await panel.getByLabel("AI 绘图要求").fill("需要保留的取消要求");
  await panel.getByRole("button", { name: "发送给 AI" }).click();
  await panel.getByRole("button", { name: "取消任务", exact: true }).click();
  await panel.getByText("任务已取消", { exact: true }).waitFor();
  assert.equal(
    await panel.getByLabel("AI 绘图要求").inputValue(),
    "需要保留的取消要求",
  );
  check("cancel preserves original prompt for editing and retry");
  const png = (
    await fs.readFile("fixtures/benchmark/images/01-flow.png")
  ).toString("base64");
  await panel.getByLabel("AI 绘图要求").evaluate((element, base64) => {
    const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([data], "pasted.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await panel
    .getByRole("button", { name: "pasted.png ×", exact: true })
    .waitFor();
  await panel
    .getByRole("button", { name: "pasted.png ×", exact: true })
    .click();
  await panel.locator(".ai-compose").evaluate((element, base64) => {
    const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([data], "dropped.png", { type: "image/png" }));
    element.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await panel
    .getByRole("button", { name: "dropped.png ×", exact: true })
    .waitFor();
  check(
    "clipboard paste and file drop both attach a validated PNG without invoking AI",
  );
  await r.screenshot({
    path: "artifacts/product-audit-ui.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  check("new flows produce no browser runtime errors");
  await fs.writeFile(
    "artifacts/product-audit-results.json",
    JSON.stringify({ ok: true, checks }, null, 2),
  );
} finally {
  hold = false;
  release?.();
  await browser.close();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
