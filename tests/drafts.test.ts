import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../apps/local-server/server.ts";
import {
  WorkspaceStore,
  HttpError,
} from "../apps/local-server/shared/store.ts";
const failure = (status: number) => (e: unknown) =>
  e instanceof HttpError && e.status === status;

test("文件 API 创建即入库且私有、保存和分享分离、管理员与同名身份隔离", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-draft-api-"));
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
  ) => {
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
    const a = (await request("", "auth/register", "POST", {login:"wang-a",password:"Account-testing-2026-safe", name: "王强" })).data,
      b = (await request("", "auth/register", "POST", {login:"wang-b",password:"Account-testing-2026-safe", name: "王强", admin: true }))
        .data;
    const d = (
      await request(a.token, "documents", "POST", {
        name: "草稿",
        draft: false,
      })
    ).data;
    assert.equal(d.draft, 0);
    assert.equal(d.visibility, "private");
    assert.equal((await request(a.token, "documents")).data.length, 1);
    assert.equal((await request(b.token, "documents")).data.length, 0);
    assert.equal((await request(server.token, "documents")).data.length, 1);
    for (const suffix of ["", "/state", "/versions", "/versions/1"])
      assert.equal(
        (await request(b.token, "documents/" + d.id + suffix)).status,
        404,
      );
    for (const suffix of [
      "/lock",
      "/publish",
      "/trash",
      "/untrash",
      "/versions/1/restore",
    ])
      assert.equal(
        (
          await request(b.token, "documents/" + d.id + suffix, "POST", {
            client: "other-tab",
            name: "偷改",
            revision: 1,
          })
        ).status,
        404,
      );
    assert.equal(
      (await request(b.token, "documents/" + d.id, "PUT", { ...d })).status,
      404,
    );
    assert.equal(
      (
        await request(b.token, "documents/" + d.id + "/name", "PATCH", {
          name: "偷改",
          revision: 1,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request(b.token, "documents/batch-trash", "POST", {
          items: [{ id: d.id, revision: 1 }],
        })
      ).status,
      404,
    );
    const lease = (
      await request(a.token, `documents/${d.id}/lock`, "POST", {
        client: "draft-owner-tab",
      })
    ).data;
    assert.equal(
      (
        await request(server.token, `documents/${d.id}`, "PUT", {
          xml: d.xml,
          name: "管理员保存",
          revision: 1,
        })
      ).status,
      423,
    );
    const saved = (
      await request(a.token, `documents/${d.id}`, "PUT", {
        xml: d.xml,
        name: "草稿修改",
        revision: 1,
        lockToken: lease.token,
      })
    ).data;
    assert.equal(
      (
        await request(a.token, `documents/${d.id}`, "PUT", {
          xml: d.xml,
          name: "正式图稿",
          revision: 1,
          lockToken: lease.token,
        })
      ).status,
      409,
    );
    const published = (
      await request(a.token, `documents/${d.id}`, "PUT", {
        xml: d.xml,
        name: "正式图稿",
        revision: saved.revision,
        lockToken: lease.token,
      })
    ).data;
    assert.equal(published.id, d.id);
    assert.equal(published.draft, 0);
    assert.equal(published.createdBy, "王强");
    assert.equal((await request(b.token, `documents/${d.id}`)).status, 404);
    assert.equal((await request(b.token, "documents")).data.length, 0);
    await request(a.token, `documents/${d.id}/sharing`, "PUT", {
      visibility: "everyone",
      recipients: [],
      accessRevision: 1,
    });
    assert.equal((await request(b.token, `documents/${d.id}`)).status, 200);
    assert.equal((await request(b.token, "documents")).data.length, 1);
    assert.equal((await request(b.token, "documents?mine=1")).data.length, 0);
    assert.equal(
      (
        await request(a.token, `documents/${d.id}/publish`, "POST", {
          name: "重复发布",
          revision: published.revision,
          lockToken: lease.token,
        })
      ).status,
      409,
    );
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("列表重命名与批量回收站按权限、编辑锁和版本校验，全批原子执行，可恢复原草稿状态", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-manage-"));
  let now = 1000;
  const store = new WorkspaceStore(dir, 30000, () => now),
    peer = new WorkspaceStore(dir, 30000, () => now);
  try {
    const a = store.enter("甲"),
      b = store.enter("乙"),
      admin = { id: "local-admin", name: "本机管理员", admin: true };
    const draft = store.create("私有草稿", undefined, a.actor, true),
      shared = store.create("已共享", undefined, a.actor),
      foreign = store.create("乙的图稿", undefined, b.actor);
    store.share(
      shared.id,
      { visibility: "everyone", recipients: [], accessRevision: 1 },
      a.actor,
    );
    store.share(
      foreign.id,
      { visibility: "everyone", recipients: [], accessRevision: 1 },
      b.actor,
    );
    assert.throws(
      () =>
        store.renameDocument(shared.id, { name: "越权", revision: 1 }, b.actor),
      failure(403),
    );
    const lock = peer.acquire(shared.id, b.actor, "editing-tab");
    assert.throws(
      () =>
        store.renameDocument(shared.id, { name: "抢改", revision: 1 }, a.actor),
      failure(423),
    );
    assert.throws(
      () =>
        store.batchTrash(
          {
            items: [
              { id: draft.id, revision: 1 },
              { id: shared.id, revision: 1 },
            ],
          },
          admin,
        ),
      failure(423),
    );
    assert.equal(store.get(draft.id).deleted, 0);
    peer.release(shared.id, b.actor, lock.token);
    const renamed = store.renameDocument(
      shared.id,
      { name: "改名成功", revision: 1 },
      a.actor,
    );
    assert.equal(renamed.createdBy, "甲");
    assert.throws(
      () =>
        store.batchTrash(
          {
            items: [
              { id: draft.id, revision: 1 },
              { id: shared.id, revision: 1 },
            ],
          },
          a.actor,
        ),
      failure(409),
    );
    assert.equal(store.get(draft.id).deleted, 0);
    assert.throws(
      () =>
        store.batchTrash(
          {
            items: [
              { id: draft.id, revision: 1 },
              { id: foreign.id, revision: 1 },
            ],
          },
          a.actor,
        ),
      failure(403),
    );
    assert.equal(store.get(draft.id).deleted, 0);
    store.batchTrash(
      {
        items: [
          { id: draft.id, revision: 1 },
          { id: shared.id, revision: renamed.revision },
        ],
      },
      a.actor,
    );
    assert.equal(store.list(true, a.actor).length, 2);
    assert.equal(store.list(true, b.actor).length, 1);
    assert.throws(
      () => peer.acquire(shared.id, b.actor, "late-editor"),
      failure(404),
    );
    const removed = store.get(draft.id, true);
    store.trash(draft.id, { revision: removed.revision }, a.actor, false);
    assert.equal(store.get(draft.id).draft, 1);
    assert.equal(store.list(false, b.actor, "drafts").length, 0);
    assert.throws(
      () =>
        store.batchTrash(
          {
            items: [
              { id: draft.id, revision: 3 },
              { id: draft.id, revision: 3 },
            ],
          },
          a.actor,
        ),
      failure(400),
    );
  } finally {
    store.close();
    peer.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("升级旧文件保留文件库状态，历史草稿跨重启合并到全部文件", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "zhitu-draft-migration-"),
  );
  let store = new WorkspaceStore(dir);
  try {
    const a = store.enter("甲"),
      old = store.create("原有图稿", undefined, a.actor);
    // The legacy schema predates both the draft column and pagination indexes.
    store.db.exec(`DROP INDEX documents_list_order;
      DROP INDEX documents_owner_order;
      ALTER TABLE documents DROP COLUMN draft`);
    store.close();
    store = new WorkspaceStore(dir);
    assert.equal(store.get(old.id).draft, 0);
    const indexes = store.db.prepare("PRAGMA index_list(documents)").all();
    assert.ok(indexes.some((index) => index.name === "documents_list_order"));
    assert.ok(indexes.some((index) => index.name === "documents_owner_order"));
    const d = store.create("未发布草稿", undefined, a.actor, true);
    store.close();
    store = new WorkspaceStore(dir);
    assert.equal(store.get(d.id).draft, 0);
    assert.equal(store.list(false, a.actor).length, 2);
    assert.equal(store.list(false, a.actor, "drafts").length, 0);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
