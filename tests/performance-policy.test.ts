import test from "node:test";
import assert from "node:assert/strict";
import { limitHistory } from "../packages/editor-adapter/collaboration.js";
import {
  retainedDrafts,
  DRAFT_LIMITS,
  type DraftSummary,
} from "../apps/workbench/src/drafts.ts";

test("undo/redo share a byte and count budget but preserve the latest oversized step", () => {
  const entry = (n: number) => ({
    before: "a".repeat(n),
    after: "b".repeat(n),
  });
  const undo = Array.from({ length: 100 }, () => entry(1000)),
    redo = [entry(1000)];
  const newest = undo.at(-1);
  limitHistory(undo, redo, 20000);
  assert.equal(redo.length, 0);
  assert.equal(undo.length, 5);
  assert.equal(undo.at(-1), newest);
  const reverse = [undo.pop()!];
  limitHistory(reverse, undo, 8000);
  assert.equal(undo.length + reverse.length, 2);
  const oversized = [entry(20000)];
  limitHistory(oversized, undo, 100);
  assert.equal(oversized.length, 1);
  assert.equal(undo.length, 0);
  const small = Array.from({ length: 110 }, () => entry(1));
  limitHistory(small, []);
  assert.equal(small.length, 100);
});
const draft = (
  key: string,
  doc: string,
  time: number,
  bytes = 1024,
): DraftSummary => ({
  key,
  documentId: doc,
  session: key,
  name: key,
  revision: 1,
  time,
  bytes,
});
test("recovery drafts enforce count, per-document, age and bytes without dropping the current write", () => {
  const now = 100 * 86400_000;
  const items = Array.from({ length: 30 }, (_, i) =>
    draft(String(i), String(i), now - i),
  );
  assert.equal(retainedDrafts(items, undefined, now).length, 20);
  assert.equal(
    retainedDrafts(
      items.map((d) => ({ ...d, documentId: "same" })),
      undefined,
      now,
    ).length,
    3,
  );
  const large = items.map((d) => ({ ...d, bytes: 15 * 1024 * 1024 }));
  assert.equal(retainedDrafts(large, undefined, now).length, 2);
  const oldest = draft(
    "protected",
    "other",
    now - DRAFT_LIMITS.age - 100,
    50 * 1024 * 1024,
  );
  assert.deepEqual(retainedDrafts([...items, oldest], oldest.key, now), [
    oldest,
  ]);
  assert.deepEqual(
    retainedDrafts(
      [items[0], draft("expired", "old", now - DRAFT_LIMITS.age - 1)],
      undefined,
      now,
    ),
    [items[0]],
  );
});
