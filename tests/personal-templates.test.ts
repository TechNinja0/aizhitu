import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TemplateStore } from "../apps/local-server/templates.ts";
import { validate, emptyDocument } from "../packages/document-core/index.ts";
import { templates, templateXml } from "../packages/diagram-templates/index.ts";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
test("personal templates persist independently, isolate owners, and clone all graph content with fresh identities", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "zhitu-personal-templates-"),
  );
  let store = new TemplateStore(directory);
  try {
    const xml = validate(templateXml(templates[0], "原图")),
      original = xml.metadata!.documentId;
    const input = {
      id: randomUUID(),
      name: "团队全景",
      description: "常用架构",
      category: "architecture",
    };
    const result = store.create("a", input, xml.xml!, png);
    assert.equal(result.nodeCount, templates[0].nodes.length);
    assert.ok(!("xml" in result));
    assert.ok(!("owner" in result));
    assert.equal(store.create("a", input, xml.xml!, png).id, result.id);
    assert.equal(store.list("a").length, 1);
    assert.deepEqual(store.list("b"), []);
    for (const access of [
      () => store.get(result.id, "b"),
      () => store.update(result.id, "b", input),
      () => store.remove(result.id, "b"),
      () => store.instantiate(result.id, "b", "克隆"),
    ])
      assert.throws(access, /不存在/);
    const one = validate(store.instantiate(result.id, "a", "新图 <A&B>").xml!),
      two = validate(store.instantiate(result.id, "a", "第二份").xml!);
    assert.ok(one.ok && two.ok);
    assert.notEqual(one.metadata!.documentId, original);
    assert.notEqual(one.metadata!.documentId, two.metadata!.documentId);
    assert.deepEqual(
      one.cells!.filter((c) => c.id !== "0"),
      xml.cells!.filter((c) => c.id !== "0"),
    );
    const blank = validate(emptyDocument());
    const filled = validate(
      store.instantiate(result.id, "a", "当前草稿", blank.metadata).xml!,
    );
    assert.equal(filled.metadata!.documentId, blank.metadata!.documentId);
    store.close();
    store = new TemplateStore(directory);
    assert.equal(store.list("a")[0].name, "团队全景");
    store.update(result.id, "a", {
      name: "更名模板",
      description: "新说明",
      category: "planning",
    });
    assert.equal(store.list("a")[0].category, "planning");
    store.remove(result.id, "a");
    assert.equal(store.list("a").length, 0);
    assert.ok(one.ok);
  } finally {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("template creation rejects invalid XML, blank graphs, metadata and invalid thumbnails", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "zhitu-template-input-"),
  );
  const store = new TemplateStore(directory);
  try {
    const input = {
        id: randomUUID(),
        name: "模板",
        description: "",
        category: "flow",
      },
      xml = templateXml(templates[0], "测试");
    assert.throws(() => store.create("a", input, emptyDocument(), png), /为空/);
    assert.throws(() => store.create("a", input, "<broken>", png), /无效/);
    assert.throws(
      () => store.create("a", input, xml, Buffer.from("not-png")),
      /预览无效/,
    );
    assert.throws(
      () => store.create("a", { ...input, name: " " }, xml, png),
      /名称/,
    );
    assert.throws(
      () => store.create("a", { ...input, category: "bad" }, xml, png),
      /分类/,
    );
    const saved = store.create("a", input, xml, png);
    assert.throws(
      () => store.instantiate(saved.id, "a", "图稿", { profileVersion: "bad" }),
      /信息无效/,
    );
  } finally {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
