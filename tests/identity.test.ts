import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../apps/local-server/shared/store.ts";

test("用户名身份跨重启和时间保留，改名不改变文件归属，同名不能接管身份", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-identity-"));
  let clock = Date.now(),
    store = new WorkspaceStore(dir, 30000, () => clock);
  try {
    const member = store.enter("小王"),
      doc = store.create("图稿", undefined, member.actor);
    const lock = store.acquire(doc.id, member.actor, "browser-tab-1");
    const renamed = store.rename(member.actor, "王工");
    assert.equal(renamed.id, member.actor.id);
    assert.equal(store.actor(member.token)?.name, "王工");
    assert.equal(store.publicLock(doc.id)?.name, "王工");
    assert.equal(store.get(doc.id).owner, renamed.id);
    assert.notEqual(store.enter("王工").actor.id, renamed.id);
    store.release(doc.id, renamed, lock.token);
    clock += 365 * 86400000;
    store.close();
    store = new WorkspaceStore(dir, 30000, () => clock);
    assert.deepEqual(store.actor(member.token), renamed);
    assert.equal(store.get(doc.id).owner, renamed.id);
    assert.equal(
      store.db
        .prepare("SELECT name FROM sqlite_master WHERE name='accounts'")
        .get(),
      undefined,
    );
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("升级保留旧有效身份、移除远程管理员权限、不复活已失效身份", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "zhitu-identity-migrate-"),
  );
  const now = Date.now(),
    hash = (s: string) => createHash("sha256").update(s).digest("hex");
  let store = new WorkspaceStore(dir, 30000, () => now);
  try {
    store.db
      .prepare("INSERT INTO sessions VALUES (?,?,?,?,?)")
      .run(hash("old-admin"), "old-owner", "旧名字", 1, now + 1000);
    store.db
      .prepare("INSERT INTO sessions VALUES (?,?,?,?,?)")
      .run(hash("expired"), "expired-owner", "已失效", 1, now - 1000);
    const doc = store.create("旧图稿", undefined, {
      id: "old-owner",
      name: "旧名字",
      admin: true,
    });
    store.close();
    store = new WorkspaceStore(dir, 30000, () => now);
    assert.deepEqual(store.actor("old-admin"), {
      id: "old-owner",
      name: "旧名字",
      admin: false,
      login: null, needsSetup: true,
    });
    assert.equal(store.get(doc.id).owner, "old-owner");
    assert.equal(store.actor("expired"), undefined);
    store.close();
    store = new WorkspaceStore(dir, 30000, () => now + 365 * 86400000);
    assert.equal(store.actor("old-admin"), undefined, "旧有限期会话不能在重启后被无限延长");
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
