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
const status = (n: number) => (e: unknown) =>
  e instanceof HttpError && e.status === n;

test("分享读写权限默认只读、逐成员授权、降权即时撤销会话及旧编辑锁、持久化", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-share-roles-"));
  let s = new WorkspaceStore(dir);
  try {
    const a = s.enter("创建者").actor,
      b = s.enter("编辑者").actor,
      c = s.enter("查看者").actor;
    const d = s.create("权限测试", undefined, a);
    const share = (input: any) =>
      s.share(
        d.id,
        {
          accessRevision: s.get(d.id).accessRevision,
          recipients: [],
          ...input,
        },
        a,
      );
    share({ visibility: "everyone" });
    assert.equal(s.describe(d.id, b).canEdit, false);
    assert.equal(s.describe(d.id, a).canEdit, true);
    assert.throws(
      () => s.collaboration.join(d.id, b, "viewer-tab"),
      status(403),
    );
    assert.throws(() => s.acquire(d.id, b, "old-viewer"), status(403));
    share({
      visibility: "selected",
      recipients: [b.id, c.id],
      recipientRoles: { [b.id]: "edit", [c.id]: "view" },
    });
    assert.equal(s.describe(d.id, b).canEdit, true);
    assert.equal(s.listPage({ actor: c }).items[0].canEdit, false);
    assert.equal(s.sharing(d.id, a).recipientRoles[b.id], "edit");
    share({ visibility: "selected", recipients: [b.id, c.id] });
    assert.equal(
      s.describe(d.id, b).canEdit,
      true,
      "omitted roles preserve an existing grant",
    );
    const joined = s.collaboration.join(d.id, b, "editing-tab");
    share({
      visibility: "selected",
      recipients: [b.id, c.id],
      recipientRoles: { [b.id]: "view", [c.id]: "view" },
    });
    assert.equal(s.collaboration.members(d.id).length, 0);
    assert.throws(
      () =>
        s.collaboration.sync(
          d.id,
          { ...d, token: joined.token, requestId: "revoked-write" },
          b,
        ),
      status(403),
    );
    share({ visibility: "everyone", role: "edit" });
    const lock = s.acquire(d.id, b, "legacy-tab");
    share({ visibility: "everyone", role: "view" });
    assert.equal(s.lock(d.id), undefined);
    assert.throws(
      () => s.save(d.id, { ...d, lockToken: lock.token }, b),
      status(403),
    );
    assert.throws(
      () =>
        share({
          visibility: "selected",
          recipients: [b.id],
          recipientRoles: { [b.id]: "admin" },
        }),
      status(400),
    );
    s.close();
    s = new WorkspaceStore(dir);
    assert.equal(s.describe(d.id, b).canEdit, false);
    assert.equal(s.get(d.id).revision, 1);
  } finally {
    s.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("旧版分享迁移保留编辑授权，新文件只读默认，重复启动不重置权限", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-role-migration-"));
  let s = new WorkspaceStore(dir);
  try {
    const a = s.enter("甲").actor,
      b = s.enter("乙").actor;
    const everyone = s.create("所有成员旧文件", undefined, a),
      selected = s.create("指定成员旧文件", undefined, a),
      privateDoc = s.create("私有旧文件", undefined, a);
    s.share(
      everyone.id,
      { visibility: "everyone", recipients: [], accessRevision: 1 },
      a,
    );
    s.share(
      selected.id,
      { visibility: "selected", recipients: [b.id], accessRevision: 1 },
      a,
    );
    s.db.exec(
      "ALTER TABLE documents DROP COLUMN shareRole; ALTER TABLE document_members DROP COLUMN role;",
    );
    s.close();
    s = new WorkspaceStore(dir);
    assert.equal(s.describe(everyone.id, b).canEdit, true);
    assert.equal(s.describe(selected.id, b).canEdit, true);
    assert.equal(s.get(privateDoc.id).shareRole, "view");
    s.share(
      everyone.id,
      {
        visibility: "everyone",
        role: "view",
        recipients: [],
        accessRevision: 2,
      },
      a,
    );
    s.close();
    s = new WorkspaceStore(dir);
    assert.equal(s.describe(everyone.id, b).canEdit, false);
  } finally {
    s.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("只读 API 可读取内容和历史，拒绝协同、旧版保存、恢复与 AI 修改", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-role-api-"));
  const server = await startServer({
    port: 0,
    shared: true,
    dataDirectory: dir,
  });
  try {
    const s = server.workspace!,
      a = s.enter("甲"),
      b = s.enter("乙");
    const d = s.create("只读", undefined, a.actor);
    s.share(
      d.id,
      { visibility: "everyone", recipients: [], accessRevision: 1 },
      a.actor,
    );
    const request = async (
      url: string,
      method = "GET",
      body?: any,
      headers = {},
    ) =>
      fetch(server.origin + "/api/" + url, {
        method,
        headers: {
          Authorization: "Bearer " + b.token,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const base = "documents/" + d.id;
    for (const suffix of ["", "/state", "/versions", "/versions/1"])
      assert.equal((await request(base + suffix)).status, 200, suffix);
    for (const [suffix, method, body] of [
      ["/collaboration/join", "POST", { client: "forged-edit" }],
      [
        "/collaboration/sync",
        "POST",
        { ...d, requestId: "forged-request", token: "fake" },
      ],
      ["/lock", "POST", { client: "forged-old-edit" }],
      ["", "PUT", { ...d, lockToken: "fake" }],
      [
        "/versions/1/restore",
        "POST",
        { revision: d.revision, collaborationToken: "fake" },
      ],
    ] as const)
      assert.equal(
        (await request(base + suffix, method, body)).status,
        403,
        suffix,
      );
    const ai = await request(
      "ai/generate",
      "POST",
      {
        provider: "codex",
        mode: "edit",
        prompt: "修改",
        revision: 0,
        xml: d.xml,
      },
      { "X-Document-Id": d.id, "X-Collaboration-Token": "fake" },
    );
    assert.equal(ai.status, 403);
    assert.equal(s.get(d.id).revision, 1);
    assert.equal(s.collaboration.members(d.id).length, 0);
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
