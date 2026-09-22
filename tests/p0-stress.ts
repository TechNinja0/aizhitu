import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { emptyDocument, validate } from "../packages/document-core/index.ts";
import {
  planQuality,
  inspectQuality,
} from "../packages/document-tools/quality.ts";
import {
  reviewGroups,
  composeReview,
} from "../packages/document-tools/review.ts";
import { AIService } from "../packages/ai-service/index.ts";
import { AIHistory } from "../packages/ai-service/history.ts";
import { startServer } from "../apps/local-server/server.ts";
const summary = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return {
    count: s.length,
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
    max: s.at(-1),
  };
};
const diagram = (count: number) => {
  let cells = "";
  const n = Math.ceil(count * 0.6);
  for (let i = 0; i < n; i++)
    cells += `<mxCell id="n${i}" value="模块${i}" vertex="1" parent="1" style="rounded=1;fontSize=14"><mxGeometry x="${(i % 25) * 160}" y="${Math.floor(i / 25) * 100}" width="120" height="60" as="geometry"/></mxCell>`;
  for (let i = 0; i < count - n; i++)
    cells += `<mxCell id="e${i}" edge="1" parent="1" source="n${i}" target="n${i + 1}" style="edgeStyle=orthogonalEdgeStyle"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  return emptyDocument("压力样本").replace("</root>", cells + "</root>");
};
const metrics: any = {
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpus: os.cpus().length,
    memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
  },
  algorithms: [],
  startedAt: new Date().toISOString(),
};
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-p0-stress-"));
const base = diagram(500);
let gateResolve: () => void = () => {};
const gate = new Promise<void>((r) => (gateResolve = r));
const ai = await new AIService(dir, async (_file, args, o) => {
  await gate;
  await new Promise((r) => setTimeout(r, 20));
  const xml = o.input!.split("当前完整图稿：\n")[1].split("\n用户需求：")[0];
  await fs.writeFile(
    args[args.indexOf("-o") + 1],
    xml.replace("模块0", "候选0"),
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
const server = await startServer({
  port: 0,
  dataDirectory: dir,
  aiService: ai,
});
try {
  for (const size of [100, 500, 1000]) {
    const xml = diagram(size),
      candidate = xml.replaceAll("fontSize=14", "fontSize=16");
    assert.equal(validate(xml).ok, true);
    const timings: any = { size };
    for (const [name, fn] of Object.entries({
      layout: () => planQuality(xml, { mode: "vertical" }),
      check: () => inspectQuality(xml),
      groups: () => reviewGroups(xml, candidate),
      merge: () => {
        const r = reviewGroups(xml, candidate);
        return composeReview(
          xml,
          candidate,
          xml,
          r.groups.map((g) => g.id),
        );
      },
    })) {
      const values = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        const r = fn();
        values.push(performance.now() - start);
        if ("candidateXml" in r)
          assert.equal(validate(r.candidateXml!).ok, true);
      }
      timings[name] = summary(values);
      assert.ok(
        timings[name].p95 < 3000,
        `${size} ${name}: ${JSON.stringify(timings[name])}`,
      );
    }
    metrics.algorithms.push(timings);
    console.log("ALGORITHM", JSON.stringify(timings));
  }
  const latencies: number[] = [],
    failures: string[] = [];
  let sent = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (sent < 120) {
        const i = sent++;
        const start = performance.now();
        const response = await fetch(
          server.origin + (i % 2 ? "/api/quality/check" : "/api/review/groups"),
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + server.token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              i % 2
                ? { xml: base }
                : {
                    baseXml: base,
                    candidateXml: base.replace("模块0", "新模块"),
                  },
            ),
          },
        );
        const body = await response.json();
        if (!response.ok) failures.push(JSON.stringify(body));
        latencies.push(performance.now() - start);
      }
    }),
  );
  metrics.http = {
    concurrency: 8,
    requests: 120,
    failures,
    latencyMs: summary(latencies),
  };
  assert.equal(failures.length, 0);
  assert.ok(metrics.http.latencyMs.p95 < 5000);
  console.log("HTTP", JSON.stringify(metrics.http));
  ai.queueEnabled = true;
  const submitted = Array.from({ length: 8 }, (_, i) =>
    ai.generate(
      {
        provider: "codex",
        xml: base,
        prompt: "修改" + i,
        revision: 0,
        mode: "edit",
      },
      "queue-owner",
    ),
  );
  assert.throws(
    () =>
      ai.generate({
        provider: "codex",
        xml: base,
        prompt: "溢出",
        revision: 0,
        mode: "edit",
      }),
    /队列已满/,
  );
  ai.cancel(submitted[7].id);
  gateResolve();
  await Promise.all(submitted.map((j) => ai.jobs.get(j.id)!.done));
  assert.equal(ai.view(submitted[7].id).status, "cancelled");
  assert.ok(
    submitted.slice(0, 7).every((j) => ai.view(j.id).status === "succeeded"),
  );
  metrics.queue = {
    submitted: 8,
    succeeded: 7,
    cancelled: 1,
    overflowRejected: true,
  };
  console.log("QUEUE", JSON.stringify(metrics.queue));
  const h = ai.history;
  const write: number[] = [];
  const payload = "x".repeat(1024 * 1024);
  for (let i = 0; i < 140; i++) {
    const start = performance.now();
    h.put({
      id: "load" + i,
      kind: "generate",
      owner: "quota",
      documentId: "quota-doc",
      status: "succeeded",
      createdAt: Date.now() + i,
      baseXml: payload,
      result: { candidateXml: payload },
    });
    write.push(performance.now() - start);
  }
  const usage = h.settings("quota");
  assert.ok(Number(usage.bytes) <= 128 * 1024 * 1024);
  assert.ok(Number(usage.count) <= 100);
  assert.equal(h.list("unrelated", "quota-doc").total, 0);
  metrics.history = {
    written: 140,
    logicalPayloadMiB: 280,
    retainedCount: usage.count,
    retainedBytes: usage.bytes,
    writeMs: summary(write),
  };
  console.log("HISTORY", JSON.stringify(metrics.history));
  for(let i=0;i<110;i++)h.put({id:"count-"+i,owner:"count-owner",documentId:"count-doc",kind:"generate",status:"succeeded",createdAt:Date.now()+i});
  assert.equal(h.list("count-owner","count-doc").total,100);
  for(let i=0;i<8;i++)h.put({id:"parallel-"+i,owner:"local-admin",documentId:"parallel-doc",kind:"generate",status:"succeeded",createdAt:Date.now(),requestPrompt:"并发历史"});
  const historyLatency:number[]=[];
  await Promise.all(Array.from({length:8},async(_,i)=>{for(let j=0;j<10;j++){
    const start=performance.now();
    const response=await fetch(server.origin+"/api/ai/history/parallel-"+i,{method:"PATCH",headers:{Authorization:"Bearer "+server.token,"Content-Type":"application/json"},body:JSON.stringify({name:`方案${i}-${j}`})});
    assert.equal(response.status,200);
    const read=await fetch(server.origin+"/api/ai/history/parallel-"+i,{headers:{Authorization:"Bearer "+server.token}});
    assert.equal((await read.json()).name,`方案${i}-${j}`);historyLatency.push(performance.now()-start);
  }}));
  metrics.historyConcurrent={concurrency:8,writeReadPairs:80,failures:0,latencyMs:summary(historyLatency),countLimitVerified:100};
  console.log("HISTORY_CONCURRENT",JSON.stringify(metrics.historyConcurrent));
  metrics.ok = true;
  await fs.writeFile(
    "artifacts/p0-stress-results.json",
    JSON.stringify(metrics, null, 2),
  );
} finally {
  gateResolve();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
