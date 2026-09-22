import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validate, emptyDocument } from "../packages/document-core/index.ts";
import {
  planQuality,
  inspectQuality,
} from "../packages/document-tools/quality.ts";
import {
  reviewGroups,
  composeReview,
} from "../packages/document-tools/review.ts";
import { AIHistory } from "../packages/ai-service/history.ts";
import { AIService } from "../packages/ai-service/index.ts";
const xml = await fs.readFile("fixtures/examples/architecture.drawio", "utf8");
export function synthetic(count = 10) {
  let cells = "";
  for (let i = 0; i < count; i++)
    cells += `<mxCell id="n${i}" value="节点${i}" vertex="1" parent="1" style="rounded=1;fontSize=14"><mxGeometry x="${(i % 20) * 160}" y="${Math.floor(i / 20) * 100}" width="120" height="60" as="geometry"/></mxCell>`;
  return emptyDocument("压力样本").replace("</root>", cells + "</root>");
}
test("quality layouts preserve identity, semantics, valid XML and locks", () => {
  for (const mode of [
    "appearance",
    "vertical",
    "horizontal",
    "architecture",
  ] as const) {
    const r = planQuality(xml, { mode });
    assert.equal(validate(r.candidateXml!).ok, true);
    assert.deepEqual(
      validate(xml).cells!.map((c) => [
        c.id,
        c.label,
        c.source,
        c.target,
        c.parent,
      ]),
      validate(r.candidateXml!).cells!.map((c) => [
        c.id,
        c.label,
        c.source,
        c.target,
        c.parent,
      ]),
    );
  }
  const locked = xml
    .replace('value="订单服务"', 'value="订单服务"')
    .replace("fontSize=14", "locked=1;fontSize=14");
  const before = validate(locked).cells!.filter((c) =>
    c.style.includes("locked=1"),
  );
  const r = validate(planQuality(locked, { mode: "vertical" }).candidateXml!);
  for (const c of before)
    assert.deepEqual(
      r.cells!.find((n) => n.id === c.id),
      c,
    );
  assert.equal(
    planQuality(emptyDocument("空图"), { mode: "vertical" }).changes.length,
    0,
  );
});
test("quality selection protects unselected nodes and detects visual issues", () => {
  const base = synthetic(4)
    .replace('x="160"', 'x="20"')
    .replace("fontSize=14", "fontSize=8")
    .replace(
      'value="节点0"',
      'value="很长的内容很长的内容很长的内容很长的内容很长的内容"',
    );
  const quality = inspectQuality(base);
  assert.ok(quality.issues.some((i) => i.kind === "小字号"));
  assert.ok(quality.issues.some((i) => i.kind === "节点重叠"));
  const r = planQuality(base, { mode: "vertical", selection: ["n0"] });
  for (const c of validate(base).cells!.filter((c) => c.id !== "n0"))
    assert.deepEqual(
      validate(r.candidateXml!).cells!.find((n) => n.id === c.id),
      c,
    );
  assert.throws(() => planQuality(xml, { mode: "vertical", gap: NaN }));
});
test("review separates text/style and merges independent manual changes", () => {
  const base = synthetic(3),
    candidate = base
      .replace('value="节点0"', 'value="修改后"')
      .replace("fontSize=14", "fontSize=18");
  const r = reviewGroups(base, candidate);
  assert.equal(r.groups.length, 2);
  const text = r.groups.find((g) => g.changes[0].kind === "文字")!;
  const partial = composeReview(base, candidate, base, [text.id]);
  assert.equal(partial.conflicts.length, 0);
  assert.equal(
    validate(partial.candidateXml!).cells!.find((c) => c.id === "n0")!.label,
    "修改后",
  );
  assert.ok(
    validate(partial.candidateXml!)
      .cells!.find((c) => c.id === "n0")!
      .style.includes("fontSize=14"),
  );
  const manual = base.replace('value="节点1"', 'value="人工修改"');
  const merged = composeReview(base, candidate, manual, [text.id]);
  assert.equal(merged.conflicts.length, 0);
  assert.ok(merged.candidateXml!.includes("人工修改"));
  const conflict = composeReview(
    base,
    candidate,
    base.replace('value="节点0"', 'value="人工修改"'),
    [text.id],
  );
  assert.equal(conflict.conflicts.length, 1);
  assert.ok(conflict.candidateXml!.includes("人工修改"));
  assert.throws(() => composeReview(base, candidate, base, []));
});
test("structural groups keep added endpoints and edges together", () => {
  const base = synthetic(2),
    candidate = base.replace(
      "</root>",
      '<mxCell id="new" value="新增" vertex="1" parent="1"><mxGeometry x="500" y="0" width="100" height="60" as="geometry"/></mxCell><mxCell id="edge" edge="1" source="n0" target="new" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></root>',
    );
  const r = reviewGroups(base, candidate);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].ids.length, 2);
  assert.equal(
    validate(
      composeReview(base, candidate, base, [r.groups[0].id]).candidateXml!,
    ).ok,
    true,
  );
});
test("history persists states, isolates owners, paginates and enforces quotas", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-history-test-"));
  let h = new AIHistory(dir, { count: 25, bytes: 128 * 1024 * 1024 });
  try {
    for (let i = 0; i < 30; i++)
      h.put({
        id: String(i),
        owner: "a",
        documentId: "doc",
        kind: "generate",
        status: "succeeded",
        createdAt: Date.now() + i,
        requestPrompt: "请求",
        baseXml: "sensitive",
        result: { candidateXml: "candidate" },
      });
    assert.equal(h.list("a", "doc").total, 25);
    assert.equal(h.list("a", "doc").items.length, 20);
    assert.equal(h.list("a", "doc", 2).items.length, 5);
    assert.equal(h.list("b", "doc").total, 0);
    assert.throws(() => h.get("29", "b"));
    assert.ok(!JSON.stringify(h.list("a", "doc")).includes("sensitive"));
    h.update("29", "a", { name: "方案 B", disposition: "applied" });
    h.settings("a", 7);
    h.put({
      id: "running",
      owner: "a",
      documentId: "doc",
      kind: "generate",
      status: "running",
      createdAt: Date.now(),
    });
    h.close();
    h = new AIHistory(dir);
    assert.equal(h.get("29", "a").name, "方案 B");
    assert.equal(h.get("29", "a").disposition, "applied");
    assert.equal(h.get("running", "a").status, "failed");
    assert.equal(h.days("a"), 7);
    h.remove("29", "a");
    assert.throws(() => h.get("29", "a"));
    h.put({
      id: "expired",
      owner: "a",
      documentId: "doc",
      kind: "generate",
      status: "succeeded",
      createdAt: Date.now() - 8 * 86400000,
    });
    assert.throws(() => h.get("expired", "a"));
    h.limits = { count: 100, bytes: 1000 };
    h.put({
      id: "large",
      owner: "b",
      documentId: "doc",
      kind: "generate",
      status: "succeeded",
      createdAt: Date.now(),
      payload: "x".repeat(1500),
    });
    assert.equal(h.list("b", "doc").total, 0);
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("AI generation saves baseline, finished candidate and request across restart", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-ai-persist-"));
  let service = await new AIService(dir, async (_file, args) => {
    await fs.writeFile(
      args[args.indexOf("-o") + 1],
      xml.replace('value="订单服务"', 'value="修改服务"'),
    );
    return "{}";
  }).init();
  try {
    await service.save({
      defaultProvider: "codex",
      providers: {
        codex: { path: process.execPath, model: "" },
        qoder: { path: "", model: "" },
      },
    });
    const j = service.generate(
      { provider: "codex", xml, prompt: "改服务", revision: 0, mode: "edit" },
      "owner",
    );
    await service.jobs.get(j.id)!.done;
    assert.equal(service.view(j.id).status, "succeeded");
    await service.close();
    service = await new AIService(dir).init();
    const stored = service.view(j.id);
    assert.equal(stored.requestPrompt, "改服务");
    assert.ok(stored.baseXml);
    assert.ok(stored.result?.candidateXml?.includes("修改服务"));
    assert.equal(service.history.get(j.id, "owner").owner, "owner");
  } finally {
    await service.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("history APIs enforce account isolation and current document access", async () => {
  const { startServer } = await import("../apps/local-server/server.ts");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-history-acl-"));
  const service = await new AIService(dir).init();
  const server = await startServer({
    port: 0,
    shared: true,
    dataDirectory: dir,
    aiService: service,
  });
  try {
    const a = server.workspace!.enter("甲"),
      b = server.workspace!.enter("乙"),
      c = server.workspace!.enter("丙");
    const d = server.workspace!.create("共享图", xml, a.actor);
    const share = (visibility: string, recipients: string[]) =>
      server.workspace!.share(
        d.id,
        {
          visibility,
          recipients,
          role: "edit",
          accessRevision: server.workspace!.get(d.id).accessRevision,
        },
        a.actor,
      );
    share("selected", [b.actor.id]);
    service.history.put({
      id: "saved",
      owner: b.actor.id,
      documentId: d.id,
      workspaceDocument: true,
      kind: "generate",
      status: "succeeded",
      createdAt: Date.now(),
      requestPrompt: "私有提示词",
      baseXml: d.xml,
      result: { candidateXml: d.xml },
    });
    const get = (url: string, token: string) =>
      fetch(server.origin + url, {
        headers: { Authorization: "Bearer " + token },
      });
    assert.equal((await get("/api/ai/history/saved", b.token)).status, 200);
    assert.notEqual((await get("/api/ai/history/saved", c.token)).status, 200);
    assert.equal((await get("/api/ai/jobs/saved", b.token)).status, 200);
    service.history.put({
      id: "temporary",
      owner: b.actor.id,
      documentId: validate(xml).metadata!.documentId,
      kind: "generate",
      status: "succeeded",
      createdAt: Date.now(),
      baseXml: xml,
      result: reviewGroups(xml, xml),
    });
    const created = await fetch(server.origin + "/api/documents", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + b.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "临时稿入库", xml }),
    });
    assert.equal(created.status, 200);
    const saved = await created.json();
    assert.equal(
      service.history.get("temporary", b.actor.id).documentId,
      saved.id,
    );
    assert.equal(service.history.list(b.actor.id, saved.id).total, 1);
    share("private", []);
    assert.equal((await get("/api/ai/history/saved", b.token)).status, 404);
    assert.equal(
      (await get("/api/ai/history?documentId=" + d.id, b.token)).status,
      404,
    );
    assert.equal((await get("/api/ai/jobs/saved", b.token)).status, 404);
    assert.equal(
      (await get("/api/ai/history?documentId=" + d.id + "&page=2", b.token))
        .status,
      404,
    );
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("layout preserves locked descendants and terminates on cyclic flows", () => {
  const sample = synthetic(3).replace(
    "</root>",
    '<mxCell id="e0" edge="1" parent="1" source="n0" target="n1"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="e1" edge="1" parent="1" source="n1" target="n0"><mxGeometry relative="1" as="geometry"/></mxCell></root>',
  );
  assert.equal(
    validate(planQuality(sample, { mode: "horizontal" }).candidateXml!).ok,
    true,
  );
  const nested = sample
    .replace(
      'id="n0" value="节点0" vertex="1" parent="1" style="rounded=1;fontSize=14"',
      'id="n0" value="节点0" vertex="1" parent="1" style="container=1;locked=1;fontSize=14"',
    )
    .replace(
      'id="n1" value="节点1" vertex="1" parent="1"',
      'id="n1" value="节点1" vertex="1" parent="n0"',
    );
  const before = validate(nested),
    after = validate(planQuality(nested, { mode: "vertical" }).candidateXml!);
  for (const id of ["n0", "n1"])
    assert.deepEqual(
      after.cells!.find((c) => c.id === id),
      before.cells!.find((c) => c.id === id),
    );
});
test("temporary history follows first save and late completions without remapping shared records", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-history-link-")),
    h = new AIHistory(dir);
  const source = validate(xml).metadata!.documentId;
  try {
    const job = {
      id: "temp",
      owner: "a",
      documentId: source,
      kind: "generate",
      status: "succeeded",
      createdAt: Date.now(),
      baseXml: xml,
      result: reviewGroups(xml, xml.replace("订单服务", "改后服务")),
    };
    h.put(job);
    h.linkDocument("a", source, "new-document");
    const stored = h.get("temp", "a");
    assert.equal(stored.documentId, "new-document");
    assert.equal(stored.workspaceDocument, true);
    assert.equal(validate(stored.baseXml).metadata!.documentId, "new-document");
    assert.equal(
      validate(stored.result.candidateXml).metadata!.documentId,
      "new-document",
    );
    h.put({ ...job, id: "late" });
    assert.equal(h.get("late", "a").documentId, "new-document");
    h.put({ ...job, id: "shared", workspaceDocument: true });
    h.linkDocument("a", source, "another-document");
    assert.equal(h.get("shared", "a").documentId, source);
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
