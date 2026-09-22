import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { startServer } from "../apps/local-server/server.ts";
import { validate } from "../packages/document-core/index.ts";
import { chromium } from "playwright";
const out = path.resolve(process.argv[2] || "artifacts/performance-benchmark");
await fs.mkdir(out, { recursive: true });
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-perf-"));
const wait = (n: number) => new Promise((r) => setTimeout(r, n));
const report: any = { date: new Date().toISOString(), phases: [], errors: [] };
function processes() {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,%cpu=,comm="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((l) => {
      const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/)!;
      return {
        pid: +m[1],
        ppid: +m[2],
        rssMiB: +m[3] / 1024,
        cpu: +m[4],
        name: m[5],
      };
    });
  const ids = new Set([process.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rows)
      if (ids.has(r.ppid) && !ids.has(r.pid)) {
        ids.add(r.pid);
        changed = true;
      }
  }
  return rows.filter(
    (r) => ids.has(r.pid) && r.name !== "ps" && !r.name.endsWith("/ps"),
  );
}
function phase(name: string, extra: any = {}) {
  const procs = processes();
  const r = {
    name,
    nodeRssMiB: process.memoryUsage().rss / 1048576,
    processRssMiB: procs.reduce((s, p) => s + p.rssMiB, 0),
    processes: procs,
    ...extra,
  };
  report.phases.push(r);
  console.log(JSON.stringify(r));
}
let server: any, browser: any;
try {
  server = await startServer({ port: 0, shared: true, dataDirectory: dir });
  await wait(2000);
  phase("server-idle");
  const xml = await fs.readFile("fixtures/examples/flow.drawio", "utf8");
  const begin = performance.now();
  const jobId = server.jobs.add(xml, { format: "png" });
  while (["queued", "running"].includes(server.jobs.jobs.get(jobId).status))
    await wait(100);
  if (server.jobs.jobs.get(jobId).status !== "succeeded")
    throw Error(JSON.stringify(server.jobs.jobs.get(jobId)));
  phase("after-export", { exportMs: performance.now() - begin });
  await wait(62000);
  phase("export-idle-62s", {
    browserConnected: !!server.jobs.renderer.browser?.isConnected(),
  });
  if (server.jobs.renderer.browser)
    throw Error("idle browser was not released");
  const restartId = server.jobs.add(xml, { format: "png" });
  while (["queued", "running"].includes(server.jobs.jobs.get(restartId).status))
    await wait(100);
  if (server.jobs.jobs.get(restartId).status !== "succeeded")
    throw Error("export failed after idle release");
  report.exportAfterIdle = "succeeded";
  await server.jobs.renderer.close();
  await wait(1000);
  phase("renderer-closed");
  browser = await chromium.launch({ headless: true, channel: "chromium" });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const reqs: any = {};
  page.on("request", (r: any) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/"))
      reqs[u.pathname] = (reqs[u.pathname] || 0) + 1;
  });
  page.on("pageerror", (e: any) => report.errors.push(e.message));
  const doc = server.workspace.create("performance audit", xml, {
    id: "local-admin",
    name: "管理员",
    admin: true,
  });
  await page.goto(server.origin + "/documents/" + doc.id);
  await page.waitForLoadState("networkidle");
  await page
    .locator(".shared-notice")
    .filter({ hasText: "已保存" })
    .waitFor({ timeout: 20000 });
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries(
      (await session.send("Performance.getMetrics")).metrics.map((x: any) => [
        x.name,
        x.value,
      ]),
    );
  const before = await metrics(),
    beforeReq = { ...reqs };
  await wait(12000);
  const after = await metrics();
  phase("editor-idle-12s", {
    taskCpuSeconds: after.TaskDuration - before.TaskDuration,
    heapMiB: after.JSHeapUsedSize / 1048576,
    requestDelta: Object.fromEntries(
      Object.entries(reqs).map(([k, v]) => [
        k,
        (v as number) - (beforeReq[k] || 0),
      ]),
    ),
  });
  await page.close();
  await browser.close();
  browser = null;
  // Exercise the same editor adapter directly in an isolated renderer, with deterministic image data.
  const renderer = server.jobs.renderer;
  await renderer.ready();
  const ep = renderer.page;
  const png = await ep.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 600;
    const cx = c.getContext("2d")!,
      im = cx.createImageData(600, 600);
    let seed = 1234567;
    for (let i = 0; i < im.data.length; i += 4) {
      for (let j = 0; j < 3; j++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        im.data[i + j] = seed >>> 24;
      }
      im.data[i + 3] = 255;
    }
    cx.putImageData(im, 0, 0);
    return c.toDataURL("image/png");
  });
  const big = xml.replace(
    "</root>",
    `<mxCell id="audit-image" vertex="1" parent="1" style="shape=image;image=${png.replace(";base64,", ",")};"><mxGeometry x="700" y="50" width="600" height="600" as="geometry"/></mxCell></root>`,
  );
  const checked = validate(big);
  if (!checked.ok) throw Error(JSON.stringify(checked.errors));
  report.sampleXmlMiB = Buffer.byteLength(big) / 1048576;
  const invoke = (method: string, args: any = {}) =>
    ep.evaluate(
      ({ method, args }: any) =>
        (window as any).workbench.invoke(method, args).then(() => undefined),
      { method, args },
    );
  await invoke("load", { xml: big });
  await invoke("collaborationMode", { value: true, client: "audit-client" });
  await invoke("focus", { ids: ["start"] });
  const cd = await ep.context().newCDPSession(ep);
  await cd.send("Performance.enable");
  const heap = async () => {
    await cd.send("HeapProfiler.collectGarbage");
    const m = Object.fromEntries(
      (await cd.send("Performance.getMetrics")).metrics.map((x: any) => [
        x.name,
        x.value,
      ]),
    );
    return (m.JSHeapUsedSize as number) / 1048576;
  };
  report.undo = [{ edits: 0, heapMiB: await heap() }];
  for (let i = 0; i < 100; i++) {
    const t = performance.now();
    await invoke("color", {
      key: "fillColor",
      value: i % 2 ? "#123456" : "#654321",
    });
    if ([9, 49, 99].includes(i)) {
      report.undo.push({
        edits: i + 1,
        heapMiB: await heap(),
        lastEditMs: performance.now() - t,
      });
      console.log(JSON.stringify({ undo: report.undo.at(-1) }));
    }
    if (i % 10 === 0) await wait(100);
  }
  if (report.undo.at(-1).heapMiB > 80)
    throw Error("undo heap exceeds regression budget");
  phase("image-after-100-edits", {
    sampleXmlMiB: report.sampleXmlMiB,
    undo: report.undo,
  });
  await invoke("action", { name: "undo" });
  await invoke("action", { name: "redo" });
  const roundtrip = await ep.evaluate(() =>
    (window as any).workbench.invoke("snapshot"),
  );
  if (!roundtrip.xml.includes("fillColor=#123456"))
    throw Error("undo/redo lost last edit");
  report.largeImageUndoRedo = "passed";
  await invoke("collaborationMode", { value: false });
  report.heapAfterClearingUndoMiB = await heap();
  console.log(
    JSON.stringify({
      heapAfterClearingUndoMiB: report.heapAfterClearingUndoMiB,
    }),
  );
  // Measure synchronous server merge+validation+version write using the same generated graph.
  const actor = { id: "local-admin", name: "管理员", admin: true },
    largeDoc = server.workspace.create("large perf audit", big, actor),
    co = server.workspace.collaboration;
  const joined = co.join(largeDoc.id, actor, "server-audit-client");
  let current = joined.document;
  report.serverSyncMs = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    const result = co.sync(
      largeDoc.id,
      {
        requestId: "perf-request-" + i,
        revision: current.revision,
        token: joined.token,
        name: current.name,
        xml: current.xml.replace(/提交申请(?:\d*)/, "提交申请" + i),
      },
      actor,
    );
    report.serverSyncMs.push(performance.now() - t);
    current = result.document;
  }
  console.log(JSON.stringify({ serverSyncMs: report.serverSyncMs }));
} catch (e) {
  report.failure = String(e);
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(dir, { recursive: true, force: true });
  await fs.writeFile(
    path.join(out, "results.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("CLEANED UP; results saved");
}
