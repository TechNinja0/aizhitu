import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  WorkspaceStore,
  HttpError,
} from "../apps/local-server/shared/store.ts";
import { startServer } from "../apps/local-server/server.ts";
const password = "123456";
const admin = { id: "local-admin", name: "本机管理员", admin: true };
const fails = (status: number) => (e: unknown) =>
  e instanceof HttpError && e.status === status;
async function fixture(
  work: (
    s: WorkspaceStore,
    dir: string,
    clock: { now: number },
  ) => Promise<void>,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-accounts-")),
    clock = { now: Date.now() };
  const s = new WorkspaceStore(dir, 30000, () => clock.now);
  try {
    await work(s, dir, clock);
  } finally {
    s.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
test("固定账号跨浏览器登录、姓名可重名、唯一登录名、防冒领、密码哈希与会话过期", () =>
  fixture(async (s, dir, clock) => {
    const a = await s.accounts.register({
      login: "WangQiang",
      name: "王强",
      password,
    });
    const b = await s.accounts.register({
      login: "another",
      name: "王强",
      password,
    });
    assert.notEqual(a.actor.id, b.actor.id);
    assert.equal(a.actor.login, "wangqiang");
    const d = s.create("私有图稿", undefined, a.actor);
    const second = await s.accounts.login({ login: "WANGQIANG", password });
    assert.equal(second.actor.id, a.actor.id);
    assert.equal(s.access(d.id, second.actor).id, d.id);
    assert.throws(() => s.access(d.id, b.actor), fails(404));
    await assert.rejects(
      s.accounts.register({ login: "wangqiang", name: "冒领", password }),
      fails(409),
    );
    await assert.rejects(
      s.accounts.login({ login: "wangqiang", password: "wrong" }),
      fails(401),
    );
    await assert.rejects(
      s.accounts.login({ login: "missing", password }),
      fails(401),
    );
    await assert.rejects(
      s.accounts.register({ login: "short", name: "甲", password: "12345" }),
      fails(400),
    );
    const stored = s.accounts.user(a.actor.id).passwordHash;
    assert.match(stored, /^scrypt\$/);
    assert.ok(!stored.includes(password));
    assert.notEqual(stored, s.accounts.user(b.actor.id).passwordHash);
    const reopened = new WorkspaceStore(dir, 30000, () => clock.now);
    assert.equal(reopened.actor(a.token)?.id, a.actor.id);
    reopened.close();
    const short = await s.accounts.login({
      login: "wangqiang",
      password,
      remember: false,
    });
    clock.now += 2 * 86400000;
    assert.equal(s.actor(short.token), undefined);
    assert.equal(s.actor(a.token)?.id, a.actor.id);
    clock.now += 30 * 86400000;
    assert.equal(s.actor(a.token), undefined);
    assert.equal(
      (await s.accounts.login({ login: "wangqiang", password })).actor.id,
      a.actor.id,
    );
  }));
test("旧身份补设保留文件和授权，不允许同名注册认领，重复补设与并发注册受保护", () =>
  fixture(async (s) => {
    const old = s.enter("老王"),
      recipient = await s.accounts.register({
        login: "reader",
        name: "读者",
        password,
      });
    const d = s.create("旧文件", undefined, old.actor);
    s.share(
      d.id,
      {
        visibility: "selected",
        recipients: [recipient.actor.id],
        accessRevision: 1,
      },
      old.actor,
    );
    const fresh = await s.accounts.register({
      login: "oldwang",
      name: "老王",
      password,
    });
    assert.notEqual(fresh.actor.id, old.actor.id);
    const setup = await s.accounts.setup(old.actor, {
      login: "realwang",
      password,
    });
    assert.equal(setup.actor.id, old.actor.id);
    assert.equal(s.actor(old.token), undefined);
    assert.equal(s.get(d.id).owner, setup.actor.id);
    assert.equal(s.get(d.id).createdBy, "老王");
    assert.equal(s.access(d.id, recipient.actor).id, d.id);
    assert.equal(
      (await s.accounts.login({ login: "realwang", password })).actor.id,
      old.actor.id,
    );
    await assert.rejects(
      s.accounts.setup(setup.actor, { login: "third", password }),
      fails(409),
    );
    const race = await Promise.allSettled(
      [1, 2].map(() =>
        s.accounts.register({ login: "collision", name: "重复", password }),
      ),
    );
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  }));
test("管理员创建、重置一次性与过期、撤销旧会话及锁、修改密码撤销其他设备", () =>
  fixture(async (s, _dir, clock) => {
    const created = s.accounts.create(admin, { login: "member", name: "成员" });
    assert.ok(created.resetCode);
    assert.equal(
      s.db.prepare("SELECT hash FROM account_resets").get()!.hash ===
        created.resetCode,
      false,
    );
    const a = await s.accounts.redeem({ code: created.resetCode, password });
    await assert.rejects(
      s.accounts.redeem({ code: created.resetCode, password }),
      fails(400),
    );
    const second = await s.accounts.login({ login: "member", password });
    const d = s.create("稿", undefined, a.actor);
    s.acquire(d.id, a.actor, "member-tab");
    const reset = s.accounts.reset(admin, a.actor.id, {
      revision: s.accounts.user(a.actor.id).revision,
    });
    assert.equal(s.actor(a.token), undefined);
    assert.equal(s.actor(second.token), undefined);
    assert.equal(s.lock(d.id), undefined);
    await assert.rejects(
      s.accounts.login({ login: "member", password }),
      fails(401),
    );
    clock.now += 16 * 60000;
    await assert.rejects(
      s.accounts.redeem({ code: reset.resetCode, password }),
      fails(400),
    );
    const reset2 = s.accounts.reset(admin, a.actor.id, {
      revision: s.accounts.user(a.actor.id).revision,
    });
    const race = await Promise.allSettled(
      [1, 2].map(() => s.accounts.redeem({ code: reset2.resetCode, password })),
    );
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    const logged = await s.accounts.login({ login: "member", password });
    await assert.rejects(
      s.accounts.changePassword(logged.actor, {
        oldPassword: "wrong",
        password,
      }),
      fails(400),
    );
    const changed = await s.accounts.changePassword(logged.actor, {
      oldPassword: password,
      password: password + "-new",
    });
    assert.equal(s.actor(logged.token), undefined);
    assert.equal(changed.actor.id, a.actor.id);
    await assert.rejects(
      s.accounts.login({ login: "member", password }),
      fails(401),
    );
    assert.equal(
      (await s.accounts.login({ login: "member", password: password + "-new" }))
        .actor.id,
      a.actor.id,
    );
  }));
test("停用、启用、受保护删除及文件转移原子性、内容历史保留、并发管理冲突", () =>
  fixture(async (s) => {
    const a = await s.accounts.register({
        login: "source",
        name: "原创建者",
        password,
      }),
      b = await s.accounts.register({
        login: "target",
        name: "接收人",
        password,
      });
    const d = s.create("保留原稿", undefined, a.actor),
      draft = s.create("草稿", undefined, a.actor, true);
    s.share(
      d.id,
      { visibility: "everyone", recipients: [], accessRevision: 1 },
      a.actor,
    );
    assert.throws(() => s.accounts.list(a.actor), fails(403));
    assert.throws(
      () => s.accounts.remove(admin, a.actor.id, { revision: 1 }),
      fails(409),
    );
    s.accounts.status(admin, a.actor.id, { revision: 1, status: "disabled" });
    assert.equal(s.actor(a.token), undefined);
    await assert.rejects(
      s.accounts.login({ login: "source", password }),
      fails(401),
    );
    assert.throws(
      () =>
        s.accounts.status(admin, a.actor.id, { revision: 1, status: "active" }),
      fails(409),
    );
    assert.throws(
      () => s.accounts.remove(admin, a.actor.id, { revision: 2 }),
      fails(409),
    );
    const lock = s.acquire(d.id, b.actor, "other-editor");
    assert.throws(
      () =>
        s.accounts.transfer(admin, a.actor.id, {
          revision: 2,
          targetId: b.actor.id,
        }),
      fails(423),
    );
    assert.equal(s.get(draft.id).owner, a.actor.id);
    s.release(d.id, b.actor, lock.token);
    assert.equal(
      s.accounts.transfer(admin, a.actor.id, {
        revision: 2,
        targetId: b.actor.id,
      }).count,
      2,
    );
    assert.equal(s.get(d.id).owner, b.actor.id);
    assert.equal(s.get(d.id).visibility, "private");
    assert.equal(s.get(d.id).xml, d.xml);
    assert.equal(s.get(d.id).revision, d.revision);
    assert.equal(s.get(d.id).createdBy, "原创建者");
    assert.equal(s.get(draft.id).draft, 1);
    assert.equal(s.versions(d.id).length, 1);
    assert.throws(
      () => s.accounts.remove(admin, a.actor.id, { revision: 3 }, 1),
      fails(409),
    );
    s.accounts.remove(admin, a.actor.id, { revision: 3 });
    assert.throws(() => s.accounts.user(a.actor.id), fails(404));
    await assert.rejects(
      s.accounts.register({ login: "source", name: "冒领旧名", password }),
      fails(409),
    );
    const c = await s.accounts.register({
      login: "enable",
      name: "再启用",
      password,
    });
    s.accounts.status(admin, c.actor.id, { revision: 1, status: "disabled" });
    s.accounts.status(admin, c.actor.id, { revision: 2, status: "active" });
    assert.equal(s.actor(c.token), undefined);
    assert.equal(
      (await s.accounts.login({ login: "enable", password })).actor.id,
      c.actor.id,
    );
    const audit = JSON.stringify(
      s.db.prepare("SELECT * FROM account_audit").all(),
    );
    assert.ok(!audit.includes(password));
  }));
test("账号 HTTP：旧姓名入口不可冒领、普通成员不能管理、停用立即拒绝所有 API、限流", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-accounts-api-"));
  const server = await startServer({
    port: 0,
    shared: true,
    dataDirectory: dir,
  });
  const req = async (url: string, token = "", method = "GET", body?: any) => {
    const r = await fetch(server.origin + "/api/" + url, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    assert.equal(
      (await req("session", "", "POST", { name: "王强" })).status,
      400,
    );
    const a = (
      await req("auth/register", "", "POST", {
        login: "member",
        name: "王强",
        password,
        admin: true,
      })
    ).data;
    assert.equal(a.actor.admin, false);
    assert.equal((await req("admin/users", a.token)).status, 403);
    assert.equal(
      (
        await req("admin/users", a.token, "POST", {
          login: "bad",
          name: "越权",
        })
      ).status,
      403,
    );
    const users = (await req("admin/users", server.token)).data;
    assert.equal(users.length, 1);
    assert.equal(users[0].passwordHash, undefined);
    assert.equal(users[0].documents, 0);
    for (const suffix of ["/reset", "/transfer"])
      assert.equal(
        (
          await req(`admin/users/${a.actor.id}${suffix}`, a.token, "POST", {
            revision: 1,
          })
        ).status,
        403,
      );
    assert.equal(
      (
        await req(`admin/users/${a.actor.id}`, a.token, "DELETE", {
          revision: 1,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await req(`admin/users/${a.actor.id}`, server.token, "PATCH", {
          revision: 1,
          status: "disabled",
        })
      ).status,
      200,
    );
    assert.equal((await req("documents", a.token)).status, 401);
    assert.equal((await req("templates", a.token)).status, 401);
    for (let i = 0; i < 10; i++)
      await req("auth/reset", "", "POST", { code: "invalid", password });
    assert.equal(
      (await req("auth/reset", "", "POST", { code: "invalid", password }))
        .status,
      429,
    );
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("只剩个人模板的历史身份也进入管理列表，可原 ID 找回而不丢模板", async () => {
  const { TemplateStore } = await import("../apps/local-server/templates.ts");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-template-owner-"));
  const templates = new TemplateStore(dir);
  templates.db.prepare("INSERT INTO templates VALUES (?,?,?,?,?,?,?,?,?,?)").run("legacy-template", "legacy-owner", "旧模板", "", "architecture", "saved-xml", "saved-preview", 1, 0, Date.now());
  templates.close();
  const server = await startServer({ port: 0, shared: true, dataDirectory: dir });
  try {
    const user = server.workspace!.accounts.list(admin).find(u => u.id === "legacy-owner")!;
    assert.equal(user.name, "历史模板用户");
    const reset = server.workspace!.accounts.reset(admin, "legacy-owner", { revision: user.revision, login: "recovered" });
    const recovered = await server.workspace!.accounts.redeem({ code: reset.resetCode, password });
    assert.equal(recovered.actor.id, "legacy-owner");
    const rows = await (await fetch(server.origin + "/api/templates", { headers: { Authorization: "Bearer " + recovered.token } })).json();
    assert.equal(rows[0].id, "legacy-template");
  } finally { await server.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
