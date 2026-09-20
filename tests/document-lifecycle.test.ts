import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WorkspaceStore } from "../apps/local-server/shared/store.ts";
const owner = { id: "owner", name: "创建者", admin: false };
const other = { id: "other", name: "另一成员", admin: false };
test("历史草稿合并进全部文件，保留 ID、内容、历史、创建人和回收站，仍然私有", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-migrate-files-"));
  let store = new WorkspaceStore(dir);
  try {
    const a = store.create("原草稿", undefined, owner, true);
    const b = store.create("回收站草稿", undefined, owner, true);
    store.db.prepare("UPDATE documents SET deleted=1 WHERE id=?").run(b.id);
    const versions = store.versions(a.id);
    store.close();
    store = new WorkspaceStore(dir);
    assert.equal(store.list(false, owner).length, 1);
    assert.equal((store.list(true, owner)[0] as any).id, b.id);
    assert.equal(store.list(false, other).length, 0);
    assert.deepEqual(store.versions(a.id), versions);
    assert.deepEqual(store.get(a.id), { ...a, draft: 0 });
    assert.throws(() => store.access(a.id, other));
    store.close();
    store = new WorkspaceStore(dir);
    assert.deepEqual(store.versions(a.id), versions);
    assert.equal(store.get(b.id, true).deleted, 1);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("首次保存响应丢失后重试只创建一份私有文件，重启后仍有效，并按用户隔离请求标识", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-create-file-"));
  let store = new WorkspaceStore(dir);
  try {
    const key = randomUUID();
    const a = store.create("首次保存", undefined, owner, false, key);
    store.close();
    store = new WorkspaceStore(dir);
    const retry = store.create("首次保存", undefined, owner, false, key);
    assert.equal(a.id, retry.id);
    assert.throws(
      () => store.create("另一个标签页修改", undefined, owner, false, key),
      /其他标签页/,
    );
    assert.equal(store.list(false, owner).length, 1);
    assert.equal(store.versions(a.id).length, 1);
    assert.equal(a.visibility, "private");
    const b = store.create("不同成员", undefined, other, false, key);
    assert.notEqual(b.id, a.id);
    assert.equal(store.list(false, other).length, 1);
    assert.throws(() => store.create("无效", undefined, owner, false, "bad"));
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
