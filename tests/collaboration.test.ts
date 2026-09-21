import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  WorkspaceStore,
  HttpError,
} from "../apps/local-server/shared/store.ts";
import {
  mergeXml,
  equivalentXml,
} from "../packages/editor-adapter/collaboration.js";
import { validate } from "../packages/document-core/index.ts";
const source = await fs.readFile("fixtures/examples/flow.drawio", "utf8");
const change = (
  xml: string,
  id: string,
  attrs: Record<string, string>,
  tag = "mxCell",
) => {
  const d = new DOMParser().parseFromString(xml, "text/xml");
  const cell = Array.from(d.getElementsByTagName("mxCell")).find(
    (n) => n.getAttribute("id") === id,
  )!;
  const node = tag === "mxCell" ? cell : cell.getElementsByTagName(tag)[0];
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return new XMLSerializer().serializeToString(d);
};
const merge = (
  base: string,
  local: string,
  remote: string,
  conditional = false,
) => mergeXml(base, local, remote, DOMParser, XMLSerializer, conditional);
const value = (xml: string, id: string) =>
  validate(xml).cells!.find((c) => c.id === id)!;

test("属性合并、命名样式边界、同属性后提交、仅撤销自己的修改", () => {
  const a = change(source, "start", { value: "甲" });
  const b = change(
    change(source, "check", { value: "乙" }),
    "start",
    { x: "300" },
    "mxGeometry",
  );
  const result = merge(source, a, b);
  assert.equal(value(result.xml, "start").label, "甲");
  assert.equal(value(result.xml, "start").geometry.x, "300");
  assert.equal(value(result.xml, "check").label, "乙");
  const same = merge(source, change(source, "start", { value: "最后" }), a);
  assert.equal(value(same.xml, "start").label, "最后");
  assert.ok(same.conflicts.includes("start.value"));
  const undone = merge(a, source, result.xml, true);
  assert.equal(value(undone.xml, "start").label, "提交申请");
  assert.equal(value(undone.xml, "start").geometry.x, "300");
  assert.equal(value(undone.xml, "check").label, "乙");
  assert.equal(
    value(merge(a, source, same.xml, true).xml, "start").label,
    "最后",
  );
  const style = value(source, "start").style;
  const styled = merge(
    source,
    change(source, "start", {
      style: style.replace("fillColor=#ffffff", "fillColor=#ff0000"),
    }),
    change(source, "start", {
      style: style.replace("strokeColor=#648373", "strokeColor=#0000ff"),
    }),
  );
  assert.match(value(styled.xml, "start").style, /fillColor=#ff0000/);
  assert.match(value(styled.xml, "start").style, /strokeColor=#0000ff/);
  assert.match(value(styled.xml, "start").style, /ellipse;/);
});

test("删除优先、依赖边清理、对象 ID 冲突与循环分组拒绝", () => {
  const doc = new DOMParser().parseFromString(source, "text/xml");
  const node = Array.from(doc.getElementsByTagName("mxCell")).find(
    (n) => n.getAttribute("id") === "start",
  )!;
  node.parentNode!.removeChild(node);
  const deleted = new XMLSerializer().serializeToString(doc);
  const result = merge(
    source,
    change(source, "start", { value: "迟到" }),
    deleted,
  );
  assert.ok(validate(result.xml).ok);
  assert.ok(
    !validate(result.xml).cells!.some((c) => ["start", "f1"].includes(c.id)),
  );
  const a = change(source, "start", { parent: "check" }),
    b = change(source, "check", { parent: "start" });
  assert.throws(() => merge(source, a, b), /循环/);
  assert.ok(
    equivalentXml(
      source,
      source.replace('compressed="false"', 'compressed="false" modified="now"'),
      DOMParser,
    ),
  );
});

test("协同持久化、跨连接事务、重发幂等、会话隔离、撤权和旧基线保护", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-collab-"));
  let now = 1000;
  let store = new WorkspaceStore(dir, 1000, () => now);
  const peer = new WorkspaceStore(dir, 1000, () => now);
  try {
    const a = store.enter("甲").actor,
      b = store.enter("乙").actor,
      c = store.enter("丙").actor;
    const d = store.create("协作", source, a);
    store.share(
      d.id,
      {
        visibility: "selected",
        role: "edit",
        recipients: [b.id],
        accessRevision: 1,
      },
      a,
    );
    const sa = store.collaboration.join(d.id, a, "client-aa"),
      sb = peer.collaboration.join(d.id, b, "client-bb");
    const status = (n: number) => (e: unknown) =>
      e instanceof HttpError && e.status === n;
    assert.equal(store.collaboration.members(d.id).length, 2);
    const summary = store
      .listPage({ actor: a })
      .items.find((item) => item.id === d.id)!;
    assert.equal(summary.collaborators.length, 2, "分页列表保留协同占用状态");
    assert.ok(summary.collaborators.every((member) => !("token" in member)));
    assert.throws(
      () =>
        store.batchTrash({ items: [{ id: d.id, revision: d.revision }] }, a),
      status(423),
    );
    assert.throws(
      () => store.collaboration.join(d.id, c, "client-cc"),
      status(404),
    );
    assert.throws(() => store.acquire(d.id, a, "exclusive"), status(423));
    assert.throws(
      () => store.renameDocument(d.id, { name: "new", revision: 1 }, a),
      status(423),
    );
    const payload = {
      token: sa.token,
      requestId: randomUUID(),
      revision: 1,
      name: d.name,
      xml: change(d.xml, "start", { value: "甲" }),
    };
    assert.throws(
      () => store.collaboration.sync(d.id, payload, b),
      status(423),
    );
    const first = store.collaboration.sync(d.id, payload, a);
    const second = peer.collaboration.sync(
      d.id,
      {
        ...payload,
        token: sb.token,
        requestId: randomUUID(),
        xml: change(d.xml, "check", { value: "乙" }),
      },
      b,
    );
    assert.equal(value(second.document.xml, "start").label, "甲");
    assert.equal(value(second.document.xml, "check").label, "乙");
    assert.equal(second.document.revision, 3);
    const noOp = store.collaboration.sync(
      d.id,
      {
        ...payload,
        requestId: randomUUID(),
        revision: 3,
        xml: second.document.xml,
      },
      a,
    );
    assert.equal(noOp.document.revision, 3);
    store.close();
    store = new WorkspaceStore(dir, 1000, () => now);
    const retry = store.collaboration.sync(d.id, payload, a);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.document.revision, 3);
    assert.equal(value(retry.document.xml, "check").label, "乙");
    assert.throws(
      () => store.collaboration.sync(d.id, { ...payload, name: "其他" }, a),
      status(409),
    );
    const oldB = {
      token: sb.token,
      requestId: randomUUID(),
      revision: 1,
      name: d.name,
      xml: d.xml,
    };
    store.share(
      d.id,
      { visibility: "private", recipients: [], accessRevision: 2 },
      a,
    );
    assert.throws(() => peer.collaboration.sync(d.id, oldB, b), status(404));
    store.share(
      d.id,
      {
        visibility: "everyone",
        role: "edit",
        recipients: [],
        accessRevision: 3,
      },
      a,
    );
    assert.throws(() => peer.collaboration.sync(d.id, oldB, b), status(423));
    now += 30_001;
    assert.throws(
      () => store.collaboration.state(d.id, a, sa.token),
      status(423),
    );
    const lock = store.acquire(d.id, a, "exclusive");
    assert.throws(
      () => store.collaboration.join(d.id, b, "client-bb"),
      status(423),
    );
    store.release(d.id, a, lock.token);
    const joined = store.collaboration.join(d.id, a, "client-aa");
    for (let i = 0; i < 51; i++) {
      const current = store.get(d.id);
      store.collaboration.sync(
        d.id,
        {
          token: joined.token,
          requestId: randomUUID(),
          revision: current.revision,
          name: "版本" + i,
          xml: current.xml,
        },
        a,
      );
    }
    assert.throws(
      () =>
        store.collaboration.sync(
          d.id,
          { ...payload, token: joined.token, requestId: randomUUID() },
          a,
        ),
      status(409),
    );
    assert.equal(
      store.collaboration.sync(d.id, { ...payload, token: joined.token }, a)
        .duplicate,
      true,
      "已确认请求即使基线已淘汰仍可安全重试",
    );
    assert.equal(store.versions(d.id).length, 50);
    assert.equal(first.document.revision, 2);
  } finally {
    store.close();
    peer.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("并发改名、循环合并回滚、伪造文档和无效图稿不能部分落盘", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-collab-atomic-"));
  const store = new WorkspaceStore(dir);
  try {
    const a = store.enter("甲").actor,
      b = store.enter("乙").actor;
    const d = store.create("原名", source, a);
    store.share(
      d.id,
      {
        visibility: "everyone",
        role: "edit",
        recipients: [],
        accessRevision: 1,
      },
      a,
    );
    const sa = store.collaboration.join(d.id, a, "client-aa");
    const sb = store.collaboration.join(d.id, b, "client-bb");
    const payload = {
      revision: d.revision,
      requestId: randomUUID(),
      token: sa.token,
      name: "新名称",
      xml: change(d.xml, "start", { parent: "check" }),
    };
    store.collaboration.sync(d.id, payload, a);
    const status = (n: number) => (e: unknown) =>
      e instanceof HttpError && e.status === n;
    assert.throws(
      () =>
        store.collaboration.sync(
          d.id,
          {
            ...payload,
            token: sb.token,
            requestId: randomUUID(),
            name: d.name,
            xml: change(d.xml, "check", { parent: "start" }),
          },
          b,
        ),
      status(409),
    );
    assert.equal(store.get(d.id).revision, 2, "合并失败不留下版本或部分变更");
    assert.equal(store.versions(d.id).length, 2);
    const merged = store.collaboration.sync(
      d.id,
      {
        ...payload,
        token: sb.token,
        requestId: randomUUID(),
        name: d.name,
        xml: change(d.xml, "fix", { value: "乙继续" }),
      },
      b,
    );
    assert.equal(
      merged.document.name,
      "新名称",
      "没有改名的旧页面保留他人新名称",
    );
    assert.equal(value(merged.document.xml, "fix").label, "乙继续");
    const foreign = store.create("另一份", source, a);
    assert.throws(
      () =>
        store.collaboration.sync(
          d.id,
          { ...payload, requestId: randomUUID(), xml: foreign.xml },
          a,
        ),
      status(409),
    );
    assert.throws(
      () =>
        store.collaboration.sync(
          d.id,
          {
            ...payload,
            requestId: randomUUID(),
            xml: change(d.xml, "start", { value: "<script>alert(1)</script>" }),
          },
          a,
        ),
      status(422),
    );
    assert.equal(store.get(d.id).revision, 3);
    assert.throws(
      () => store.collaboration.state(foreign.id, a, sa.token),
      status(423),
    );
    const same = store.collaboration.state(d.id, a, sa.token, 3);
    assert.equal(same.document.xml, undefined, "无变化的心跳不重复返回 XML");
    assert.ok(same.members.every((row) => !("token" in row)));
    store.logout("irrelevant-token", a);
    assert.throws(
      () => store.collaboration.state(d.id, a, sa.token),
      status(423),
    );
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("协同整稿操作：仅当前页面可恢复或删除，其他页面、伪造令牌和过期版本受保护", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "zhitu-collab-management-"),
  );
  const store = new WorkspaceStore(dir);
  const peer = new WorkspaceStore(dir);
  try {
    const a = store.enter("甲").actor,
      b = store.enter("乙").actor;
    const d = store.create("原始", source, a);
    store.share(
      d.id,
      {
        visibility: "everyone",
        role: "edit",
        recipients: [],
        accessRevision: 1,
      },
      a,
    );
    const own = store.collaboration.join(d.id, a, "client-aa");
    const other = peer.collaboration.join(d.id, a, "client-twin");
    const status = (n: number) => (e: unknown) =>
      e instanceof HttpError && e.status === n;
    let input = { collaborationToken: own.token, revision: d.revision };
    assert.throws(() => store.restore(d.id, 1, input, a), status(423));
    assert.throws(() => store.trash(d.id, input, a, true), status(423));
    assert.equal(store.get(d.id).revision, 1);
    peer.collaboration.leave(d.id, a, other.token);
    assert.throws(
      () =>
        store.restore(d.id, 1, { ...input, collaborationToken: "forged" }, a),
      status(423),
    );
    assert.throws(() => store.restore(d.id, 1, input, b), status(423));
    const changed = store.collaboration.sync(
      d.id,
      {
        token: own.token,
        revision: 1,
        requestId: randomUUID(),
        name: "改名",
        xml: change(d.xml, "start", { value: "改动" }),
      },
      a,
    ).document;
    assert.throws(() => store.restore(d.id, 1, input, a), status(409));
    input.revision = changed.revision;
    const restored = store.restore(d.id, 1, input, a);
    assert.equal(restored.revision, 3);
    assert.equal(restored.name, "原始");
    assert.equal(value(restored.xml, "start").label, "提交申请");
    assert.equal(store.collaboration.members(d.id).length, 1);
    const guest = peer.collaboration.join(d.id, b, "client-bb");
    assert.throws(
      () => store.trash(d.id, { ...input, revision: 3 }, a, true),
      status(423),
    );
    assert.throws(
      () =>
        store.trash(
          d.id,
          { collaborationToken: guest.token, revision: 3 },
          b,
          true,
        ),
      status(403),
    );
    peer.collaboration.leave(d.id, b, guest.token);
    const deleted = store.trash(d.id, { ...input, revision: 3 }, a, true);
    assert.equal(deleted.deleted, 1);
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS n FROM collaborators WHERE documentId=?")
        .get(d.id)!.n,
      0,
    );
    assert.throws(
      () => store.collaboration.state(d.id, a, own.token),
      status(404),
    );
    store.trash(d.id, { revision: deleted.revision }, a, false);
    assert.ok(store.collaboration.join(d.id, b, "client-bb").token);
  } finally {
    store.close();
    peer.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
