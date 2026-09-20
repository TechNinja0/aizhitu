import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { validate, PROFILE } from "../../packages/document-core/index.ts";
import { categories } from "../../packages/diagram-templates/index.ts";
import type { PersonalTemplate } from "../../packages/diagram-templates/personal.ts";
import { HttpError } from "./shared/store.ts";

export class TemplateStore {
  db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, "templates.sqlite");
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,xml TEXT NOT NULL,preview TEXT NOT NULL,nodeCount INTEGER NOT NULL,edgeCount INTEGER NOT NULL,updatedAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS templates_owner ON templates(owner,updatedAt);`);
  }
  private summary(row: any): PersonalTemplate {
    const { xml, owner, ...summary } = row;
    return { ...summary, kind: "personal", tags: ["我的模板"] };
  }
  list(owner: string): PersonalTemplate[] {
    return this.db
      .prepare(
        "SELECT id,name,description,category,preview,nodeCount,edgeCount,updatedAt FROM templates WHERE owner=? ORDER BY updatedAt DESC,id",
      )
      .all(owner)
      .map((row) => this.summary(row));
  }
  get(id: string, owner: string) {
    const row = this.db
      .prepare("SELECT * FROM templates WHERE id=? AND owner=?")
      .get(id, owner) as any;
    if (!row) throw new HttpError(404, "模板不存在或已删除");
    return { ...this.summary(row), xml: row.xml as string };
  }
  private fields(input: any) {
    if (
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 100 ||
      /[\u0000-\u001f]/.test(input.name)
    )
      throw new HttpError(400, "请输入 1–100 字的模板名称");
    if (typeof input.description !== "string" || input.description.length > 300)
      throw new HttpError(400, "模板说明不能超过 300 字");
    if (!categories.some((c) => c.id === input.category))
      throw new HttpError(400, "请选择有效的模板分类");
    return {
      name: input.name.trim(),
      description: input.description.trim(),
      category: input.category,
    };
  }
  create(owner: string, input: any, xml: string, preview: Buffer) {
    const fields = this.fields(input);
    const doc = validate(xml);
    if (!doc.ok || !doc.stats.nodes)
      throw new HttpError(422, "图稿无效或为空，无法保存为模板");
    if (
      preview.length > 4 * 1024 * 1024 ||
      preview.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
      throw new HttpError(422, "模板预览无效或超过 4 MiB");
    if (typeof input.id !== "string" || !/^[a-f0-9-]{36}$/.test(input.id))
      throw new HttpError(400, "模板保存标识无效");
    const existing = this.db
      .prepare("SELECT owner FROM templates WHERE id=?")
      .get(input.id);
    if (existing) {
      if (existing.owner !== owner)
        throw new HttpError(409, "模板标识冲突，请重新打开保存窗口");
      return this.summary(this.get(input.id, owner));
    }
    const count = this.db
      .prepare("SELECT COUNT(*) AS count FROM templates WHERE owner=?")
      .get(owner)!;
    if (Number(count.count) >= 100)
      throw new HttpError(
        409,
        "最多保存 100 个个人模板，请先删除不再使用的模板",
      );
    // Keep graph content, but discard source-document identity/review metadata.
    const parsed = new DOMParser().parseFromString(doc.xml!, "text/xml");
    for (const obj of Array.from(parsed.getElementsByTagName("*"))) {
      if (obj.getAttribute("id") === "0") obj.removeAttribute("dw_meta");
    }
    const clean = validate(new XMLSerializer().serializeToString(parsed));
    if (!clean.ok) throw new HttpError(422, "模板内容校验失败");
    this.db
      .prepare(
        "INSERT INTO templates (id,owner,name,description,category,xml,preview,nodeCount,edgeCount,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        input.id,
        owner,
        fields.name,
        fields.description,
        fields.category,
        clean.xml!,
        `data:image/png;base64,${preview.toString("base64")}`,
        clean.stats.nodes,
        clean.stats.edges,
        Date.now(),
      );
    return this.summary(this.get(input.id, owner));
  }
  update(id: string, owner: string, input: any) {
    this.get(id, owner);
    const fields = this.fields(input);
    this.db
      .prepare(
        "UPDATE templates SET name=?,description=?,category=?,updatedAt=? WHERE id=? AND owner=?",
      )
      .run(
        fields.name,
        fields.description,
        fields.category,
        Date.now(),
        id,
        owner,
      );
    return this.summary(this.get(id, owner));
  }
  remove(id: string, owner: string) {
    this.get(id, owner);
    this.db
      .prepare("DELETE FROM templates WHERE id=? AND owner=?")
      .run(id, owner);
    return { ok: true };
  }
  instantiate(id: string, owner: string, title: unknown, metadata?: unknown) {
    const template = this.get(id, owner);
    if (typeof title !== "string" || !title.trim() || title.length > 120)
      throw new HttpError(400, "图稿名称无效");
    const parsed = new DOMParser().parseFromString(template.xml, "text/xml");
    parsed.getElementsByTagName("diagram")[0].setAttribute("name", title);
    const root = Array.from(parsed.getElementsByTagName("*")).find(
      (n) => n.getAttribute("id") === "0",
    )!;
    root.setAttribute(
      "dw_meta",
      JSON.stringify(
        metadata || {
          profileVersion: PROFILE,
          documentId: randomUUID(),
          generationMode: "manual",
          reviewItems: [],
        },
      ),
    );
    const result = validate(new XMLSerializer().serializeToString(parsed));
    if (!result.ok) throw new HttpError(422, "当前图稿信息无效，无法应用模板");
    return { xml: result.xml };
  }
  close() {
    this.db.close();
  }
}
