import test from "node:test";
import assert from "node:assert/strict";
import {
  collaborationInterval,
  collaborationPresentation,
} from "../apps/workbench/src/collaboration-policy.ts";

test("无修改时单页 5 秒、多页 1 秒、后台 10 秒；待同步内容始终优先", () => {
  assert.equal(
    collaborationInterval({ pending: false, hidden: false, pages: 1 }),
    5000,
  );
  assert.equal(
    collaborationInterval({ pending: false, hidden: false, pages: 2 }),
    1000,
  );
  assert.equal(
    collaborationInterval({ pending: false, hidden: true, pages: 2 }),
    10000,
  );
  for (const hidden of [true, false])
    for (const pages of [1, 2, 32]) {
      assert.equal(
        collaborationInterval({ pending: true, hidden, pages }),
        1000,
      );
    }
});

test("状态按权限和账号身份分类，同账号多页与同名不同人分别统计", () => {
  const doc = { owner: "owner", visibility: "private" };
  const a = { owner: "owner", name: "同名", client: "first" };
  const single = collaborationPresentation(doc, [a], "owner");
  assert.equal(single.scope, "仅自己可见");
  assert.equal(single.mode, "编辑中");
  assert.equal(single.membersText, "");
  assert.match(single.scopeTitle, /管理员/);
  assert.equal(
    collaborationPresentation(
      doc,
      [{ ...a, owner: "local-admin" }],
      "local-admin",
    ).scope,
    "私有文件",
  );
  const twin = collaborationPresentation(
    doc,
    [a, { ...a, client: "second" }],
    "owner",
  );
  assert.equal(twin.mode, "");
  assert.equal(twin.membersText, "同名（你）在 2 个页面编辑");
  const shared = collaborationPresentation(
    { ...doc, visibility: "selected" },
    [a],
    "owner",
  );
  assert.equal(shared.scope, "已分享");
  assert.equal(shared.mode, "编辑中");
  assert.equal(shared.membersText, "");
  const multiple = collaborationPresentation(
    { ...doc, visibility: "everyone" },
    [a, { ...a, client: "second" }, { ...a, owner: "other", client: "third" }],
    "owner",
  );
  assert.equal(multiple.scope, "已分享");
  assert.equal(multiple.mode, "");
  assert.equal(multiple.membersText, "同名、同名（你）正在编辑");
  assert.equal(
    multiple.membersTitle,
    "同名 · 1 个编辑页面；同名（你） · 2 个编辑页面",
  );
});

test("查看者显示实际编辑成员，不把自己算入；名单稳定且多人时收起长名单", () => {
  const doc = { owner: "a", visibility: "selected" };
  const a = { owner: "a", name: "王强", client: "1" },
    b = { owner: "b", name: "小张", client: "2" };
  const viewer = collaborationPresentation(doc, [a], "b", true);
  assert.equal(viewer.mode, "仅查看");
  assert.equal(viewer.membersText, "王强正在编辑");
  assert.equal(collaborationPresentation(doc, [], "b", true).membersText, "");
  const both = collaborationPresentation(doc, [b, a], "b");
  assert.equal(both.membersText, "王强、小张（你）正在编辑");
  assert.deepEqual(both, collaborationPresentation(doc, [a, b], "b"));
  const many = collaborationPresentation(
    doc,
    [
      a,
      b,
      { owner: "c", name: "成员丙", client: "3" },
      { owner: "d", name: "成员丁", client: "4" },
    ],
    "b",
  );
  assert.match(many.membersText, /等 4 人正在编辑$/);
  assert.match(many.membersTitle, /王强/);
  assert.match(many.membersTitle, /小张（你）/);
});
