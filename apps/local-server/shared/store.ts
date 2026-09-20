import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  emptyDocument,
  validate,
} from "../../../packages/document-core/index.ts";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Actor = { id: string; name: string; admin: boolean };
export type Lease = {
  owner: string;
  name: string;
  client: string;
  token: string;
  expires: number;
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export class WorkspaceStore {
  db: DatabaseSync;
  constructor(
    public directory: string,
    public leaseMs = 30_000,
    private now = Date.now,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(directory, "workspace.sqlite"));
    chmodSync(path.join(directory, "workspace.sqlite"), 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, client TEXT NOT NULL, token TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, id TEXT NOT NULL, name TEXT NOT NULL, admin INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, name TEXT NOT NULL, xml TEXT NOT NULL, revision INTEGER NOT NULL, owner TEXT NOT NULL, updatedBy TEXT NOT NULL, updatedAt INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS versions (documentId TEXT NOT NULL REFERENCES documents(id), revision INTEGER NOT NULL, name TEXT NOT NULL, xml TEXT NOT NULL, author TEXT NOT NULL, time INTEGER NOT NULL, label TEXT NOT NULL, PRIMARY KEY(documentId, revision));`);
    this.transaction(() => {
      const columns = this.db.prepare("PRAGMA table_info(documents)").all();
      if (!columns.some((column) => column.name === "createdBy")) {
        this.db.exec(
          "ALTER TABLE documents ADD COLUMN createdBy TEXT NOT NULL DEFAULT ''",
        );
        // Only version 1 records creation. Later retained versions may belong to another editor.
        this.db.exec(`UPDATE documents SET createdBy=COALESCE(
          (SELECT author FROM versions WHERE documentId=documents.id AND revision=1),
          (SELECT name FROM sessions WHERE id=documents.owner LIMIT 1),
          CASE WHEN owner='local-admin' THEN '本机管理员' ELSE '历史创建者' END)`);
      }
    });
    // Preserve valid identities from the password-based release, but retire remote admin grants.
    this.db
      .prepare(
        "UPDATE sessions SET expires=?,admin=0 WHERE expires>? AND (expires<>? OR admin<>0)",
      )
      .run(Number.MAX_SAFE_INTEGER, this.now(), Number.MAX_SAFE_INTEGER);
  }
  username(name: unknown) {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 40 ||
      /[\u0000-\u001f]/.test(name)
    )
      throw new HttpError(400, "请输入 1–40 字的用户名，不能包含控制字符");
    return name.trim();
  }
  enter(name: unknown) {
    // A name is a display label, never a credential for an existing identity.
    const actor = { id: randomUUID(), name: this.username(name), admin: false };
    const token = randomBytes(32).toString("hex");
    this.db
      .prepare("INSERT INTO sessions VALUES (?,?,?,?,?)")
      .run(hash(token), actor.id, actor.name, 0, Number.MAX_SAFE_INTEGER);
    return { token, actor };
  }
  rename(actor: Actor, name: unknown): Actor {
    if (actor.id === "local-admin")
      throw new HttpError(400, "本机管理员身份无需修改用户名");
    const next = { ...actor, name: this.username(name), admin: false };
    this.transaction(() => {
      this.db
        .prepare("UPDATE sessions SET name=? WHERE id=?")
        .run(next.name, actor.id);
      this.db
        .prepare("UPDATE leases SET name=? WHERE owner=?")
        .run(next.name, actor.id);
    });
    return next;
  }
  actor(token: string): Actor | undefined {
    const s = this.db
      .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
      .get(hash(token), this.now()) as any;
    return s && { id: s.id, name: s.name, admin: false };
  }
  logout(token: string, actor: Actor) {
    this.db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
    this.db.prepare("DELETE FROM leases WHERE owner=?").run(actor.id);
  }
  name(value: unknown) {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 120 ||
      /[\u0000-\u001f]/.test(value)
    )
      throw new HttpError(400, "名称应为 1–120 字，不能包含控制字符");
    return value.trim();
  }
  xml(value: unknown, id?: string) {
    if (typeof value !== "string") throw new HttpError(400, "缺少图稿内容");
    const result = validate(value);
    if (!result.ok)
      throw new HttpError(422, result.errors.map((e) => e.message).join("；"));
    if (id && result.metadata!.documentId !== id)
      throw new HttpError(409, "文档身份不匹配，请导入为新文档");
    return result.xml!;
  }
  list(deleted = false) {
    return this.db
      .prepare(
        "SELECT id,name,revision,owner,createdBy,updatedBy,updatedAt,deleted FROM documents WHERE deleted=? ORDER BY updatedAt DESC",
      )
      .all(Number(deleted))
      .map((d) => ({ ...d, lock: this.publicLock(d.id as string) }));
  }
  get(id: string, includeDeleted = false): any {
    const d = this.db
      .prepare("SELECT * FROM documents WHERE id=?")
      .get(id) as any;
    if (!d || (d.deleted && !includeDeleted))
      throw new HttpError(404, "文档不存在或已移入回收站");
    return { ...d, lock: this.publicLock(id) };
  }
  create(name: unknown, xml: unknown, actor: Actor) {
    const id = randomUUID(),
      title = this.name(name);
    const doc = new DOMParser().parseFromString(
      this.xml(xml ?? emptyDocument(title)),
      "text/xml",
    );
    const root = Array.from(doc.getElementsByTagName("*")).find((n) =>
      n.hasAttribute("dw_meta"),
    )!;
    const meta = JSON.parse(root.getAttribute("dw_meta")!);
    meta.documentId = id;
    root.setAttribute("dw_meta", JSON.stringify(meta));
    const content = this.xml(new XMLSerializer().serializeToString(doc), id);
    this.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO documents (id,name,xml,revision,owner,updatedBy,updatedAt,deleted,createdBy) VALUES (?,?,?,?,?,?,?,0,?)",
        )
        .run(
          id,
          title,
          content,
          1,
          actor.id,
          actor.name,
          this.now(),
          actor.name,
        );
      this.record(id, "创建文档");
    });
    return this.get(id);
  }
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = work();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  lock(id: string) {
    return this.db
      .prepare(
        "SELECT owner,name,client,token,expires FROM leases WHERE id=? AND expires>?",
      )
      .get(id, this.now()) as Lease | undefined;
  }

  publicLock(id: string) {
    const l = this.lock(id);
    return l
      ? { owner: l.owner, name: l.name, client: l.client, expires: l.expires }
      : null;
  }
  acquire(id: string, actor: Actor, client: unknown) {
    this.get(id);
    if (typeof client !== "string" || !/^[\w-]{8,100}$/.test(client))
      throw new HttpError(400, "页面身份无效");
    return this.transaction(() => {
      const existing = this.lock(id);
      if (
        existing &&
        (existing.owner !== actor.id || existing.client !== client)
      )
        throw new HttpError(423, `${existing.name} 正在编辑，请稍后重试`);
      const l = existing ?? {
        owner: actor.id,
        name: actor.name,
        client,
        token: randomBytes(32).toString("hex"),
        expires: 0,
      };
      l.expires = this.now() + this.leaseMs;
      this.db
        .prepare("INSERT OR REPLACE INTO leases VALUES (?,?,?,?,?,?)")
        .run(id, l.owner, l.name, l.client, l.token, l.expires);
      return { ...l, revision: this.get(id).revision, leaseMs: this.leaseMs };
    });
  }
  requireLock(id: string, actor: Actor, token: unknown): Lease {
    this.get(id);
    const l = this.lock(id);
    if (!l || l.owner !== actor.id || l.token !== token)
      throw new HttpError(423, "编辑权已失效，请保留修改并重新获取编辑权");
    return l;
  }
  heartbeat(id: string, actor: Actor, token: unknown) {
    return this.transaction(() => {
      const l = this.requireLock(id, actor, token);
      l.expires = this.now() + this.leaseMs;
      this.db
        .prepare("UPDATE leases SET expires=? WHERE id=?")
        .run(l.expires, id);
      return { expires: l.expires, leaseMs: this.leaseMs };
    });
  }
  release(id: string, actor: Actor, token: unknown) {
    return this.transaction(() => {
      this.requireLock(id, actor, token);
      this.db.prepare("DELETE FROM leases WHERE id=?").run(id);
      return { released: true };
    });
  }
  revision(d: any, expected: unknown) {
    if (!Number.isSafeInteger(expected) || d.revision !== expected)
      throw new HttpError(
        409,
        "服务器已有新版本，未覆盖。请下载本地副本后加载最新版本",
      );
  }
  save(id: string, input: any, actor: Actor, label = "保存图稿") {
    const xml = this.xml(input.xml, id),
      name = this.name(input.name);
    this.transaction(() => {
      this.requireLock(id, actor, input.lockToken);
      const d = this.get(id);
      this.revision(d, input.revision);
      if (d.xml === xml && d.name === name) return;
      this.db
        .prepare(
          "UPDATE documents SET xml=?,name=?,revision=revision+1,updatedBy=?,updatedAt=? WHERE id=?",
        )
        .run(xml, name, actor.name, this.now(), id);
      this.record(id, label);
    });
    return this.get(id);
  }
  record(id: string, label: string) {
    const d = this.get(id, true);
    this.db
      .prepare("INSERT INTO versions VALUES (?,?,?,?,?,?,?)")
      .run(id, d.revision, d.name, d.xml, d.updatedBy, d.updatedAt, label);
    this.db
      .prepare(
        "DELETE FROM versions WHERE documentId=? AND revision NOT IN (SELECT revision FROM versions WHERE documentId=? ORDER BY revision DESC LIMIT 50)",
      )
      .run(id, id);
  }
  versions(id: string) {
    this.get(id);
    return this.db
      .prepare(
        "SELECT revision,name,author,time,label FROM versions WHERE documentId=? ORDER BY revision DESC",
      )
      .all(id);
  }
  version(id: string, rev: number): any {
    this.get(id);
    const v = this.db
      .prepare("SELECT * FROM versions WHERE documentId=? AND revision=?")
      .get(id, rev);
    if (!v) throw new HttpError(404, "历史版本不存在");
    return v;
  }
  restore(id: string, rev: number, input: any, actor: Actor) {
    const v = this.version(id, rev);
    return this.save(
      id,
      { ...input, name: v.name, xml: v.xml },
      actor,
      `恢复版本 ${rev}`,
    );
  }
  trash(id: string, input: any, actor: Actor, deleted: boolean) {
    this.transaction(() => {
      const d = this.get(id, true);
      if (!actor.admin && actor.id !== d.owner)
        throw new HttpError(403, "仅创建者或管理员可删除和恢复文档");
      this.revision(d, input.revision);
      if (!!d.deleted === deleted)
        throw new HttpError(
          409,
          deleted ? "文档已经在回收站" : "文档未被删除，无需恢复",
        );
      if (deleted) this.requireLock(id, actor, input.lockToken);
      this.db
        .prepare(
          "UPDATE documents SET deleted=?,revision=revision+1,updatedBy=?,updatedAt=? WHERE id=?",
        )
        .run(Number(deleted), actor.name, this.now(), id);
      this.record(id, deleted ? "移入回收站" : "从回收站恢复");
      this.db.prepare("DELETE FROM leases WHERE id=?").run(id);
    });
    return this.get(id, true);
  }

  close() {
    this.db.close();
  }
}
