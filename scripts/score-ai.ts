import fs from "node:fs/promises";
import path from "node:path";
import {
  validate,
  type CellSnapshot,
} from "../packages/document-core/index.ts";
const normalize = (s: string) =>
  s
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .normalize("NFKC")
    .replace(/\s+/g, "");
function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        row[j] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length];
}
function shape(c: CellSnapshot) {
  if (/(?:^|;)(?:shape=)?(?:rhombus|diamond)(?:;|$)/.test(c.style))
    return "diamond";
  if (/(?:^|;)(?:shape=)?ellipse(?:;|$)/.test(c.style)) return "ellipse";
  if (/shape=cylinder/.test(c.style)) return "cylinder";
  return "rectangle";
}
function compare(
  reference: ReturnType<typeof validate>,
  candidate: ReturnType<typeof validate>,
) {
  const rn = reference.cells!.filter((c) => c.kind === "node"),
    cn = candidate.cells?.filter((c) => c.kind === "node") || [],
    re = reference.cells!.filter((c) => c.kind === "edge"),
    ce = candidate.cells?.filter((c) => c.kind === "edge") || [];
  const mapping = new Map<string, string>(),
    taken = new Set<string>();
  let nodesCorrect = 0,
    textErrors = 0,
    textLength = 0;
  for (const r of rn) {
    const text = normalize(r.label);
    textLength += text.length;
    const candidates = cn
      .filter((c) => !taken.has(c.id))
      .map((c) => ({ c, d: distance(text, normalize(c.label)) }))
      .sort((a, b) => a.d - b.d);
    const match = candidates[0];
    if (match && match.d <= Math.max(1, text.length * 0.3)) {
      mapping.set(match.c.id, r.id);
      taken.add(match.c.id);
      textErrors += match.d;
      if (shape(r) === shape(match.c)) nodesCorrect++;
    } else textErrors += text.length;
  }
  for (const c of cn.filter((c) => !taken.has(c.id)))
    textErrors += normalize(c.label).length;
  const remaining = [...re];
  let edgesCorrect = 0;
  for (const c of ce) {
    const index = remaining.findIndex(
      (r) =>
        r.source === mapping.get(c.source!) &&
        r.target === mapping.get(c.target!),
    );
    if (index >= 0) {
      const r = remaining.splice(index, 1)[0];
      edgesCorrect++;
      textLength += normalize(r.label).length;
      textErrors += distance(normalize(r.label), normalize(c.label));
    } else textErrors += normalize(c.label).length;
  }
  for (const r of remaining) {
    textLength += normalize(r.label).length;
    textErrors += normalize(r.label).length;
  }
  return {
    referenceNodes: rn.length,
    candidateNodes: cn.length,
    nodesCorrect,
    referenceEdges: re.length,
    candidateEdges: ce.length,
    edgesCorrect,
    textErrors,
    textLength,
  };
}
const result: any = {
  date: new Date().toISOString(),
  dataset:
    "10 synthetic clear diagrams (5 flow/5 architecture), 2 blurred synthetic diagrams; independently reconstructed from PNG inputs",
  normalization:
    "NFKC; ignore whitespace used for layout; preserve character content",
  combinations: [],
  unclear: [],
};
let pass = true;
for (const client of ["codex", "qoder"]) {
  const info = JSON.parse(
    await fs.readFile(`artifacts/ai/${client}-benchmark.json`, "utf8"),
  );
  const output = path.join(info.dir, "output");
  await fs.mkdir(`artifacts/ai/${client}-outputs`, { recursive: true });
  for (const mode of ["faithful", "relayout"]) {
    const rows: any[] = [];
    for (const file of (await fs.readdir("fixtures/benchmark/ground-truth"))
      .filter((f) => f.endsWith(".drawio"))
      .sort()) {
      const name = file.replace(".drawio", "") + "-" + mode + ".drawio";
      const reference = validate(
        await fs.readFile(
          path.join("fixtures/benchmark/ground-truth", file),
          "utf8",
        ),
      );
      let candidate: ReturnType<typeof validate>;
      try {
        candidate = validate(
          await fs.readFile(path.join(output, name), "utf8"),
        );
        await fs.copyFile(
          path.join(output, name),
          `artifacts/ai/${client}-outputs/${name}`,
        );
      } catch {
        candidate = {
          ok: false,
          profileVersion: "1.0",
          fileHash: "",
          contentHash: "",
          errors: [{ code: "MISSING", severity: "error", message: "缺少输出" }],
          warnings: [],
          stats: { nodes: 0, edges: 0, cells: 0 },
        };
      }
      rows.push({
        name,
        valid: candidate.ok,
        errors: candidate.errors,
        ...compare(reference, candidate),
      });
    }
    const totals: any = {};
    for (const field of [
      "referenceNodes",
      "candidateNodes",
      "nodesCorrect",
      "referenceEdges",
      "candidateEdges",
      "edgesCorrect",
      "textErrors",
      "textLength",
    ])
      totals[field] = rows.reduce((s, r) => s + r[field], 0);
    const metrics = {
      valid: rows.filter((r) => r.valid).length,
      total: rows.length,
      nodePrecision: totals.nodesCorrect / (totals.candidateNodes || 1),
      nodeRecall: totals.nodesCorrect / totals.referenceNodes,
      edgePrecision: totals.edgesCorrect / (totals.candidateEdges || 1),
      edgeRecall: totals.edgesCorrect / totals.referenceEdges,
      textAccuracy: Math.max(0, 1 - totals.textErrors / totals.textLength),
    };
    const ok =
      metrics.valid >= 9 &&
      metrics.nodePrecision >= 0.95 &&
      metrics.nodeRecall >= 0.95 &&
      metrics.edgePrecision >= 0.95 &&
      metrics.edgeRecall >= 0.95 &&
      metrics.textAccuracy >= 0.98;
    pass &&= ok;
    result.combinations.push({ client, mode, ok, metrics, rows });
    console.log(client, mode, ok, metrics);
    for (const name of ["11-unclear-flow", "12-unclear-architecture"]) {
      const f = `${name}-${mode}.drawio`;
      try {
        const v = validate(await fs.readFile(path.join(output, f), "utf8"));
        const count =
          v.metadata?.reviewItems.filter((r) => r.status === "needsReview")
            .length || 0;
        const ok = v.ok && count > 0;
        pass &&= ok;
        result.unclear.push({
          client,
          mode,
          name,
          ok,
          reviewItems: count,
          errors: v.errors,
        });
        await fs.copyFile(
          path.join(output, f),
          `artifacts/ai/${client}-outputs/${f}`,
        );
      } catch {
        pass = false;
        result.unclear.push({
          client,
          mode,
          name,
          ok: false,
          error: "missing",
        });
      }
    }
  }
  const report = path.join(output, "report.json");
  try {
    await fs.copyFile(report, `artifacts/ai/${client}-report.json`);
  } catch {}
}
result.ok = pass;
await fs.writeFile(
  "artifacts/ai/results.json",
  JSON.stringify(result, null, 2),
);
if (!pass) process.exitCode = 1;
