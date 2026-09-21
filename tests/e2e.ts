import { chromium, type Frame } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { startServer } from "../apps/local-server/server.ts";
import { validate } from "../packages/document-core/index.ts";
const server = await startServer({ port: 0 }),
  browser = await chromium.launch({ headless: true, channel: "chromium" });
const context = await browser.newContext({
    viewport: { width: 1512, height: 982 },
  }),
  page = await context.newPage();
const external: string[] = [],
  errors: string[] = [],
  checks: string[] = [];
await context.route("**/*", (r) => {
  const u = r.request().url();
  if (
    u.startsWith(server.origin + "/") ||
    u.startsWith(server.engine.origin + "/") ||
    u.startsWith("data:") ||
    u.startsWith("blob:")
  )
    return r.continue();
  external.push(u);
  return r.abort();
});
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (response) => {
  if (response.status() >= 400)
    errors.push(`HTTP ${response.status()}: ${response.url()}`);
});
page.on("dialog", (d) => void d.dismiss());
const check = (name: string) => {
  checks.push(name);
  console.log("PASS", name);
};
let frame: Frame;
const invoke = (method: string, args: any = {}) =>
  frame.evaluate(
    ({ method, args }) => (window as any).workbench.invoke(method, args),
    { method, args },
  );
const snap = async () => validate((await invoke("snapshot")).xml);
const waitState = async () => {
  await page.waitForTimeout(450);
};
try {
  assert.equal((await fetch(server.origin + "/api/capabilities")).status, 401);
  assert.equal(
    (
      await fetch(server.origin + "/api/capabilities", {
        headers: {
          Authorization: `Bearer ${server.token}`,
          Origin: "https://untrusted.example",
        },
      })
    ).status,
    403,
  );
  check("API authentication and cross-origin refusal");
  await page.goto(server.origin);
  await page.getByText("9 个节点 · 6 条连线").waitFor();
  frame = page.frames()[1];
  await frame.waitForFunction(() => !!(window as any).workbench);
  assert.equal((await snap()).ok, true);
  const canvasBounds = await frame.locator(".geDiagramContainer").boundingBox();
  const clientBounds = await frame
    .getByText("客户端", { exact: true })
    .boundingBox();
  assert.ok(canvasBounds && clientBounds);
  assert.ok(
    clientBounds.x >= canvasBounds.x && clientBounds.y >= canvasBounds.y,
    "initial diagram must fit inside viewport",
  );
  check("offline editor initialization and example load");
  await page
    .getByLabel("打开图稿文件")
    .setInputFiles("fixtures/examples/review.drawio");
  await page.getByText("原图中的服务名称需要人工确认。").waitFor();
  await page
    .getByRole("button", { name: "标记为已核对", exact: true })
    .first()
    .click();
  await waitState();
  assert.equal((await snap()).metadata!.reviewItems[0].status, "confirmed");
  check("review confirmation is persisted in native document");
  // Use a real canvas edit, not a surrogate app model.
  const service = frame.getByText("订单服务", { exact: true });
  await service.dblclick();
  const editor = frame.locator(".mxCellEditor");
  await editor.waitFor();
  await editor.fill("订单处理服务");
  await editor.press("ControlOrMeta+Enter");
  await page.getByRole("button", { name: "下载副本", exact: true }).focus();
  await invoke("snapshot");
  await waitState();
  assert.ok(
    (await snap()).cells!.some(
      (c) => c.id === "service" && c.label.includes("订单处理服务"),
    ),
  );
  assert.equal((await snap()).metadata!.reviewItems[0].status, "needsReview");
  check("actual text edit invalidates related confirmation");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await waitState();
  assert.equal(
    (await snap()).cells!.find((c) => c.id === "service")!.label,
    "订单服务",
  );
  assert.equal((await snap()).metadata!.reviewItems[0].status, "confirmed");
  check("undo restores text and review metadata atomically");
  await invoke("focus", { ids: ["service"] });
  const before = (await snap()).cells!.find((c) => c.id === "service")!;
  await frame
    .locator(".geDiagramContainer")
    .click({ position: { x: 25, y: 25 } });
  await invoke("focus", { ids: ["service"] });
  await page.keyboard.press("ArrowRight");
  await waitState();
  const moved = (await snap()).cells!.find((c) => c.id === "service")!;
  assert.notEqual(moved.geometry.x, before.geometry.x);
  assert.equal(
    (await snap()).cells!.find((c) => c.id === "e3")!.source,
    "service",
  );
  check("keyboard movement preserves bound edge references");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await waitState();
  await invoke("focus", { ids: ["service", "inventory"] });
  await invoke("action", { name: "group" });
  await waitState();
  let r = await snap();
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(
    r.cells!.find((c) => c.id === "service")!.parent,
    r.cells!.find((c) => c.id === "inventory")!.parent,
  );
  await invoke("action", { name: "undo" });
  check("grouping remains valid and reversible");
  await invoke("focus", { ids: ["group"] });
  await invoke("action", { name: "delete" });
  await page.getByRole("dialog", { name: "删除分组或容器" }).waitFor();
  await page.getByRole("button", { name: "解组并保留内容" }).click();
  await waitState();
  assert.ok((await snap()).cells!.find((c) => c.id === "service"));
  assert.equal(
    (await snap()).cells!.find((c) => c.id === "service")!.parent,
    "1",
  );
  await invoke("action", { name: "undo" });
  check(
    "container deletion asks how to handle children; ungroup keeps contents",
  );
  const latest = (await invoke("snapshot")).xml;
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载副本", exact: true }).click();
  const dl = await saved;
  await dl.saveAs("artifacts/browser-saved.drawio");
  const savedXml = await fs.readFile("artifacts/browser-saved.drawio", "utf8");
  assert.equal(validate(savedXml).ok, true);
  assert.equal(
    validate(latest).metadata!.documentId,
    validate(savedXml).metadata!.documentId,
  );
  check("downloaded native file round trip");
  await invoke("focus", { ids: ["service"] });
  await page.getByLabel("样式预设").selectOption("architecture");
  await waitState();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("button", { name: "创建空白画布", exact: true }).click();
  await page.getByRole("dialog", { name: "当前图稿还有未保存修改" }).waitFor();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  assert.ok((await snap()).cells!.some((c) => c.id === "service"));
  check("unsaved-change guard keeps current document");
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await page.getByRole("dialog", { name: "恢复浏览器草稿" }).waitFor();
  assert.ok(
    (await page.getByRole("button", { name: "恢复", exact: true }).count()) > 0,
  );
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  check("IndexedDB recovery draft is available");
  const pdf = page.waitForEvent("download", { timeout: 40000 });
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: "PDF 单页完整图稿" }).click();
  await page.getByRole("button", { name: "生成 PDF" }).click();
  await (await pdf).saveAs("artifacts/browser-export.pdf");
  assert.ok((await fs.stat("artifacts/browser-export.pdf")).size > 1000);
  check("browser PDF export produces a real local PDF");
  assert.match(await page.locator(".save-state").innerText(), /尚未保存/);
  check("export does not mark source file saved");
  await page
    .getByLabel("原始截图文件")
    .setInputFiles("fixtures/benchmark/images/01-flow.png");
  await page.getByAltText("用于人工核对的原始截图").waitFor();
  assert.ok(!(await invoke("snapshot")).xml.includes("data:image/png"));
  check("source comparison image is not embedded in source");
  await page
    .getByLabel("插入图片文件")
    .setInputFiles("fixtures/benchmark/images/01-flow.png");
  await page.waitForTimeout(500);
  const withImage = await snap();
  assert.equal(withImage.ok, true, JSON.stringify(withImage.errors));
  assert.ok(withImage.xml!.includes("data:image/png"));
  check("local PNG insertion remains self-contained and valid");
  const restored = await context.newPage();
  await restored.goto(server.origin);
  await restored.getByRole("dialog", { name: "恢复浏览器草稿" }).waitFor();
  await restored
    .getByRole("button", { name: "恢复", exact: true })
    .first()
    .click();
  await restored.getByText("已恢复草稿 · 请下载副本").waitFor();
  assert.match(await restored.locator(".save-state").innerText(), /尚未保存/);
  await restored.close();
  check("another page can explicitly recover a complete draft");
  await page.screenshot({
    path: "artifacts/workbench-tested.png",
    fullPage: true,
  });
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  check("no external requests or runtime errors");
  await fs.writeFile(
    "artifacts/e2e-results.json",
    JSON.stringify(
      { ok: true, checks, external, errors, browser: browser.version() },
      null,
      2,
    ),
  );
} catch (e) {
  await page.screenshot({ path: "artifacts/e2e-failure.png", fullPage: true });
  await fs.writeFile(
    "artifacts/e2e-results.json",
    JSON.stringify(
      { ok: false, checks, external, errors, error: String(e) },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await browser.close();
  await server.close();
}
