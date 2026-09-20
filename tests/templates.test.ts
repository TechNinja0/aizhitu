import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { validate } from "../packages/document-core/index.ts";
import {
  categories,
  templates,
  templateXml,
  templateSvg,
} from "../packages/diagram-templates/index.ts";

test("all templates import as editable documents, with intact relationships and independent identities", () => {
  assert.equal(new Set(templates.map((t) => t.id)).size, templates.length);
  for (const category of categories)
    assert.ok(templates.some((t) => t.category === category.id));
  for (const template of templates) {
    const xml = templateXml(template, template.name);
    const a = validate(xml),
      b = validate(xml);
    assert.deepEqual(a.errors, [], template.name);
    assert.equal(a.stats.nodes, template.nodes.length, template.name);
    assert.equal(a.stats.edges, template.edges.length, template.name);
    assert.notEqual(a.metadata!.documentId, b.metadata!.documentId);
    assert.equal(validate(a.xml!).contentHash, a.contentHash);
    for (const node of template.nodes) {
      const cell = a.cells!.find((c) => c.id === node.id)!;
      assert.equal(cell.label, node.label);
      assert.equal(cell.parent, node.parent || "1");
    }
    assert.deepEqual(
      a
        .cells!.filter((c) => c.kind === "edge")
        .map((c) => [c.source, c.target]),
      template.edges.map((e) => [e.source, e.target]),
    );
  }
});
test("previews are standalone SVGs with all labels and no network resources", () => {
  for (const template of templates) {
    const svg = new DOMParser().parseFromString(
      templateSvg(template),
      "image/svg+xml",
    );
    assert.equal(svg.documentElement!.tagName, "svg");
    for (const node of template.nodes)
      for (const line of node.label.split("\n"))
        assert.ok(
          svg.documentElement!.textContent!.includes(line),
          `${template.id}: ${line}`,
        );
    for (const edge of template.edges)
      if (edge.label)
        assert.ok(svg.documentElement!.textContent!.includes(edge.label));
    assert.equal(svg.getElementsByTagName("image").length, 0);
    assert.equal(svg.getElementsByTagName("script").length, 0);
  }
});
test("blank creation and XML escaping preserve names without injecting graph content", () => {
  const title = '研发 <A&B> "图稿"';
  for (const template of [null, templates[0]]) {
    const xml = templateXml(template, title);
    assert.ok(validate(xml).ok);
    assert.equal(
      new DOMParser()
        .parseFromString(xml, "text/xml")
        .getElementsByTagName("diagram")[0]
        .getAttribute("name"),
      title,
    );
  }
  assert.equal(validate(templateXml(null, "空白")).stats.nodes, 0);
  assert.equal(validate(templateXml(null, "空白")).stats.edges, 0);
});
