import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { startEngine, editorUrl } from "../apps/local-server/engine.ts";
import { validate, emptyDocument } from "../packages/document-core/index.ts";
const e = await startEngine(),
  b = await chromium.launch({ channel: "chromium" }),
  p = await b.newPage({ viewport: { width: 1440, height: 1000 } }),
  checks: string[] = [];
const invoke = (method: string, args: any = {}) =>
  p.evaluate(
    ({ method, args }) => (window as any).workbench.invoke(method, args),
    { method, args },
  );
const snap = async () => validate((await invoke("snapshot")).xml);
const check = (s: string) => {
  checks.push(s);
  console.log("PASS", s);
};
try {
  await p.goto(editorUrl(e.origin));
  await p.waitForFunction(() => !!(window as any).workbench);
  await invoke("load", { xml: emptyDocument() });
  await p.locator(".geSidebar a.geItem").first().click();
  assert.equal((await snap()).stats.nodes, 1);
  check("native palette creates an editable primitive");
  await invoke("load", {
    xml: await fs.readFile("fixtures/examples/flow.drawio", "utf8"),
  });
  await p.waitForTimeout(500);
  await invoke("focus", { ids: ["f5"] });
  await p.waitForTimeout(250);
  const handle = p
    .locator(
      '.geDiagramContainer svg g[style*="cursor: pointer"] image[width="22"]',
    )
    .last();
  const from = await handle.boundingBox(),
    to = await p.getByText("审批完成", { exact: true }).boundingBox();
  assert.ok(from && to);
  await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await p.mouse.down();
  await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await p.mouse.up();
  let doc = await snap();
  assert.equal(doc.ok, true, JSON.stringify(doc.errors));
  assert.equal(doc.cells!.find((c) => c.id === "f5")!.target, "approved");
  check("dragging a real edge terminal reconnects its target");
  await invoke("action", { name: "undo" });
  await invoke("focus", { ids: ["f5"] });
  const bend = p
    .locator('.geDiagramContainer svg g[style*="cursor: row-resize"] image')
    .first();
  const point = await bend.boundingBox();
  assert.ok(point);
  await p.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await p.mouse.down();
  await p.mouse.move(point.x + point.width / 2, point.y - 65, { steps: 15 });
  await p.mouse.up();
  doc = await snap();
  assert.equal(doc.ok, true, JSON.stringify(doc.errors));
  assert.match(doc.xml!, /<Array as="points">/);
  assert.equal(doc.cells!.find((c) => c.id === "f5")!.target, "check");
  check(
    "dragging a routing handle creates persistent waypoints without detaching endpoints",
  );
  await invoke("focus", { ids: ["fix"] });
  await invoke("action", { name: "copy" });
  await p.waitForTimeout(100);
  await invoke("action", { name: "paste" });
  await p.waitForTimeout(100);
  doc = await snap();
  assert.equal(doc.stats.nodes, 6);
  assert.equal(doc.ok, true);
  assert.equal(new Set(doc.cells!.map((c) => c.id)).size, doc.cells!.length);
  check("native copy and paste create a separate valid editable object");
  await invoke("focus", { ids: ["start"] });
  await invoke("action", { name: "toFront" });
  doc = await snap();
  assert.equal(doc.cells!.at(-1)!.id, "start");
  await invoke("action", { name: "undo" });
  check("layer ordering is persisted and undoable");
  await invoke("load", {
    xml: await fs.readFile("fixtures/examples/review.drawio", "utf8"),
  });
  await invoke("focus", { ids: ["service", "inventory"] });
  await invoke("action", { name: "group" });
  doc = await snap();
  const inner = doc.cells!.find((c) => c.id === "service")!.parent;
  await invoke("focus", { ids: [inner, "queue"] });
  await invoke("action", { name: "group" });
  doc = await snap();
  assert.equal(doc.ok, true, JSON.stringify(doc.errors));
  const outer = doc.cells!.find((c) => c.id === inner)!.parent;
  assert.notEqual(outer, "group");
  assert.equal(doc.cells!.find((c) => c.id === outer)!.parent, "group");
  await invoke("action", { name: "undo" });
  await invoke("action", { name: "undo" });
  assert.equal(
    (await snap()).cells!.find((c) => c.id === "service")!.parent,
    "group",
  );
  check("nested groups preserve hierarchy and unwind in two undo steps");
  await fs.writeFile(
    "artifacts/interactions-results.json",
    JSON.stringify({ ok: true, checks }, null, 2),
  );
} catch (error) {
  await p.screenshot({ path: "artifacts/interactions-failure.png" });
  await fs.writeFile(
    "artifacts/interactions-results.json",
    JSON.stringify({ ok: false, checks, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await b.close();
  await new Promise<void>((r) => e.server.close(() => r()));
}
