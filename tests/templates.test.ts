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

test("architecture catalogue covers app, service and infrastructure patterns without obstructed connectors", async () => {
  const { architectureTemplates } =
    await import("../packages/diagram-templates/architecture.ts");
  assert.equal(architectureTemplates.length, 18);
  for (const t of architectureTemplates) {
    assert.equal(t.category, "architecture");
    assert.ok(t.nodes.length >= 15 && t.edges.length >= 10, t.name);
    assert.ok(t.source.url.startsWith("https://"), t.name);
    const components = t.nodes.filter((n) => n.shape !== "lane");
    for (const n of components) {
      const parent = t.nodes.find((p) => p.id === n.parent)!;
      assert.ok(
        parent &&
          n.x >= parent.x &&
          n.y >= parent.y + 38 &&
          n.x + n.w <= parent.x + parent.w &&
          n.y + n.h <= parent.y + parent.h,
        `${t.id}: ${n.id} containment`,
      );
      assert.ok(
        t.edges.some((e) => e.source === n.id || e.target === n.id),
        `${t.id}: disconnected ${n.id}`,
      );
    }
    const anchor = (id: string, side: string) => {
      const n = components.find((n) => n.id === id)!;
      return {
        x: side === "left" ? n.x : side === "right" ? n.x + n.w : n.x + n.w / 2,
        y: side === "top" ? n.y : side === "bottom" ? n.y + n.h : n.y + n.h / 2,
      };
    };
    for (const e of t.edges) {
      const points = [
        anchor(e.source, e.from!),
        ...e.via!,
        anchor(e.target, e.to!),
      ];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        const vertical = Math.abs(a.x - b.x) < 0.001;
        assert.ok(
          vertical || Math.abs(a.y - b.y) < 0.001,
          `${t.id}: nonorthogonal ${e.source} -> ${e.target}`,
        );
        for (const n of components) {
          const hit = vertical
            ? a.x > n.x + 0.001 &&
              a.x < n.x + n.w - 0.001 &&
              Math.max(a.y, b.y) > n.y + 0.001 &&
              Math.min(a.y, b.y) < n.y + n.h - 0.001
            : a.y > n.y + 0.001 &&
              a.y < n.y + n.h - 0.001 &&
              Math.max(a.x, b.x) > n.x + 0.001 &&
              Math.min(a.x, b.x) < n.x + n.w - 0.001;
          assert.ok(
            !hit,
            `${t.id}: ${e.source} -> ${e.target} crosses ${n.id}`,
          );
        }
      }
    }
  }
});
