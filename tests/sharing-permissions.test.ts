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
const fails = (status: number) => (e: unknown) =>
  e instanceof HttpError && e.status === status;

test("分享权限：保存保持私有、指定身份、所有成员、原子校验、收回编辑锁、持久化", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-acl-"));
  let store = new WorkspaceStore(dir);
  try {
    const a = store.enter("创建者"),
      b = store.enter("王强"),
      twin = store.enter("王强"),
      c = store.enter("旁观者");
    const admin = { id: "local-admin", name: "管理员", admin: true };
    let d = store.create("我的文件", undefined, a.actor, true);
    assert.throws(
      () =>
        store.share(
          d.id,
          { visibility: "everyone", recipients: [], accessRevision: 1 },
          a.actor,
        ),
      fails(409),
    );
    d = store.publish(d.id, { name: d.name, revision: d.revision }, a.actor);
    assert.equal(d.visibility, "private");
    assert.equal(store.list(false, b.actor).length, 0);
    assert.throws(() => store.access(d.id, b.actor), fails(404));
    assert.equal(store.access(d.id, admin).id, d.id);
    store.sharing(d.id, a.actor); // merely opening the dialog must not share
    assert.throws(() => store.access(d.id, b.actor), fails(404));
    const grant = (
      visibility: string,
      recipients: string[],
      accessRevision = store.get(d.id).accessRevision,
    ) => store.share(d.id, { visibility, recipients, accessRevision }, a.actor);
    for (const recipients of [
      [],
      ["missing"],
      [b.actor.id, "missing"],
      [a.actor.id],
      [b.actor.id, b.actor.id],
    ]) {
      assert.throws(() => grant("selected", recipients), fails(400));
      assert.equal(store.get(d.id).visibility, "private");
    }
    grant("selected", [b.actor.id]);
    assert.equal(store.access(d.id, b.actor).id, d.id);
    for (const member of [twin, c]) {
      assert.equal(store.list(false, member.actor).length, 0);
      assert.throws(() => store.access(d.id, member.actor), fails(404));
    }
    assert.deepEqual(store.sharing(d.id, b.actor).recipients, []);
    assert.equal(store.sharing(d.id, b.actor).canManage, false);
    assert.throws(
      () =>
        store.share(
          d.id,
          { visibility: "everyone", recipients: [], accessRevision: 2 },
          b.actor,
        ),
      fails(403),
    );
    assert.throws(() => grant("everyone", [], 1), fails(409));
    assert.equal(
      store.get(d.id).revision,
      d.revision,
      "权限变更不干扰内容版本与自动保存",
    );
    const lease = store.acquire(d.id, b.actor, "granted-editor");
    grant("selected", [c.actor.id]);
    assert.equal(store.lock(d.id), undefined);
    assert.throws(
      () => store.heartbeat(d.id, b.actor, lease.token),
      fails(404),
    );
    assert.throws(
      () => store.save(d.id, { ...d, lockToken: lease.token }, b.actor),
      fails(404),
    );
    assert.equal(store.access(d.id, c.actor).id, d.id);
    grant("everyone", []);
    const newcomer = store.enter("后来加入");
    assert.equal(store.access(d.id, newcomer.actor).id, d.id);
    const ownerLease = store.acquire(d.id, a.actor, "owner-editor");
    grant("private", []);
    assert.equal(
      store.lock(d.id)?.token,
      ownerLease.token,
      "收回分享不会中断创建者自己的编辑",
    );
    assert.throws(() => store.access(d.id, newcomer.actor), fails(404));
    grant("selected", [c.actor.id]);
    store.rename(c.actor, "新名字");
    store.close();
    store = new WorkspaceStore(dir);
    assert.equal(store.access(d.id, c.actor).id, d.id);
    assert.throws(() => store.access(d.id, b.actor), fails(404));
    assert.equal(store.get(d.id).xml, d.xml);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("旧库迁移默认私有，保留内容和版本、移除未授权租约，重复启动不重置新权限", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-acl-migration-"));
  let store = new WorkspaceStore(dir);
  try {
    const a = store.enter("甲"),
      b = store.enter("乙");
    const d = store.create("历史文件", undefined, a.actor);
    store.share(
      d.id,
      { visibility: "everyone", recipients: [], accessRevision: 1 },
      a.actor,
    );
    store.acquire(d.id, b.actor, "old-editor");
    const versions = store.versions(d.id);
    store.db.exec(
      "DROP TABLE document_members; ALTER TABLE documents DROP COLUMN visibility; ALTER TABLE documents DROP COLUMN accessRevision;",
    );
    store.close();
    store = new WorkspaceStore(dir);
    assert.equal(store.get(d.id).visibility, "private");
    assert.equal(store.get(d.id).xml, d.xml);
    assert.equal(store.get(d.id).createdBy, d.createdBy);
    assert.deepEqual(store.versions(d.id), versions);
    assert.equal(store.lock(d.id), undefined);
    assert.throws(() => store.access(d.id, b.actor), fails(404));
    store.share(
      d.id,
      { visibility: "selected", recipients: [b.actor.id], accessRevision: 1 },
      a.actor,
    );
    store.close();
    store = new WorkspaceStore(dir);
    assert.equal(store.access(d.id, b.actor).visibility, "selected");
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("API 对列表、直链、历史、编辑、AI 统一鉴权，不能伪造分享和成员身份", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-acl-api-"));
  const server = await startServer({
    port: 0,
    shared: true,
    dataDirectory: dir,
  });
  const request = async (
    token: string,
    url: string,
    method = "GET",
    body?: any,
    headers = {},
  ) => {
    const r = await fetch(server.origin + "/api/" + url, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    const a = server.workspace!.enter("甲"),
      b = server.workspace!.enter("乙"),
      c = server.workspace!.enter("乙");
    const created = await request(a.token, "documents", "POST", {
      name: "私有文档",
      visibility: "everyone",
      draft: false,
    });
    const d = created.data;
    assert.equal(d.draft, 0);
    assert.equal(d.visibility, "private");
    const base = `documents/${d.id}`;
    const deny = async (token: string) => {
      assert.equal((await request(token, "documents")).data.length, 0);
      assert.equal(
        (await request(token, "documents?deleted=1")).data.length,
        0,
      );
      for (const suffix of [
        "",
        "/state",
        "/versions",
        "/versions/1",
        "/sharing",
      ])
        assert.equal((await request(token, base + suffix)).status, 404, suffix);
      for (const suffix of [
        "/lock",
        "/heartbeat",
        "/release",
        "/publish",
        "/trash",
        "/untrash",
        "/versions/1/restore",
      ])
        assert.equal(
          (
            await request(token, base + suffix, "POST", {
              client: "attacker-tab",
              revision: d.revision,
            })
          ).status,
          404,
          suffix,
        );
      for (const suffix of ["", "/sharing"])
        assert.equal(
          (
            await request(token, base + suffix, "PUT", {
              ...d,
              visibility: "everyone",
              recipients: [],
              accessRevision: 1,
            })
          ).status,
          404,
        );
      assert.equal(
        (
          await request(token, base + "/name", "PATCH", {
            name: "偷改",
            revision: d.revision,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            token,
            "ai/generate",
            "POST",
            {
              provider: "codex",
              mode: "edit",
              prompt: "偷改",
              revision: 0,
              xml: d.xml,
            },
            { "X-Document-Id": d.id },
          )
        ).status,
        404,
      );
    };
    await deny(b.token);
    assert.equal((await request("", "members")).status, 401);
    const roster = (await request(a.token, "members")).data;
    assert.equal(roster.length, 3);
    assert.deepEqual(Object.keys(roster[0]).sort(), ["id", "login", "name"]);
    assert.equal(
      (
        await request(a.token, base + "/sharing", "PUT", {
          visibility: "selected",
          recipients: [b.actor.id],
          accessRevision: 1,
        })
      ).status,
      200,
    );
    assert.equal((await request(b.token, base)).status, 200);
    assert.equal(
      (
        await request(b.token, base + "/sharing", "PUT", {
          visibility: "everyone",
          recipients: [],
          accessRevision: 2,
        })
      ).status,
      403,
    );
    await deny(c.token);
    const lock = (
      await request(b.token, base + "/lock", "POST", {
        client: "selected-member",
      })
    ).data;
    assert.ok(lock.token);
    assert.equal(
      (
        await request(a.token, base + "/sharing", "PUT", {
          visibility: "private",
          recipients: [],
          accessRevision: 2,
        })
      ).status,
      200,
    );
    await deny(b.token);
    assert.equal(server.workspace!.lock(d.id), undefined);
    assert.equal((await request(server.token, base)).status, 200);
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
