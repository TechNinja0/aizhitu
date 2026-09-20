import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { startEngine, editorUrl } from "../apps/local-server/engine.ts";
import { Renderer } from "../packages/render-worker/index.ts";
import { validate, emptyDocument } from "../packages/document-core/index.ts";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import os from "node:os";
const engine = await startEngine(),
  renderer = new Renderer(engine.origin),
  browser = await chromium.launch({ headless: true, channel: "chromium" }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const checks: string[] = [],
  measurements: Record<string, unknown> = {};
const check = (s: string) => {
  checks.push(s);
  console.log("PASS", s);
};
const invoke = (method: string, args: any = {}) =>
  page.evaluate(
    ({ method, args }) => (window as any).workbench.invoke(method, args),
    { method, args },
  );
const snap = async () => validate((await invoke("snapshot")).xml);
try {
  await page.goto(editorUrl(engine.origin));
  await page.waitForFunction(() => !!(window as any).workbench);
  const xml = await fs.readFile("fixtures/examples/review.drawio", "utf8");
  await invoke("load", { xml });
  const original = await snap();
  await page
    .locator(".geDiagramContainer")
    .click({ position: { x: 20, y: 20 } });
  await invoke("focus", { ids: ["client"] });
  await page.locator(".geDiagramContainer").evaluate((e: HTMLElement) => {
    e.tabIndex = 0;
    e.focus();
  });
  const interactions = [];
  for (let i = 0; i < 105; i++) {
    const t = performance.now();
    await invoke("preset", { name: i % 2 ? "default" : "flow" });
    interactions.push(performance.now() - t);
  }
  const moved = await snap();
  assert.match(
    moved.cells!.find((c) => c.id === "client")!.style,
    /fillColor=#fff6e4/,
  );
  for (let i = 0; i < 100; i++) await invoke("action", { name: "undo" });
  const undone = await snap();
  assert.match(
    undone.cells!.find((c) => c.id === "client")!.style,
    /fillColor=#fff6e4/,
  );
  assert.equal((await invoke("snapshot")).canUndo, false);
  check("100-step undo history retains the last 100 edits");
  await invoke("load", { xml });
  await invoke("focus", { ids: ["client"] });
  await invoke("action", { name: "delete" });
  let doc = await snap();
  assert.equal(doc.ok, true, JSON.stringify(doc.errors));
  assert.ok(!doc.cells!.find((c) => c.id === "client"));
  assert.ok(!doc.cells!.find((c) => c.id === "e1"));
  await invoke("action", { name: "undo" });
  assert.ok((await snap()).cells!.find((c) => c.id === "e1"));
  check("delete node and its edges is one undoable edit");
  await invoke("focus", { ids: ["service", "inventory"] });
  await invoke("action", { name: "duplicate" });
  doc = await snap();
  assert.equal(doc.ok, true, JSON.stringify(doc.errors));
  assert.equal(new Set(doc.cells!.map((c) => c.id)).size, doc.cells!.length);
  check("duplicate creates stable unique IDs");
  await invoke("load", { xml });
  await invoke("focus", { ids: ["client"] });
  await invoke("action", { name: "lockUnlock" });
  const locked = (await snap()).cells!.find((c) => c.id === "client")!;
  await invoke("preset", { name: "flow", all: true });
  const lockedAfter = (await snap()).cells!.find((c) => c.id === "client")!;
  assert.equal(locked.style, lockedAfter.style);
  check("locked objects are excluded from batch styles");
  await invoke("load", { xml });
  await invoke("focus", { ids: ["service", "inventory", "queue"] });
  await page.locator('.geFormatContainer div[title="排列"]').click();
  await page.locator('.geFormatContainer a[title="左"]:visible').click();
  const aligned = (await snap()).cells!.filter((c) =>
    ["service", "inventory", "queue"].includes(c.id),
  );
  assert.equal(new Set(aligned.map((c) => c.geometry.x)).size, 1);
  await page.locator('.geFormatContainer button[title="垂直"]:visible').click();
  const ys = (await snap())
    .cells!.filter((c) => ["service", "inventory", "queue"].includes(c.id))
    .map((c) => Number(c.geometry.y) + Number(c.geometry.height) / 2)
    .sort((a, b) => a - b);
  assert.ok(Math.abs(ys[1] - ys[0] - (ys[2] - ys[1])) < 1);
  await invoke("focus", { ids: ["service"] });
  const width = page.locator('.geFormatContainer input[title="宽"]:visible');
  await width.fill("210");
  await width.press("Enter");
  const resized = await snap();
  assert.equal(resized.ok, true, JSON.stringify(resized.errors));
  assert.equal(
    Number(resized.cells!.find((c) => c.id === "service")!.geometry.width),
    210,
  );
  assert.deepEqual(
    resized
      .cells!.filter((c) => c.kind === "edge")
      .map((c) => [c.id, c.source, c.target]),
    original
      .cells!.filter((c) => c.kind === "edge")
      .map((c) => [c.id, c.source, c.target]),
  );
  check("native align, distribute and resize preserve bound edge endpoints");
  const outputs: Record<string, Buffer> = {};
  for (const format of ["svg", "png", "pdf"] as const) {
    const r = await renderer.render(xml, {
      format,
      scale: 2,
      margin: 20,
      background: format === "png" ? "transparent" : "#ffffff",
    });
    outputs[format] = r.data;
    await fs.writeFile(`artifacts/capability.${format}`, r.data);
    assert.ok(r.width > 500 && r.height > 200);
  }
  assert.equal(outputs.png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.match(outputs.svg.toString(), /data:font\/woff2;base64/);
  assert.ok(
    !/https?:\/\//.test(
      outputs.svg.toString().replace(/http:\/\/www.w3.org\/[^"'\s]+/g, ""),
    ),
  );
  const alpha = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  }, outputs.png.toString("base64"));
  assert.equal(alpha, 0);
  check(
    "PNG transparency and self-contained SVG exports contain actual graph output",
  );
  const pdfTask = getDocument({
    data: new Uint8Array(outputs.pdf),
    useSystemFonts: false,
  });
  const pdf = await pdfTask.promise;
  assert.equal(pdf.numPages, 1);
  const pdfPage = await pdf.getPage(1),
    text = (await pdfPage.getTextContent()).items
      .map((i: any) => i.str)
      .join("");
  assert.match(text, /订单服务/);
  assert.match(text, /库存服务/);
  assert.match(text, /数据库/);
  const ops = await pdfPage.getOperatorList();
  assert.ok(ops.fnArray.length > 50);
  await pdfTask.destroy();
  check("single-page PDF preserves searchable Chinese text");
  const selected = await renderer.render(xml, {
    format: "svg",
    selection: ["service"],
    margin: 10,
  });
  const selectedSvg = selected.data.toString();
  assert.match(selectedSvg, /订单服务/);
  assert.doesNotMatch(selectedSvg, /客户端|库存服务|订单数据库/);
  check("selection export excludes unselected objects");
  const beforeExport = await invoke("snapshot");
  await invoke("svg", { selection: ["service"], margin: 10 });
  const afterExport = await invoke("snapshot");
  assert.equal(beforeExport.xml, afterExport.xml);
  assert.deepEqual(beforeExport.selection, afterExport.selection);
  check("export leaves graph, selection and undo state unchanged");
  await assert.rejects(renderer.render(xml, { format: "png", scale: 99 }));
  await assert.rejects(
    renderer.render(xml, { format: "png", selection: ["missing"] }),
  );
  check("invalid export options and missing selections are rejected");
  // Fixed 200-node, 300-edge performance fixture. Geometry varies independently from labels.
  let cells = "";
  for (let i = 0; i < 200; i++)
    cells += `<mxCell id="n${i}" value="节点 ${i}" vertex="1" parent="1" style="rounded=1;html=0;fontFamily=Noto Sans SC;fontSize=12;"><mxGeometry x="${(i % 20) * 100}" y="${Math.floor(i / 20) * 70}" width="80" height="40" as="geometry"/></mxCell>`;
  for (let i = 0; i < 300; i++)
    cells += `<mxCell id="e${i}" edge="1" parent="1" source="n${i % 200}" target="n${(i + 1 + (i >= 200 ? 19 : 0)) % 200}" style="edgeStyle=orthogonalEdgeStyle;endArrow=block;"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  const large = emptyDocument("200节点300边").replace(
    "</root>",
    cells + "</root>",
  );
  await fs.writeFile("fixtures/performance.drawio", large);
  assert.equal(validate(large).ok, true);
  const times: Record<string, number[]> = { open: [], png: [], pdf: [] };
  await invoke("load", { xml: large });
  await invoke("focus", { ids: ["n0"] });
  measurements.smallDocumentInteractionP95ms = [...interactions].sort(
    (a, b) => a - b,
  )[99];
  interactions.length = 0;
  for (let i = 0; i < 100; i++) {
    const started = performance.now();
    await invoke("preset", { name: i % 2 ? "default" : "flow" });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    interactions.push(performance.now() - started);
  }
  await renderer.render(large, { format: "png", scale: 2 });
  await renderer.render(large, { format: "pdf" });
  for (let i = 0; i < 10; i++) {
    let t = performance.now();
    await invoke("load", { xml: large });
    times.open.push(performance.now() - t);
    for (const f of ["png", "pdf"] as const) {
      t = performance.now();
      await renderer.render(large, { format: f, scale: 2 });
      times[f].push(performance.now() - t);
    }
  }
  const p95 = (a: number[]) =>
    [...a].sort((a, b) => a - b)[Math.ceil(a.length * 0.95) - 1];
  measurements.times = times;
  measurements.p95ms = {
    open: p95(times.open),
    png: p95(times.png),
    pdf: p95(times.pdf),
    interaction: p95(interactions),
  };
  console.log("PERFORMANCE", measurements.p95ms);
  assert.ok(p95(times.open) <= 3000);
  assert.ok(p95(times.png) <= 10000);
  assert.ok(p95(times.pdf) <= 10000);
  assert.ok(p95(interactions) <= 100);
  check("200-node/300-edge performance thresholds and interaction P95");
  assert.deepEqual(renderer.requests, []);
  check("rendering has no external network dependencies");
  await fs.writeFile(
    "artifacts/capabilities-results.json",
    JSON.stringify(
      {
        ok: true,
        checks,
        measurements,
        environment: {
          os: os.platform() + " " + os.release(),
          cpu: os.cpus()[0]?.model,
          memoryGB: os.totalmem() / 1024 ** 3,
          node: process.version,
          browser: browser.version(),
        },
      },
      null,
      2,
    ),
  );
} catch (e) {
  await fs.writeFile(
    "artifacts/capabilities-results.json",
    JSON.stringify(
      { ok: false, checks, measurements, error: String(e) },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await browser.close();
  await renderer.close();
  await new Promise<void>((r) => engine.server.close(() => r()));
}
