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

test("分页在 SQL 中按权限、搜索和筛选计数，顺序稳定且仅返回当前页摘要", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-pages-"));
  const store = new WorkspaceStore(dir);
  try {
    const a = store.enter("甲").actor,
      b = store.enter("乙").actor,
      c = store.enter("丙").actor;
    for (let i = 0; i < 25; i++) store.create(`甲文件 ${i}`, undefined, a);
    const secret = store.create("秘密文件", undefined, b);
    const shared = store.create("共有 Alpha_100%", undefined, b);
    store.share(
      shared.id,
      { visibility: "everyone", recipients: [], accessRevision: 1 },
      b,
    );
    const selected = store.create("指定文件", undefined, b);
    store.share(
      selected.id,
      { visibility: "selected", recipients: [a.id], accessRevision: 1 },
      b,
    );
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = store.listPage({ actor: a, page });
      assert.equal(r.total, 27);
      assert.equal(r.page, page);
      assert.equal(r.items.length, page === 3 ? 7 : 10);
      assert.ok(r.items.every((d) => !("xml" in d)));
      seen.push(...r.items.map((d) => d.id as string));
    }
    assert.equal(new Set(seen).size, 27);
    assert.ok(!seen.includes(secret.id));
    assert.deepEqual(
      seen,
      store.list(false, a).map((d) => d.id),
    );
    assert.equal(store.listPage({ actor: c }).total, 1);
    assert.equal(store.listPage({ actor: a, mine: true }).total, 25);
    assert.equal(store.listPage({ actor: a, query: "秘密" }).total, 0);
    assert.equal(
      store.listPage({ actor: a, query: "alpha_100%" }).items[0].id,
      shared.id,
    );
    assert.equal(store.listPage({ actor: a, query: "%" }).total, 1);
    assert.equal(store.listPage({ actor: a, query: "' OR 1=1 --" }).total, 0);
    const last = store.listPage({ actor: a, page: 99 });
    assert.equal(last.page, 3);
    store.batchTrash(
      {
        items: store
          .listPage({ actor: a, mine: true, page: 3 })
          .items.map((d) => ({ id: d.id, revision: d.revision })),
      },
      a,
    );
    const clamped = store.listPage({ actor: a, mine: true, page: 3 });
    assert.equal(clamped.page, 2);
    assert.equal(clamped.total, 20);
    assert.equal(store.listPage({ actor: a, deleted: true }).total, 5);
    assert.equal(store.listPage({ actor: b, deleted: true }).total, 0);
    assert.equal(
      store.listPage({ actor: a, query: "无匹配", page: 99 }).page,
      1,
    );
    for (const options of [
      { page: 0 },
      { page: -1 },
      { page: 1.5 },
      { page: NaN },
      { pageSize: 0 },
      { pageSize: 101 },
      { pageSize: 1.2 },
      { query: "x".repeat(121) },
    ])
      assert.throws(
        () => store.listPage({ actor: a, ...options }),
        (e) => e instanceof HttpError && e.status === 400,
      );
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("分页 API 参数校验及旧列表协议兼容", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-pages-api-"));
  const server = await startServer({
    port: 0,
    shared: true,
    dataDirectory: dir,
  });
  try {
    server.workspace!.create("接口测试", undefined, {
      id: "local-admin",
      name: "管理员",
      admin: true,
    });
    const get = (q: string) =>
      fetch(server.origin + "/api/documents" + q, {
        headers: { Authorization: `Bearer ${server.token}` },
      });
    assert.ok(Array.isArray(await (await get("")).json()));
    const result = await (await get("?page=1&pageSize=10&q=接口")).json();
    assert.equal(result.total, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.pageSize, 10);
    for (const q of ["?page=abc", "?page=0", "?pageSize=101", "?pageSize=-1"])
      assert.equal((await get(q)).status, 400);
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
