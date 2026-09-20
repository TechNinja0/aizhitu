import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { validate, hash } from "../packages/document-core/index.ts";
const info = JSON.parse(await fs.readFile("artifacts/ai/edit.json", "utf8"));
const source = await fs.readFile("fixtures/examples/flow.drawio", "utf8");
assert.equal(
  await fs.readFile(path.join(info.dir, "original.drawio"), "utf8"),
  source,
);
const parse = (s: string) => new DOMParser().parseFromString(s, "text/xml");
const serializer = new XMLSerializer();
const cells = (s: string) =>
  new Map(
    Array.from(parse(s).getElementsByTagName("mxCell"))
      .filter(
        (c) =>
          c.hasAttribute("id") && !["0", "1"].includes(c.getAttribute("id")!),
      )
      .map((c) => [c.getAttribute("id")!, c]),
  );
const original = cells(source),
  checks = [];
await fs.mkdir("artifacts/ai/edit-outputs", { recursive: true });
for (const name of ["rename", "style", "reverse", "move", "add"]) {
  const file = name + ".drawio",
    text = await fs.readFile(path.join(info.dir, file), "utf8"),
    doc = validate(text);
  assert.equal(doc.ok, true, JSON.stringify(doc.errors));
  const actual = cells(text);
  for (const [id, base] of original) {
    const expected = base.cloneNode(true) as typeof base;
    if (name === "rename" && id === "check")
      expected.setAttribute("value", "完整性校验");
    if (name === "style" && id === "fix") {
      const style = actual.get(id)!.getAttribute("style")!;
      assert.match(style, /(?:^|;)fillColor=#fff0cc(?:;|$)/);
      const styles = (s: string) =>
        Object.fromEntries(
          s
            .split(";")
            .filter(Boolean)
            .map((part) => {
              const i = part.indexOf("=");
              return i < 0 ? [part, ""] : [part.slice(0, i), part.slice(i + 1)];
            }),
        );
      assert.deepEqual(styles(style), {
        ...styles(base.getAttribute("style")!),
        fillColor: "#fff0cc",
      });
      expected.setAttribute("style", style);
    }
    if (name === "reverse" && id === "f5") {
      expected.setAttribute("source", "check");
      expected.setAttribute("target", "fix");
    }
    if (name === "move" && id === "fix") {
      const g = expected.getElementsByTagName("mxGeometry")[0];
      g.setAttribute("x", "500");
      g.setAttribute("y", "320");
    }
    assert.equal(
      serializer.serializeToString(actual.get(id)!),
      serializer.serializeToString(expected),
      name + ": unrequested change " + id,
    );
  }
  assert.equal(actual.size, original.size + (name === "add" ? 2 : 0));
  if (name === "add") {
    const node = actual.get("audit")!,
      edge = actual.get("audit-edge")!;
    assert.equal(node.getAttribute("value"), "人工复核");
    for (const [k, v] of Object.entries({
      x: "450",
      y: "445",
      width: "150",
      height: "60",
    }))
      assert.equal(
        node.getElementsByTagName("mxGeometry")[0].getAttribute(k),
        v,
      );
    assert.equal(edge.getAttribute("source"), "approved");
    assert.equal(edge.getAttribute("target"), "audit");
  }
  const png = await fs.readFile(path.join(info.dir, name + ".png"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  await fs.copyFile(
    path.join(info.dir, file),
    "artifacts/ai/edit-outputs/" + file,
  );
  checks.push({ name, ok: true, preservedOriginalObjects: original.size });
}
const summary = await fs.readFile(path.join(info.dir, "summary.json"), "utf8");
assert.ok(
  summary.includes(hash(source)),
  "summary must identify exact source hash",
);
await fs.writeFile("artifacts/ai/edit-outputs/summary.json", summary);
await fs.writeFile(
  "artifacts/ai/edit-results.json",
  JSON.stringify({ ok: true, inputSha256: hash(source), checks }, null, 2),
);
console.log(
  "PASS 5 independent AI edits, unchanged source and unrelated objects, exact geometry/waypoints, new files and input-hash summaries",
);
