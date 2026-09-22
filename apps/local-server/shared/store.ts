import { CollaborationStore } from "./collaboration.ts";
import { Accounts } from "./accounts.ts";
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
export type Actor = {
  id: string;
  name: string;
  admin: boolean;
  login?: string | null;
  needsSetup?: boolean;
};
export type Visibility = "private" | "selected" | "everyone";
type DocumentSummary = {
  id: string;
  name: string;
  revision: number;
  owner: string;
  createdBy: string;
  updatedBy: string;
  updatedAt: number;
  deleted: number;
  draft: number;
  visibility: Visibility;
  accessRevision: number;
};
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
  accounts: Accounts;
  collaboration: CollaborationStore;
  constructor(
    public directory: string,
    public leaseMs = 30_000,
    private now = Date.now,
    private historyBytes = 64 * 1024 * 1024,
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
      if (!columns.some((column) => column.name === "draft"))
        this.db.exec(
          "ALTER TABLE documents ADD COLUMN draft INTEGER NOT NULL DEFAULT 0",
        );
      if (!columns.some((column) => column.name === "visibility")) {
        this.db
          .exec(`ALTER TABLE documents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
          ALTER TABLE documents ADD COLUMN accessRevision INTEGER NOT NULL DEFAULT 1;
          DELETE FROM leases WHERE owner<>'local-admin' AND owner<>(SELECT owner FROM documents WHERE documents.id=leases.id);`);
      }
      this.db.exec(`CREATE TABLE IF NOT EXISTS document_members (
        documentId TEXT NOT NULL REFERENCES documents(id), memberId TEXT NOT NULL,
        PRIMARY KEY(documentId,memberId));`);
    });
    this.transaction(() => {
      if (
        !this.db
          .prepare("PRAGMA table_info(documents)")
          .all()
          .some((c) => c.name === "shareRole")
      ) {
        this.db.exec(
          "ALTER TABLE documents ADD COLUMN shareRole TEXT NOT NULL DEFAULT 'view'; UPDATE documents SET shareRole='edit' WHERE visibility<>'private'",
        );
      }
      if (
        !this.db
          .prepare("PRAGMA table_info(document_members)")
          .all()
          .some((c) => c.name === "role")
      )
        this.db.exec(
          "ALTER TABLE document_members ADD COLUMN role TEXT NOT NULL DEFAULT 'edit'",
        );
    });
    this.transaction(() => {
      // Former server drafts become ordinary private files without touching content/history.
      this.db
        .exec(`DELETE FROM document_members WHERE documentId IN (SELECT id FROM documents WHERE draft=1);
        UPDATE documents SET draft=0,visibility='private' WHERE draft=1;
        CREATE TABLE IF NOT EXISTS document_creations (
          owner TEXT NOT NULL, requestKey TEXT NOT NULL, documentId TEXT NOT NULL REFERENCES documents(id), fingerprint TEXT,
          PRIMARY KEY(owner,requestKey));`);
    });
    if (
      !this.db
        .prepare("PRAGMA table_info(document_creations)")
        .all()
        .some((column) => column.name === "fingerprint")
    )
      this.db.exec(
        "ALTER TABLE document_creations ADD COLUMN fingerprint TEXT",
      );
    this.accounts = new Accounts(this, this.now);
    if (
      !this.db
        .prepare("PRAGMA table_info(versions)")
        .all()
        .some((c) => c.name === "xmlBytes")
    )
      this.db.exec("ALTER TABLE versions ADD COLUMN xmlBytes INTEGER");
    this.collaboration = new CollaborationStore(this, this.now);
    this.db
      .exec(`CREATE INDEX IF NOT EXISTS documents_list_order ON documents(deleted,draft,updatedAt DESC,id);
      CREATE INDEX IF NOT EXISTS documents_owner_order ON documents(owner,deleted,draft,updatedAt DESC,id);`);
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
    return this.accounts.legacy(name);
  }
  rename(actor: Actor, name: unknown): Actor {
    if (actor.admin) throw new HttpError(400, "本机管理员无需修改用户名");
    return this.accounts.rename(actor, name);
  }
  actor(token: string): Actor | undefined {
    return this.accounts.actor(token);
  }
  logout(token: string, actor: Actor) {
    this.db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
    this.db.prepare("DELETE FROM leases WHERE owner=?").run(actor.id);
    this.db.prepare("DELETE FROM collaborators WHERE owner=?").run(actor.id);
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
  private listFilter(
    deleted: boolean,
    actor: Actor | undefined,
    view: string,
    mine: boolean,
    query = "",
  ) {
    const owner = actor?.id || "",
      admin = Number(!!actor?.admin);
    return {
      where: `deleted=? AND (owner=? OR ? OR
        (draft=0 AND (visibility='everyone' OR (visibility='selected' AND EXISTS
          (SELECT 1 FROM document_members WHERE documentId=documents.id AND memberId=?)))))
      AND (?=1 OR draft=?) AND (?=0 OR owner=?) AND instr(lower(name),lower(?))>0`,
      params: [
        Number(deleted),
        owner,
        admin,
        owner,
        Number(deleted),
        Number(view === "drafts"),
        Number(mine),
        owner,
        query,
      ],
    };
  }
  list(deleted = false, actor?: Actor, view = "shared", mine = false) {
    const { where, params } = this.listFilter(deleted, actor, view, mine);
    return this.db
      .prepare(
        `SELECT id,name,revision,owner,createdBy,updatedBy,updatedAt,deleted,draft,visibility,accessRevision,shareRole
      FROM documents WHERE ${where} ORDER BY updatedAt DESC,id`,
      )
      .all(...params)
      .map((d) => ({
        ...(d as unknown as DocumentSummary),
        canEdit: !!actor && this.canEdit(d, actor),
        lock: this.publicLock(d.id as string),
        collaborators: deleted
          ? []
          : this.collaboration.members(d.id as string),
      }));
  }
  listPage({
    deleted = false,
    actor,
    view = "shared",
    mine = false,
    page = 1,
    pageSize = 10,
    query = "",
  }: {
    deleted?: boolean;
    actor: Actor;
    view?: string;
    mine?: boolean;
    page?: number;
    pageSize?: number;
    query?: string;
  }) {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new HttpError(400, "页码必须为正整数，每页数量为 1–100");
    if (typeof query !== "string" || query.length > 120)
      throw new HttpError(400, "搜索内容不能超过 120 字");
    const { where, params } = this.listFilter(
      deleted,
      actor,
      view,
      mine,
      query.trim(),
    );
    const total = Number(
      this.db
        .prepare(`SELECT count(*) AS total FROM documents WHERE ${where}`)
        .get(...params)!.total,
    );
    const currentPage = Math.min(
      page,
      Math.max(1, Math.ceil(total / pageSize)),
    );
    const items = this.db
      .prepare(
        `SELECT id,name,revision,owner,createdBy,updatedBy,updatedAt,deleted,draft,visibility,accessRevision,shareRole
      FROM documents WHERE ${where} ORDER BY updatedAt DESC,id LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (currentPage - 1) * pageSize)
      .map((d) => ({
        ...(d as unknown as DocumentSummary),
        canEdit: !!actor && this.canEdit(d, actor),
        lock: this.publicLock(d.id as string),
        collaborators: deleted
          ? []
          : this.collaboration.members(d.id as string),
      }));
    return { items, total, page: currentPage, pageSize };
  }
  access(id: string, actor: Actor, includeDeleted = false) {
    const d = this.get(id, includeDeleted);
    if (!this.allowed(d, actor))
      throw new HttpError(404, "文档不存在或无权访问");
    return d;
  }
  allowed(d: any, actor: Actor): boolean {
    return !!(
      actor.admin ||
      d.owner === actor.id ||
      (!d.draft &&
        (d.visibility === "everyone" ||
          (d.visibility === "selected" &&
            this.db
              .prepare(
                "SELECT 1 FROM document_members WHERE documentId=? AND memberId=?",
              )
              .get(d.id, actor.id))))
    );
  }
  canEdit(d: any, actor: Actor): boolean {
    if (!this.allowed(d, actor)) return false;
    if (actor.admin || d.owner === actor.id) return true;
    return d.visibility === "everyone"
      ? d.shareRole === "edit"
      : this.db
          .prepare(
            "SELECT role FROM document_members WHERE documentId=? AND memberId=?",
          )
          .get(d.id, actor.id)?.role === "edit";
  }
  requireEdit(id: string, actor: Actor) {
    const d = this.access(id, actor);
    if (!this.canEdit(d, actor))
      throw new HttpError(403, "当前仅有查看权限，不能修改图稿");
    return d;
  }
  describe(id: string, actor: Actor) {
    const d = this.access(id, actor);
    return { ...d, canEdit: this.canEdit(d, actor) };
  }
  members() {
    return this.db
      .prepare(
        "SELECT id,name,login FROM workspace_users WHERE status='active' ORDER BY name,id",
      )
      .all();
  }
  sharing(id: string, actor: Actor) {
    const d = this.access(id, actor);
    const canManage = actor.admin || d.owner === actor.id;
    return {
      owner: d.owner,
      visibility: d.visibility as Visibility,
      accessRevision: d.accessRevision,
      canManage,
      canEdit: this.canEdit(d, actor),
      role: d.shareRole,
      recipientRoles: canManage
        ? Object.fromEntries(
            this.db
              .prepare(
                "SELECT memberId,role FROM document_members WHERE documentId=?",
              )
              .all(id)
              .map((r) => [r.memberId, r.role]),
          )
        : {},
      recipients: canManage
        ? this.db
            .prepare(
              "SELECT memberId FROM document_members WHERE documentId=? ORDER BY memberId",
            )
            .all(id)
            .map((r) => r.memberId as string)
        : [],
    };
  }
  share(id: string, input: any, actor: Actor) {
    this.transaction(() => {
      const d = this.access(id, actor);
      this.manage(d, actor);
      if (d.draft)
        throw new HttpError(409, "请先将草稿保存到文件库，再设置分享权限");
      if (
        !Number.isSafeInteger(input?.accessRevision) ||
        input.accessRevision !== d.accessRevision
      )
        throw new HttpError(409, "分享权限已被修改，请关闭分享窗口后重新打开");
      const visibility = input.visibility;
      if (!["private", "selected", "everyone"].includes(visibility))
        throw new HttpError(400, "请选择有效的分享范围");
      if (
        !Array.isArray(input.recipients) ||
        input.recipients.length > 1000 ||
        input.recipients.some((r: unknown) => typeof r !== "string") ||
        new Set(input.recipients).size !== input.recipients.length
      )
        throw new HttpError(400, "成员列表无效");
      const recipients: string[] =
        visibility === "selected" ? input.recipients : [];
      if (visibility === "selected" && !recipients.length)
        throw new HttpError(400, "请至少选择一位成员");
      for (const member of recipients) {
        if (
          member === d.owner ||
          !this.db
            .prepare(
              "SELECT 1 FROM workspace_users WHERE id=? AND status='active'",
            )
            .get(member)
        )
          throw new HttpError(
            400,
            "所选成员不存在或已退出，请重新打开分享窗口选择",
          );
      }
      // Omitted roles preserve existing grants; new shares inherit the view-only default.
      const role = input.role ?? d.shareRole;
      const previousRoles = Object.fromEntries(
        this.db
          .prepare(
            "SELECT memberId,role FROM document_members WHERE documentId=?",
          )
          .all(id)
          .filter((m) => recipients.includes(String(m.memberId)))
          .map((m) => [String(m.memberId), m.role]),
      );
      const roles = input.recipientRoles ?? previousRoles;
      if (
        !["view", "edit"].includes(role) ||
        !roles ||
        typeof roles !== "object" ||
        Array.isArray(roles) ||
        Object.entries(roles).some(
          ([id, value]) =>
            !recipients.includes(id) ||
            !["view", "edit"].includes(value as string),
        )
      )
        throw new HttpError(400, "分享权限无效");
      this.db
        .prepare("DELETE FROM document_members WHERE documentId=?")
        .run(id);
      for (const member of recipients)
        this.db
          .prepare(
            "INSERT INTO document_members (documentId,memberId,role) VALUES (?,?,?)",
          )
          .run(id, member, roles[member] ?? role);
      this.db
        .prepare(
          "UPDATE documents SET visibility=?,shareRole=?,accessRevision=accessRevision+1 WHERE id=?",
        )
        .run(visibility, role, id);
      for (const member of this.db
        .prepare(
          "SELECT owner,client,name FROM collaborators WHERE documentId=?",
        )
        .all(id)) {
        if (
          !this.canEdit(this.get(id), {
            id: String(member.owner),
            name: String(member.name),
            admin: member.owner === "local-admin",
          })
        )
          this.db
            .prepare(
              "DELETE FROM collaborators WHERE documentId=? AND client=?",
            )
            .run(id, member.client);
      }
      const lock = this.lock(id);
      if (
        lock &&
        !this.canEdit(this.get(id), {
          id: lock.owner,
          name: lock.name,
          admin: lock.owner === "local-admin",
        })
      )
        this.db.prepare("DELETE FROM leases WHERE id=?").run(id);
    });
    return this.sharing(id, actor);
  }
  manage(d: any, actor: Actor) {
    if (!actor.admin && actor.id !== d.owner)
      throw new HttpError(403, "仅文件所有者或管理员可管理文档");
  }
  idle(id: string) {
    this.collaboration.idle(id);
    const lock = this.lock(id);
    if (lock)
      throw new HttpError(423, `${lock.name} 正在编辑，请先结束编辑再管理文件`);
  }
  renameDocument(id: string, input: any, actor: Actor) {
    const name = this.name(input.name);
    this.transaction(() => {
      const d = this.access(id, actor);
      this.manage(d, actor);
      this.idle(id);
      this.revision(d, input.revision);
      if (d.name === name) return;
      this.db
        .prepare(
          "UPDATE documents SET name=?,revision=revision+1,updatedBy=?,updatedAt=? WHERE id=?",
        )
        .run(name, actor.name, this.now(), id);
      this.record(id, "重命名");
    });
    return this.access(id, actor);
  }
  publish(id: string, input: any, actor: Actor) {
    const name = this.name(input.name);
    this.transaction(() => {
      const d = this.access(id, actor);
      this.manage(d, actor);
      this.revision(d, input.revision);
      if (!d.draft) throw new HttpError(409, "图稿已经在文件库中");
      if (this.lock(id)) this.requireLock(id, actor, input.lockToken);
      this.db
        .prepare(
          "UPDATE documents SET draft=0,name=?,revision=revision+1,updatedBy=?,updatedAt=? WHERE id=?",
        )
        .run(name, actor.name, this.now(), id);
      this.record(id, "保存到文件库");
    });
    return this.access(id, actor);
  }
  batchTrash(input: any, actor: Actor) {
    const items = input?.items;
    if (
      !Array.isArray(items) ||
      !items.length ||
      items.length > 100 ||
      items.some(
        (item) =>
          !item ||
          typeof item.id !== "string" ||
          !Number.isSafeInteger(item.revision),
      ) ||
      new Set(items.map((item) => item.id)).size !== items.length
    )
      throw new HttpError(400, "请选择 1–100 份不同的文件");
    // Validate the entire selection under the write lock: never partially delete a batch.
    this.transaction(() => {
      for (const item of items) {
        const d = this.access(item.id, actor);
        this.manage(d, actor);
        this.idle(item.id);
        this.revision(d, item.revision);
      }
      for (const item of items) {
        this.db
          .prepare(
            "UPDATE documents SET deleted=1,revision=revision+1,updatedBy=?,updatedAt=? WHERE id=?",
          )
          .run(actor.name, this.now(), item.id);
        this.record(item.id, "移入回收站");
        this.db.prepare("DELETE FROM leases WHERE id=?").run(item.id);
      }
    });
    return { count: items.length };
  }
  get(id: string, includeDeleted = false): any {
    const d = this.db
      .prepare("SELECT * FROM documents WHERE id=?")
      .get(id) as any;
    if (!d || (d.deleted && !includeDeleted))
      throw new HttpError(404, "文档不存在或已移入回收站");
    return { ...d, lock: this.publicLock(id) };
  }
  create(
    name: unknown,
    xml: unknown,
    actor: Actor,
    draft = false,
    requestKey?: unknown,
  ) {
    if (
      requestKey !== undefined &&
      (typeof requestKey !== "string" || !/^[0-9a-f-]{36}$/i.test(requestKey))
    )
      throw new HttpError(400, "新建请求标识无效");
    let id = randomUUID();
    const title = this.name(name);
    const fingerprint = hash(JSON.stringify([title, xml ?? null]));
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
      if (requestKey) {
        const prior = this.db
          .prepare(
            "SELECT documentId,fingerprint FROM document_creations WHERE owner=? AND requestKey=?",
          )
          .get(actor.id, requestKey as string);
        if (prior) {
          if (prior.fingerprint && prior.fingerprint !== fingerprint)
            throw new HttpError(
              409,
              "此新建页面已在其他标签页保存不同内容，请下载当前副本后重新导入",
            );
          id = String(prior.documentId) as typeof id;
          this.access(id, actor);
          return;
        }
      }
      this.db
        .prepare(
          "INSERT INTO documents (id,name,xml,revision,owner,updatedBy,updatedAt,deleted,createdBy,draft) VALUES (?,?,?,?,?,?,?,0,?,?)",
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
          Number(draft),
        );
      this.record(id, draft ? "创建草稿" : "创建文档");
      if (requestKey)
        this.db
          .prepare(
            "INSERT INTO document_creations (owner,requestKey,documentId,fingerprint) VALUES (?,?,?,?)",
          )
          .run(actor.id, requestKey as string, id, fingerprint);
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
    this.requireEdit(id, actor);
    if (typeof client !== "string" || !/^[\w-]{8,100}$/.test(client))
      throw new HttpError(400, "页面身份无效");
    return this.transaction(() => {
      this.requireEdit(id, actor);
      this.collaboration.idle(id);
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
    this.requireEdit(id, actor);
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
      .prepare(
        "INSERT INTO versions (documentId,revision,name,xml,author,time,label,xmlBytes) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        d.revision,
        d.name,
        d.xml,
        d.updatedBy,
        d.updatedAt,
        label,
        Buffer.byteLength(d.xml),
      );
    // Backfill only this document's old rows, once, rather than loading all XML on startup.
    this.db
      .prepare(
        "UPDATE versions SET xmlBytes=length(CAST(xml AS BLOB)) WHERE documentId=? AND xmlBytes IS NULL",
      )
      .run(id);
    const versions = this.db
      .prepare(
        "SELECT revision,xmlBytes FROM versions WHERE documentId=? ORDER BY revision DESC",
      )
      .all(id);
    let bytes = 0,
      oldest = d.revision;
    for (const [index, version] of versions.entries()) {
      bytes += Number(version.xmlBytes);
      // Retain a current and previous version even for an oversized document.
      if (index >= 2 && (index >= 50 || bytes > this.historyBytes)) break;
      oldest = Number(version.revision);
    }
    this.db
      .prepare("DELETE FROM versions WHERE documentId=? AND revision<?")
      .run(id, oldest);
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
    if (input.collaborationToken) {
      return this.transaction(() => {
        this.collaboration.exclusive(id, actor, input.collaborationToken);
        const d = this.get(id);
        this.revision(d, input.revision);
        const v = this.version(id, rev);
        this.db
          .prepare(
            "UPDATE documents SET xml=?,name=?,revision=revision+1,updatedBy=?,updatedAt=? WHERE id=?",
          )
          .run(v.xml, v.name, actor.name, this.now(), id);
        this.record(id, `恢复版本 ${rev}`);
        return this.get(id);
      });
    }
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
      const d = this.access(id, actor, true);
      this.manage(d, actor);
      this.revision(d, input.revision);
      if (!!d.deleted === deleted)
        throw new HttpError(
          409,
          deleted ? "文档已经在回收站" : "文档未被删除，无需恢复",
        );
      if (deleted) {
        if (input.collaborationToken)
          this.collaboration.exclusive(id, actor, input.collaborationToken);
        else this.requireLock(id, actor, input.lockToken);
      }
      this.db
        .prepare(
          "UPDATE documents SET deleted=?,revision=revision+1,updatedBy=?,updatedAt=? WHERE id=?",
        )
        .run(Number(deleted), actor.name, this.now(), id);
      this.record(id, deleted ? "移入回收站" : "从回收站恢复");
      this.db.prepare("DELETE FROM collaborators WHERE documentId=?").run(id);
      this.db.prepare("DELETE FROM leases WHERE id=?").run(id);
    });
    return this.get(id, true);
  }

  close() {
    this.db.close();
  }
}
