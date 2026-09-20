import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import {
  validate,
  emptyDocument,
  LIMITS,
} from "../packages/document-core/index.ts";
const flow = readFileSync("fixtures/examples/flow.drawio", "utf8");
test("built-in examples are valid editable documents", () => {
  for (const n of ["flow", "architecture", "review"]) {
    const r = validate(readFileSync(`fixtures/examples/${n}.drawio`, "utf8"));
    assert.deepEqual(r.errors, []);
    assert.ok(r.stats.nodes >= 5);
    assert.ok(r.stats.edges >= 5);
  }
});
test("empty document round trip retains logical identity", () => {
  const a = validate(emptyDocument()),
    b = validate(a.xml!);
  assert.equal(a.metadata!.documentId, b.metadata!.documentId);
  assert.equal(a.contentHash, b.contentHash);
});
test("standard compressed draw.io imports without losing graph semantics", () => {
  const model = flow.match(/<mxGraphModel[\s\S]*<\/mxGraphModel>/)![0];
  const xml = `<mxfile><diagram>${deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64")}</diagram></mxfile>`;
  const r = validate(xml);
  assert.equal(r.ok, true);
  assert.equal(r.stats.nodes, 5);
  assert.equal(r.stats.edges, 5);
});
test("duplicate IDs are rejected", () =>
  assert.ok(
    validate(flow.replace('id="fix"', 'id="check"')).errors.some(
      (e) => e.code === "DUPLICATE_ID",
    ),
  ));
test("dangling relation edges rejected", () =>
  assert.ok(
    validate(flow.replace('target="check"', 'target="missing"')).errors.some(
      (e) => e.code === "EDGE_ENDPOINT_MISSING",
    ),
  ));
test("cycles between nodes are legitimate business relations", () =>
  assert.equal(validate(flow).ok, true));
test("parent cycle rejected", () =>
  assert.ok(
    validate(
      flow.replace(
        'id="start" value="提交申请" vertex="1" parent="1"',
        'id="start" value="提交申请" vertex="1" parent="start"',
      ),
    ).errors.some((e) => e.code === "PARENT_CYCLE"),
  ));
test("unknown profile rejected without changing source", () => {
  const input = flow.replace("&quot;1.0&quot;", "&quot;2.0&quot;");
  const copy = input;
  assert.ok(
    validate(input).errors.some((e) => e.code === "PROFILE_UNSUPPORTED"),
  );
  assert.equal(copy, input);
});
test("DTD and external entities rejected before DOM decoding", () => {
  const r = validate(
    '<!DOCTYPE mxfile [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><mxfile>&xxe;</mxfile>',
  );
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /DTD/);
});
test("malformed XML rejected", () =>
  assert.equal(validate("<mxfile><diagram></mxfile>").ok, false));
test("second page rejected", () =>
  assert.equal(
    validate(flow.replace("</mxfile>", '<diagram id="2"/></mxfile>')).ok,
    false,
  ));
test("external image resources rejected", () =>
  assert.equal(
    validate(
      flow.replace(
        "rounded=1;",
        "shape=image;image=https://example.com/a.png;",
      ),
    ).ok,
    false,
  ));
test("event handlers rejected", () =>
  assert.equal(
    validate(
      flow.replace('value="资料校验"', 'value="资料校验" onclick="alert(1)"'),
    ).ok,
    false,
  ));
test("unsafe label HTML rejected", () =>
  assert.equal(
    validate(
      flow.replace(
        'value="资料校验"',
        'value="&lt;img src=x onerror=alert(1)&gt;"',
      ),
    ).ok,
    false,
  ));
test("supported formatted text accepted", () =>
  assert.equal(
    validate(
      flow.replace(
        'value="资料校验"',
        'value="&lt;b&gt;资料&lt;/b&gt;&lt;br&gt;校验"',
      ),
    ).ok,
    true,
  ));
test("non-finite geometry rejected", () =>
  assert.equal(validate(flow.replace('width="150"', 'width="NaN"')).ok, false));
test("unknown shapes rejected", () =>
  assert.equal(
    validate(flow.replace("rounded=1;", "shape=unknownWidget;")).ok,
    false,
  ));
test("review target must exist", () => {
  const r = readFileSync("fixtures/examples/review.drawio", "utf8").replace(
    "&quot;objectId&quot;:&quot;service&quot;",
    "&quot;objectId&quot;:&quot;missing&quot;",
  );
  assert.ok(validate(r).errors.some((e) => e.code === "REVIEW_TARGET_MISSING"));
});
test("review JSON cannot be null", () => {
  const r = flow.replace(/dw_meta="[^"]*"/, 'dw_meta="null"');
  assert.equal(validate(r).ok, false);
});
test("oversized input rejected", () =>
  assert.equal(
    validate("x".repeat(LIMITS.fileBytes + 1)).errors[0].code,
    "RESOURCE_LIMIT",
  ));

test("perimeter functions cannot execute arbitrary code", () =>
  assert.equal(
    validate(flow.replace("rounded=1;", "perimeter=(function(){alert(1)})();"))
      .ok,
    false,
  ));
test("connection points reject executable expressions", () =>
  assert.equal(
    validate(flow.replace("rounded=1;", "points=alert(1);")).ok,
    false,
  ));
test("CSS URL colors rejected", () =>
  assert.equal(
    validate(flow.replace("rounded=1;", "fillColor=url(data:text/html,hello);"))
      .ok,
    false,
  ));
test("reserved prototype identifiers rejected", () =>
  assert.equal(validate(flow.replace('id="fix"', 'id="__proto__"')).ok, false));
test("content hash detects waypoint-only changes", () => {
  const a = flow.replace(
    '<mxGeometry relative="1" as="geometry"/>',
    '<mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="500" y="100"/></Array></mxGeometry>',
  );
  const b = a.replace('x="500" y="100"', 'x="500" y="120"');
  assert.equal(validate(a).ok, true);
  assert.equal(validate(b).ok, true);
  assert.notEqual(validate(a).contentHash, validate(b).contentHash);
});
