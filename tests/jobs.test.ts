import test from "node:test";
import assert from "node:assert/strict";
import { Jobs } from "../apps/local-server/jobs.ts";
import type { Renderer } from "../packages/render-worker/index.ts";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
test("export queue serializes jobs and enforces a bounded queue", async () => {
  let active = 0,
    max = 0;
  const renderer = {
    render: async () => {
      active++;
      max = Math.max(active, max);
      await wait(12);
      active--;
      return {
        data: Buffer.from("result"),
        mime: "image/png",
        width: 1,
        height: 1,
        warnings: [],
      };
    },
    reset: async () => {},
    close: async () => {},
  } as unknown as Renderer;
  const jobs = new Jobs(renderer);
  const ids = Array.from({ length: 5 }, () =>
    jobs.add("<xml/>", { format: "png" }),
  );
  assert.throws(() => jobs.add("<xml/>", { format: "png" }), /QUEUE_FULL/);
  await wait(120);
  assert.equal(max, 1);
  assert.ok(ids.every((id) => jobs.jobs.get(id)?.status === "succeeded"));
  await jobs.close();
});
test("cancelled queued task does not run or retain source bytes", async () => {
  let calls = 0;
  const renderer = {
    render: async () => {
      calls++;
      await wait(25);
      return {
        data: Buffer.alloc(1),
        mime: "image/png",
        width: 1,
        height: 1,
        warnings: [],
      };
    },
    reset: async () => {},
    close: async () => {},
  } as unknown as Renderer;
  const jobs = new Jobs(renderer);
  jobs.add("first", { format: "png" });
  const second = jobs.add("second", { format: "png" });
  await jobs.cancel(second);
  await wait(60);
  assert.equal(calls, 1);
  assert.equal(jobs.jobs.get(second)?.xml, undefined);
  assert.equal(jobs.jobs.get(second)?.status, "cancelled");
  await jobs.close();
});
test("cancelled running job discards late output; a failed job does not poison the next job", async () => {
  let calls = 0;
  const renderer = {
    render: async () => {
      const call = ++calls;
      await wait(15);
      if (call === 2) throw Error("expected render failure");
      return {
        data: Buffer.from("ok"),
        mime: "image/png",
        width: 1,
        height: 1,
        warnings: [],
      };
    },
    reset: async () => {},
    close: async () => {},
  } as unknown as Renderer;
  const jobs = new Jobs(renderer);
  const first = jobs.add("first", { format: "png" });
  await jobs.cancel(first);
  const failed = jobs.add("second", { format: "png" }),
    good = jobs.add("third", { format: "png" });
  await wait(100);
  assert.equal(jobs.jobs.get(first)?.status, "cancelled");
  assert.equal(jobs.jobs.get(first)?.result, undefined);
  assert.equal(jobs.jobs.get(failed)?.status, "failed");
  assert.equal(jobs.jobs.get(good)?.status, "succeeded");
  assert.equal(jobs.jobs.get(good)?.xml, undefined);
  await jobs.close();
});
