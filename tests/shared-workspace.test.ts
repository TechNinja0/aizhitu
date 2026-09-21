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
import { AIService } from "../packages/ai-service/index.ts";
import { validate } from "../packages/document-core/index.ts";
const example = await fs.readFile(
  "fixtures/examples/architecture.drawio",
  "utf8",
);
const failure = (status: number) => (e: unknown) =>
  e instanceof HttpError && e.status === status;
test("文档：浏览器身份、独立 ID、跨连接锁、过期接管、冲突、版本与回收站持久化", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-shared-"));
  let time = 1000;
  const store = new WorkspaceStore(directory, 1000, () => time),
    peer = new WorkspaceStore(directory, 1000, () => time);
  try {
    const a = store.enter("甲"),
      b = store.enter("乙"),
      admin = { actor: { id: "local-admin", name: "本机管理员", admin: true } };
    assert.notEqual(
      store.enter("甲").actor.id,
      a.actor.id,
      "同名不会认领其他浏览器身份",
    );
    assert.throws(() => store.enter("  "), failure(400));
    assert.throws(() => store.enter("甲\n乙"), failure(400));
    assert.equal(store.actor(a.token)?.id, a.actor.id);
    const doc = store.create("架构图", example, a.actor),
      second = store.create("另一张图", example, b.actor);
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
    assert.notEqual(doc.id, second.id);
    assert.equal(validate(doc.xml).metadata!.documentId, doc.id);
    const lockA = store.acquire(doc.id, a.actor, "client-A");
    assert.throws(
      () => peer.acquire(doc.id, b.actor, "client-B"),
      failure(423),
    );
    assert.throws(
      () => store.acquire(doc.id, a.actor, "other-tab"),
      failure(423),
    );
    assert.ok(peer.acquire(second.id, b.actor, "client-B"));
    assert.equal((store.get(doc.id).lock as any).token, undefined);
    const payload = {
      xml: doc.xml.replaceAll("订单服务", "订单中心"),
      name: "重命名",
      revision: 1,
      lockToken: lockA.token,
    };
    assert.throws(() => store.save(doc.id, payload, b.actor), failure(423));
    const saved = store.save(doc.id, payload, a.actor);
    assert.equal(saved.revision, 2);
    assert.throws(() => peer.save(doc.id, payload, a.actor), failure(409));
    assert.equal(
      store.save(doc.id, { ...payload, revision: 2 }, a.actor).revision,
      2,
      "重复保存不创建重复版本",
    );
    time += 900;
    store.heartbeat(doc.id, a.actor, lockA.token);
    time += 500;
    assert.throws(
      () => peer.acquire(doc.id, b.actor, "client-B"),
      failure(423),
    );
    time += 600;
    const lockB = peer.acquire(doc.id, b.actor, "client-B");
    assert.throws(
      () => store.save(doc.id, { ...payload, revision: 2 }, a.actor),
      failure(423),
    );
    assert.throws(
      () => store.release(doc.id, a.actor, lockA.token),
      failure(423),
    );
    const restored = peer.restore(
      doc.id,
      1,
      { revision: 2, lockToken: lockB.token },
      b.actor,
    );
    assert.equal(restored.revision, 3);
    assert.equal(restored.name, "架构图");
    assert.match(restored.xml, /订单服务/);
    assert.throws(
      () =>
        store.trash(
          doc.id,
          { revision: 3, lockToken: lockB.token },
          b.actor,
          true,
        ),
      failure(403),
    );
    peer.release(doc.id, b.actor, lockB.token);
    const lockAdmin = store.acquire(doc.id, admin.actor, "admin-tab");
    store.trash(
      doc.id,
      { revision: 3, lockToken: lockAdmin.token },
      admin.actor,
      true,
    );
    assert.throws(() => store.get(doc.id), failure(404));
    assert.equal(store.list(true).length, 1);
    store.trash(doc.id, { revision: 4 }, a.actor, false);
    assert.equal(store.get(doc.id).revision, 5);
    const again = new WorkspaceStore(directory, 1000, () => time);
    assert.equal(again.get(doc.id).name, "架构图");
    assert.equal(again.versions(doc.id).length, 5);
    again.close();
    const l = store.acquire(doc.id, a.actor, "version-test");
    for (let i = 0; i < 52; i++) {
      const d = store.get(doc.id);
      store.save(
        doc.id,
        { ...d, name: `图稿 ${i}`, lockToken: l.token },
        a.actor,
      );
    }
    assert.equal(store.versions(doc.id).length, 50);
    store.logout(a.token, a.actor);
    assert.equal(store.actor(a.token), undefined);
    assert.equal(store.publicLock(doc.id), null);
  } finally {
    store.close();
    peer.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("共享 API：鉴权、同时抢锁、保存版本竞争、AI 排队和任务权限", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-api-"));
  let releaseRunner: (() => void) | undefined;
  const gate = new Promise<void>((r) => {
    releaseRunner = r;
  });
  let calls = 0,
    active = 0,
    maxActive = 0;
  const ai = await new AIService(directory, async (_file, args) => {
    calls++;
    active++;
    maxActive = Math.max(active, maxActive);
    await gate;
    await fs.writeFile(args[args.indexOf("-o") + 1], example);
    active--;
    return "{}";
  }).init();
  await ai.save({
    defaultProvider: "codex",
    providers: {
      codex: { path: process.execPath, model: "" },
      qoder: { path: process.execPath, model: "" },
    },
  });
  const server = await startServer({
    port: 0,
    shared: true,
    dataDirectory: directory,
    aiService: ai,
  });
  const request = async (
    token: string,
    url: string,
    method = "GET",
    body?: any,
    extra?: any,
  ) => {
    const r = await fetch(server.origin + "/api/" + url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    return { status: r.status, data: text ? JSON.parse(text) : null };
  };
  try {
    assert.equal((await request("", "documents")).status, 401);
    const login = async (name: string) =>
      (
        await request("", "auth/register", "POST", {
          login: "member-" + (name === "甲" ? "a" : "b"),
          password: "Account-testing-2026-safe",
          name,
        })
      ).data;
    const a = await login("甲"),
      b = await login("乙");
    const fakeAdmin = await request("", "auth/register", "POST", {
      login: "fakeadmin",
      name: "管理员",
      admin: true,
      key: "legacy-code",
      password: "Account-testing-2026-safe",
    });
    assert.equal(fakeAdmin.status, 200);
    assert.equal(fakeAdmin.data.actor.admin, false);
    assert.equal(
      (await request(fakeAdmin.data.token, "ai/settings", "POST", ai.config))
        .status,
      403,
    );
    assert.equal((await request(server.token, "session")).data.admin, true);
    const renamed = await request(a.token, "session", "PATCH", {
      name: "甲（更新）",
    });
    assert.equal(renamed.data.id, a.actor.id);
    assert.equal(renamed.data.name, "甲（更新）");

    let d = (
      await request(a.token, "documents", "POST", {
        name: "接口图",
        xml: example,
      })
    ).data;
    await request(a.token, `documents/${d.id}/sharing`, "PUT", {
      visibility: "everyone",
      role: "edit",
      recipients: [],
      accessRevision: 1,
    });
    assert.equal((await request(b.token, "documents/" + d.id)).data.id, d.id);
    const races = await Promise.all([
      request(a.token, `documents/${d.id}/lock`, "POST", {
        client: "client-A",
      }),
      request(b.token, `documents/${d.id}/lock`, "POST", {
        client: "client-B",
      }),
    ]);
    assert.deepEqual(races.map((r) => r.status).sort(), [200, 423]);
    const winner = races[0].status === 200 ? a : b,
      loser = winner === a ? b : a,
      lease = races.find((r) => r.status === 200)!.data;
    const saves = await Promise.all(
      ["改稿一", "改稿二"].map((name) =>
        request(winner.token, `documents/${d.id}`, "PUT", {
          xml: d.xml,
          name,
          revision: d.revision,
          lockToken: lease.token,
        }),
      ),
    );
    assert.deepEqual(saves.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (await request(loser.token, "ai/settings", "POST", ai.config)).status,
      403,
    );
    const hidden = await request(a.token, "ai/settings");
    assert.equal(hidden.data.config.providers.codex.path, "");
    assert.equal(ai.config.providers.codex.path, process.execPath);
    const input = {
      provider: "codex",
      prompt: "保持图稿",
      mode: "edit",
      revision: 0,
      xml: example,
    };
    assert.equal(
      (
        await request(
          loser.token,
          "ai/generate",
          "POST",
          { ...input, xml: d.xml },
          { "X-Document-Id": d.id },
        )
      ).status,
      423,
    );
    const ja = (await request(a.token, "ai/generate", "POST", input)).data;
    const jb = (await request(b.token, "ai/generate", "POST", input)).data;
    assert.equal(jb.status, "queued");
    assert.equal((await request(b.token, "ai/jobs/" + ja.id)).status, 404);
    assert.equal(
      (await request(b.token, "ai/jobs/" + ja.id, "DELETE")).status,
      404,
    );
    assert.equal((await request(a.token, "ai/jobs")).data.length, 1);
    await request(b.token, "ai/jobs/" + jb.id, "DELETE");
    await ai.jobs.get(jb.id)!.done;
    const jc = (await request(b.token, "ai/generate", "POST", input)).data;
    assert.equal(jc.status, "queued");
    ai.jobs.get(jc.id)!.createdAt -= 70 * 60 * 1000;
    assert.ok(
      (await request(b.token, "ai/jobs")).data.some(
        (job: any) => job.id === jc.id,
      ),
      "长时间排队任务仍然可见",
    );
    releaseRunner!();
    await Promise.all([...ai.jobs.values()].map((j) => j.done));
    assert.equal(ai.view(jc.id).status, "succeeded");
    assert.equal(calls, 2);
    assert.equal(maxActive, 1);
    assert.equal(ai.view(jb.id).status, "cancelled");
    assert.equal(
      (
        await request(a.token, "documents", "GET", undefined, {
          Origin: "http://untrusted.invalid",
        })
      ).status,
      403,
    );
  } finally {
    releaseRunner!();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
