import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../apps/local-server/shared/store.ts";

test("创建人与最后保存人分开持久保存，历史版本淘汰、退出和重启不丢创建人", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-creator-"));
  let store = new WorkspaceStore(dir);
  try {
    const a = store.enter("王强"),
      b = store.enter("小张");
    const doc = store.create("架构图", undefined, a.actor);
    store.share(
      doc.id,
      {
        visibility: "everyone",
        role: "edit",
        recipients: [],
        accessRevision: 1,
      },
      a.actor,
    );
    const lock = store.acquire(doc.id, b.actor, "other-editor");
    let current = doc;
    for (let i = 0; i < 52; i++)
      current = store.save(
        doc.id,
        {
          name: `架构图${i}`,
          xml: doc.xml,
          revision: current.revision,
          lockToken: lock.token,
        },
        b.actor,
      );
    assert.equal(store.versions(doc.id).length, 50);
    assert.equal((store.list()[0] as any).createdBy, "王强");
    assert.equal((store.list()[0] as any).updatedBy, "小张");
    store.logout(a.token, a.actor);
    store.close();
    store = new WorkspaceStore(dir);
    assert.equal((store.list()[0] as any).createdBy, "王强");
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("旧库从创建版本或创建者身份补全，不能把后来的编辑人当创建人", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "zhitu-creator-migrate-"),
  );
  let store = new WorkspaceStore(dir);
  try {
    const a = store.enter("王强"),
      b = store.enter("小张");
    const original = store.create("有创建版本", undefined, a.actor),
      fallback = store.create("有创建者身份", undefined, a.actor),
      unknown = store.create("历史身份已移除", undefined, {
        id: "retired",
        name: "旧成员",
        admin: false,
      });
    for (const d of [original, fallback, unknown]) {
      store.share(
        d.id,
        {
          visibility: "everyone",
          role: "edit",
          recipients: [],
          accessRevision: 1,
        },
        { id: "local-admin", name: "管理员", admin: true },
      );
      const lock = store.acquire(d.id, b.actor, "test-editor");
      store.save(
        d.id,
        {
          name: d.name + "新版",
          xml: d.xml,
          revision: 1,
          lockToken: lock.token,
        },
        b.actor,
      );
    }
    store.db
      .prepare("DELETE FROM versions WHERE documentId IN (?,?) AND revision=1")
      .run(fallback.id, unknown.id);
    store.rename(a.actor, "王工");
    store.db.exec("ALTER TABLE documents DROP COLUMN createdBy");
    store.close();
    store = new WorkspaceStore(dir);
    assert.equal(store.get(original.id).createdBy, "王强");
    assert.equal(store.get(fallback.id).createdBy, "王工");
    assert.equal(store.get(unknown.id).createdBy, "历史创建者");
    for (const d of store.list()) assert.equal((d as any).updatedBy, "小张");
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
