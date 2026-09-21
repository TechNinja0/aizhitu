import { randomBytes, createHash } from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  equivalentXml,
  mergeXml,
} from "../../../packages/editor-adapter/collaboration.js";
import { HttpError, type Actor, type WorkspaceStore } from "./store.ts";

export class CollaborationStore {
  constructor(
    private store: WorkspaceStore,
    private now: () => number,
  ) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS collaborators (
      documentId TEXT NOT NULL REFERENCES documents(id), client TEXT NOT NULL,
      owner TEXT NOT NULL, name TEXT NOT NULL, token TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(documentId,client));
      CREATE TABLE IF NOT EXISTS collaboration_receipts (
      documentId TEXT NOT NULL REFERENCES documents(id), owner TEXT NOT NULL, requestId TEXT NOT NULL,
      fingerprint TEXT NOT NULL, revision INTEGER NOT NULL,
      PRIMARY KEY(documentId,owner,requestId));`);
  }
  members(id: string) {
    const d = this.store.get(id);
    this.store.db
      .prepare("DELETE FROM collaborators WHERE expires<=?")
      .run(this.now());
    const rows = this.store.db
      .prepare(
        "SELECT client,owner,name,expires FROM collaborators WHERE documentId=? ORDER BY client",
      )
      .all(id);
    return rows.filter((row) =>
      this.store.allowed(d, {
        id: String(row.owner),
        name: String(row.name),
        admin: row.owner === "local-admin",
      }),
    );
  }
  idle(id: string) {
    if (this.members(id).length)
      throw new HttpError(
        423,
        "有人正在协同编辑，请所有人退出协同后再使用独占编辑或管理文件",
      );
  }
  join(id: string, actor: Actor, client: unknown) {
    if (typeof client !== "string" || !/^[\w-]{8,100}$/.test(client))
      throw new HttpError(400, "页面身份无效");
    return this.store.transaction(() => {
      this.store.access(id, actor);
      if (this.store.lock(id))
        throw new HttpError(423, "文档正在独占编辑，请结束独占编辑后加入协同");
      this.members(id);
      const existing = this.store.db
        .prepare("SELECT * FROM collaborators WHERE documentId=? AND client=?")
        .get(id, client);
      if (existing && existing.owner !== actor.id)
        throw new HttpError(409, "页面身份冲突，请刷新后重试");
      if (!existing && this.members(id).length >= 32)
        throw new HttpError(429, "此图稿最多支持 32 个同时协同的页面");
      const token =
        (existing?.token as string) || randomBytes(32).toString("hex");
      this.store.db
        .prepare("INSERT OR REPLACE INTO collaborators VALUES (?,?,?,?,?,?)")
        .run(id, client, actor.id, actor.name, token, this.now() + 30_000);
      return { token, document: this.store.get(id), members: this.members(id) };
    });
  }
  require(id: string, actor: Actor, token: unknown) {
    this.store.access(id, actor);
    if (typeof token !== "string") throw new HttpError(423, "协同会话已失效");
    const row = this.store.db
      .prepare(
        "SELECT * FROM collaborators WHERE documentId=? AND owner=? AND token=? AND expires>?",
      )
      .get(id, actor.id, token, this.now());
    if (!row) throw new HttpError(423, "协同会话已失效，请重新连接");
    return row;
  }
  state(id: string, actor: Actor, token: unknown, revision?: unknown) {
    return this.store.transaction(() => {
      const row = this.require(id, actor, token);
      this.store.db
        .prepare(
          "UPDATE collaborators SET expires=?,name=? WHERE documentId=? AND client=?",
        )
        .run(this.now() + 30_000, actor.name, id, row.client);
      const document = this.store.get(id);
      return {
        document:
          document.revision === revision
            ? { ...document, xml: undefined }
            : document,
        members: this.members(id),
      };
    });
  }
  leave(id: string, actor: Actor, token: unknown) {
    this.store.access(id, actor);
    if (typeof token === "string")
      this.store.db
        .prepare(
          "DELETE FROM collaborators WHERE documentId=? AND owner=? AND token=?",
        )
        .run(id, actor.id, token);
    return { ok: true };
  }
  sync(id: string, input: any, actor: Actor) {
    if (
      !input ||
      typeof input.requestId !== "string" ||
      !/^[\w-]{8,100}$/.test(input.requestId) ||
      !Number.isSafeInteger(input.revision) ||
      input.revision < 1
    )
      throw new HttpError(400, "协同请求标识或版本无效");
    return this.store.transaction(() => {
      this.require(id, actor, input.token);
      const xml = this.store.xml(input.xml, id),
        name = this.store.name(input.name);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify([input.revision, xml, name]))
        .digest("hex");
      const receipt = this.store.db
        .prepare(
          "SELECT * FROM collaboration_receipts WHERE documentId=? AND owner=? AND requestId=?",
        )
        .get(id, actor.id, input.requestId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new HttpError(409, "协同请求标识已被其他内容使用");
        return { document: this.store.get(id), conflicts: [], duplicate: true };
      }
      const current = this.store.get(id);
      const base = this.store.db
        .prepare(
          "SELECT xml,name FROM versions WHERE documentId=? AND revision=?",
        )
        .get(id, input.revision);
      if (!base)
        throw new HttpError(
          409,
          "离线基线已超过保留的 50 个版本，请下载当前副本后加载最新版本",
        );
      let merged;
      try {
        merged = mergeXml(
          String(base.xml),
          xml,
          current.xml,
          DOMParser,
          XMLSerializer,
        );
      } catch (e) {
        throw new HttpError(409, (e as Error).message);
      }
      const content = this.store.xml(merged.xml, id);
      const title = name === base.name ? current.name : name;
      if (
        name !== base.name &&
        current.name !== base.name &&
        current.name !== name
      )
        merged.conflicts.push("document.name");
      if (
        !equivalentXml(content, current.xml, DOMParser) ||
        title !== current.name
      ) {
        this.store.db
          .prepare(
            "UPDATE documents SET xml=?,name=?,revision=revision+1,updatedBy=?,updatedAt=? WHERE id=?",
          )
          .run(content, title, actor.name, this.now(), id);
        this.store.record(id, "协同编辑");
      }
      const document = this.store.get(id);
      this.store.db
        .prepare("INSERT INTO collaboration_receipts VALUES (?,?,?,?,?)")
        .run(id, actor.id, input.requestId, fingerprint, document.revision);
      return { document, conflicts: merged.conflicts, duplicate: false };
    });
  }
}
