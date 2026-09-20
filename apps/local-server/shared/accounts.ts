import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { HttpError, type Actor, type WorkspaceStore } from "./store.ts";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const DAY = 86400000;
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (e, key) => (e ? reject(e) : resolve(key)),
    ),
  );
async function encode(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
async function verify(password: string, encoded: string) {
  const [, salt, hash] = encoded.split("$");
  const actual = await derive(
    password,
    salt || "00000000000000000000000000000000",
  );
  const expected = Buffer.from(hash || "00".repeat(64), "hex");
  return (
    expected.length === actual.length &&
    timingSafeEqual(expected, actual) &&
    !!hash
  );
}
export class Accounts {
  constructor(
    private store: WorkspaceStore,
    private now: () => number,
  ) {
    const db = store.db;
    store.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS workspace_users (
        id TEXT PRIMARY KEY,login TEXT UNIQUE COLLATE NOCASE,name TEXT NOT NULL,passwordHash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',createdAt INTEGER NOT NULL,lastLogin INTEGER,revision INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS account_resets (hash TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES workspace_users(id),expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS account_audit (id INTEGER PRIMARY KEY,at INTEGER NOT NULL,actor TEXT NOT NULL,target TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL);`);
      // Each old ID remains distinct. Never merge users by display name, including expired identities.
      db.prepare(
        `INSERT OR IGNORE INTO workspace_users (id,name,createdAt)
        SELECT id,name,? FROM sessions WHERE id<>'local-admin' GROUP BY id`,
      ).run(now());
      db.prepare(
        `INSERT OR IGNORE INTO workspace_users (id,name,createdAt)
        SELECT owner,createdBy,MIN(updatedAt) FROM documents WHERE owner<>'local-admin' GROUP BY owner`,
      ).run();
      db.prepare("UPDATE sessions SET admin=0 WHERE admin<>0").run();
    });
  }
  private get db() {
    return this.store.db;
  }
  user(id: string): any {
    const u = this.db
      .prepare("SELECT * FROM workspace_users WHERE id=?")
      .get(id);
    if (!u || u.status === "deleted") throw new HttpError(404, "用户不存在");
    return u;
  }
  private active(id: string) {
    const u = this.user(id);
    if (u.status !== "active")
      throw new HttpError(403, "账号已停用，请联系管理员");
    return u;
  }
  private loginName(value: unknown) {
    if (
      typeof value !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}$/.test(value.trim())
    )
      throw new HttpError(
        400,
        "登录名需为 3–40 位字母、数字、下划线、点或短横线",
      );
    return value.trim().toLowerCase();
  }
  private password(value: unknown) {
    if (typeof value !== "string" || value.length < 6 || value.length > 128)
      throw new HttpError(400, "密码需为 6–128 个字符，不限制字符组合");
    return value;
  }
  private unique(login: string, except = "") {
    if (
      this.db
        .prepare(
          "SELECT 1 FROM workspace_users WHERE login=? COLLATE NOCASE AND id<>?",
        )
        .get(login, except)
    )
      throw new HttpError(409, "登录名已被使用，请选择其他登录名");
  }
  private audit(actor: string, target: string, action: string, detail = "") {
    this.db
      .prepare(
        "INSERT INTO account_audit (at,actor,target,action,detail) VALUES (?,?,?,?,?)",
      )
      .run(this.now(), actor, target, action, detail);
  }
  private view(u: any): Actor {
    return {
      id: u.id,
      name: u.name,
      admin: false,
      login: u.login,
      needsSetup: !u.login || !u.passwordHash,
    };
  }
  private session(id: string, remember = true) {
    const u = this.active(id),
      token = randomBytes(32).toString("hex"),
      expires = this.now() + (remember ? 30 * DAY : DAY);
    this.db
      .prepare("INSERT INTO sessions VALUES (?,?,?,?,?)")
      .run(digest(token), id, u.name, 0, expires);
    this.db
      .prepare("UPDATE workspace_users SET lastLogin=? WHERE id=?")
      .run(this.now(), id);
    return { token, actor: this.view(u), expires, remember };
  }
  actor(token: string): Actor | undefined {
    const u = this.db
      .prepare(
        `SELECT u.* FROM sessions s JOIN workspace_users u ON u.id=s.id
      WHERE s.token=? AND s.expires>? AND u.status='active'`,
      )
      .get(digest(token), this.now());
    return u ? this.view(u) : undefined;
  }
  // Legacy fixture/migration helper; deliberately not exposed as an HTTP registration method.
  legacy(name: unknown) {
    const id = randomUUID(),
      title = this.store.username(name);
    this.db
      .prepare("INSERT INTO workspace_users (id,name,createdAt) VALUES (?,?,?)")
      .run(id, title, this.now());
    const result = this.session(id);
    this.db
      .prepare("UPDATE sessions SET expires=? WHERE token=?")
      .run(Number.MAX_SAFE_INTEGER, digest(result.token));
    return result;
  }
  async register(input: any) {
    const login = this.loginName(input?.login),
      name = this.store.username(input?.name);
    this.unique(login);
    const passwordHash = await encode(this.password(input?.password));
    return this.store.transaction(() => {
      this.unique(login);
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO workspace_users (id,login,name,passwordHash,createdAt) VALUES (?,?,?,?,?)",
        )
        .run(id, login, name, passwordHash, this.now());
      this.audit(id, id, "注册账号");
      return this.session(id, input.remember !== false);
    });
  }
  async login(input: any) {
    const login =
      typeof input?.login === "string" ? input.login.trim().toLowerCase() : "";
    if (
      typeof input?.password !== "string" ||
      input.password.length > 128 ||
      login.length > 40
    )
      throw new HttpError(400, "请输入登录名和密码");
    const u = this.db
      .prepare("SELECT * FROM workspace_users WHERE login=? COLLATE NOCASE")
      .get(login) as any;
    const valid = await verify(input.password, u?.passwordHash || "");
    if (!valid || !u || u.status !== "active")
      throw new HttpError(401, "登录名或密码错误，或账号已停用");
    return this.store.transaction(() => {
      const current = this.active(u.id);
      if (
        current.revision !== u.revision ||
        current.passwordHash !== u.passwordHash
      )
        throw new HttpError(401, "账号状态已更新，请重新登录");
      return this.session(u.id, input.remember !== false);
    });
  }
  async setup(actor: Actor, input: any) {
    const u = this.active(actor.id);
    if (u.login || u.passwordHash)
      throw new HttpError(409, "账号已经设置，请使用修改密码或找回功能");
    const login = this.loginName(input?.login);
    this.unique(login);
    const passwordHash = await encode(this.password(input?.password));
    return this.store.transaction(() => {
      const current = this.active(actor.id);
      if (current.revision !== u.revision || current.login)
        throw new HttpError(409, "账号已被更新，请重新进入");
      this.unique(login);
      this.db
        .prepare(
          "UPDATE workspace_users SET login=?,passwordHash=?,revision=revision+1 WHERE id=?",
        )
        .run(login, passwordHash, u.id);
      this.revoke(u.id);
      this.audit(u.id, u.id, "补设账号");
      return this.session(u.id, input.remember !== false);
    });
  }
  async changePassword(actor: Actor, input: any) {
    const u = this.active(actor.id);
    if (
      typeof input?.oldPassword !== "string" ||
      input.oldPassword.length > 128 ||
      !(await verify(input.oldPassword, u.passwordHash))
    )
      throw new HttpError(400, "原密码不正确");
    const passwordHash = await encode(this.password(input.password));
    return this.store.transaction(() => {
      const current = this.active(u.id);
      if (current.revision !== u.revision)
        throw new HttpError(409, "账号已更新，请重试");
      this.db
        .prepare(
          "UPDATE workspace_users SET passwordHash=?,revision=revision+1 WHERE id=?",
        )
        .run(passwordHash, u.id);
      this.revoke(u.id);
      this.audit(u.id, u.id, "修改密码");
      return this.session(u.id, input.remember !== false);
    });
  }
  rename(actor: Actor, name: unknown) {
    const title = this.store.username(name);
    this.store.transaction(() => {
      this.active(actor.id);
      this.db
        .prepare(
          "UPDATE workspace_users SET name=?,revision=revision+1 WHERE id=?",
        )
        .run(title, actor.id);
      this.db
        .prepare("UPDATE sessions SET name=? WHERE id=?")
        .run(title, actor.id);
      this.db
        .prepare("UPDATE leases SET name=? WHERE owner=?")
        .run(title, actor.id);
    });
    return this.view(this.user(actor.id));
  }
  private revoke(id: string) {
    this.db.prepare("DELETE FROM sessions WHERE id=?").run(id);
    this.db.prepare("DELETE FROM leases WHERE owner=?").run(id);
    this.db.prepare("DELETE FROM account_resets WHERE userId=?").run(id);
  }
  private admin(actor: Actor) {
    if (!actor.admin || actor.id !== "local-admin")
      throw new HttpError(403, "仅本机管理员可管理用户");
  }
  private expected(u: any, revision: unknown) {
    if (!Number.isSafeInteger(revision) || u.revision !== revision)
      throw new HttpError(409, "用户信息已变化，请刷新列表后重试");
  }
  list(actor: Actor) {
    this.admin(actor);
    return this.db
      .prepare(
        `SELECT id,login,name,status,createdAt,lastLogin,revision,
      CASE WHEN login IS NULL OR passwordHash='' THEN 1 ELSE 0 END AS needsSetup,
      (SELECT count(*) FROM documents WHERE owner=u.id) AS documents,
      (SELECT count(*) FROM sessions WHERE id=u.id AND expires>?) AS sessions
      FROM workspace_users u WHERE status<>'deleted' ORDER BY createdAt DESC,id`,
      )
      .all(this.now());
  }
  create(actor: Actor, input: any) {
    this.admin(actor);
    const login = this.loginName(input?.login),
      name = this.store.username(input?.name);
    return this.store.transaction(() => {
      this.unique(login);
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO workspace_users (id,login,name,createdAt) VALUES (?,?,?,?)",
        )
        .run(id, login, name, this.now());
      this.audit(actor.id, id, "创建用户");
      return this.issue(id, login, actor.id);
    });
  }
  private issue(id: string, login: string, actorId: string) {
    const resetCode = randomBytes(24).toString("hex"),
      expires = this.now() + 15 * 60000;
    this.revoke(id);
    this.db
      .prepare(
        "UPDATE workspace_users SET login=?,passwordHash='',revision=revision+1 WHERE id=?",
      )
      .run(login, id);
    this.db
      .prepare("INSERT INTO account_resets VALUES (?,?,?)")
      .run(digest(resetCode), id, expires);
    this.audit(actorId, id, "签发密码设置凭证");
    return { id, login, resetCode, expires };
  }
  reset(actor: Actor, id: string, input: any) {
    this.admin(actor);
    return this.store.transaction(() => {
      const u = this.active(id);
      this.expected(u, input?.revision);
      const login = u.login || this.loginName(input?.login);
      this.unique(login, id);
      return this.issue(id, login, actor.id);
    });
  }
  async redeem(input: any) {
    if (typeof input?.code !== "string" || !/^[a-f0-9]{48}$/.test(input.code))
      throw new HttpError(400, "重置凭证无效或已过期");
    const reset = this.db
      .prepare("SELECT * FROM account_resets WHERE hash=? AND expires>?")
      .get(digest(input.code), this.now()) as any;
    if (!reset) throw new HttpError(400, "重置凭证无效或已过期");
    this.active(reset.userId);
    const passwordHash = await encode(this.password(input.password));
    return this.store.transaction(() => {
      const valid = this.db
        .prepare("SELECT * FROM account_resets WHERE hash=? AND expires>?")
        .get(digest(input.code), this.now());
      if (!valid) throw new HttpError(400, "重置凭证无效或已过期");
      this.active(reset.userId);
      this.db
        .prepare(
          "UPDATE workspace_users SET passwordHash=?,revision=revision+1 WHERE id=?",
        )
        .run(passwordHash, reset.userId);
      this.revoke(reset.userId);
      this.audit(reset.userId, reset.userId, "完成密码设置");
      return this.session(reset.userId, input.remember !== false);
    });
  }
  status(actor: Actor, id: string, input: any) {
    this.admin(actor);
    if (!["active", "disabled"].includes(input?.status))
      throw new HttpError(400, "用户状态无效");
    this.store.transaction(() => {
      const u = this.user(id);
      this.expected(u, input.revision);
      this.db
        .prepare(
          "UPDATE workspace_users SET status=?,revision=revision+1 WHERE id=?",
        )
        .run(input.status, id);
      if (input.status === "disabled") this.revoke(id);
      this.audit(
        actor.id,
        id,
        input.status === "active" ? "启用用户" : "停用用户",
      );
    });
    return { ok: true };
  }
  transfer(actor: Actor, id: string, input: any) {
    this.admin(actor);
    return this.store.transaction(() => {
      const source = this.user(id);
      this.expected(source, input?.revision);
      if (source.status !== "disabled")
        throw new HttpError(409, "请先停用原用户，再转移文件");
      const target = this.active(String(input.targetId));
      if (target.id === id || !target.login || !target.passwordHash)
        throw new HttpError(400, "请选择已完成账号设置的其他启用用户");
      const docs = this.db
        .prepare("SELECT id FROM documents WHERE owner=?")
        .all(id);
      for (const d of docs) this.store.idle(d.id as string);
      this.db
        .prepare(
          "DELETE FROM document_members WHERE documentId IN (SELECT id FROM documents WHERE owner=?)",
        )
        .run(id);
      this.db
        .prepare(
          "UPDATE documents SET owner=?,visibility='private',accessRevision=accessRevision+1 WHERE owner=?",
        )
        .run(target.id, id);
      this.db
        .prepare("UPDATE workspace_users SET revision=revision+1 WHERE id=?")
        .run(id);
      this.audit(
        actor.id,
        id,
        "转移全部图稿",
        JSON.stringify({ target: target.id, count: docs.length }),
      );
      return { count: docs.length };
    });
  }
  remove(actor: Actor, id: string, input: any, personalTemplates = 0) {
    this.admin(actor);
    this.store.transaction(() => {
      const u = this.user(id);
      this.expected(u, input?.revision);
      if (u.status !== "disabled") throw new HttpError(409, "请先停用用户");
      if (
        this.db
          .prepare("SELECT 1 FROM documents WHERE owner=? LIMIT 1")
          .get(id) ||
        personalTemplates
      )
        throw new HttpError(
          409,
          "该用户仍有图稿或个人模板，请先转移图稿并处理个人模板；也可以保持停用以保留数据",
        );
      this.revoke(id);
      this.db
        .prepare(
          "UPDATE documents SET accessRevision=accessRevision+1 WHERE id IN (SELECT documentId FROM document_members WHERE memberId=?)",
        )
        .run(id);
      this.db.prepare("DELETE FROM document_members WHERE memberId=?").run(id);
      this.db
        .prepare(
          "UPDATE workspace_users SET status='deleted',passwordHash='',revision=revision+1 WHERE id=?",
        )
        .run(id);
      this.audit(actor.id, id, "删除用户（保留身份记录）");
    });
    return { ok: true };
  }
}
