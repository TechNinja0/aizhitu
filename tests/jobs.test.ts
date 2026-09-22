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

test("idle renderer closes once, new jobs wait for close and restart normally", async () => {
  let closes = 0,
    rendering = false,
    release: (() => void) | undefined;
  const renderer = {
    render: async () => {
      assert.equal(
        release,
        undefined,
        "must not render while browser is closing",
      );
      rendering = true;
      await wait(10);
      rendering = false;
      return {
        data: Buffer.from("ok"),
        mime: "image/png",
        width: 1,
        height: 1,
        warnings: [],
      };
    },
    reset: async () => {},
    close: async () => {
      assert.equal(rendering, false);
      closes++;
      await new Promise<void>((r) => {
        release = () => {
          release = undefined;
          r();
        };
      });
    },
  } as unknown as Renderer;
  const jobs = new Jobs(renderer, 20);
  try {
    const first = jobs.add("first", { format: "png" });
    for (let i = 0; !release && i < 100; i++) await wait(5);
    assert.equal(jobs.jobs.get(first)?.status, "succeeded");
    assert.equal(closes, 1);
    const next = jobs.add("next", { format: "png" });
    await wait(10);
    assert.equal(jobs.jobs.get(next)?.status, "queued");
    release!();
    for (let i = 0; jobs.jobs.get(next)?.status !== "succeeded" && i < 100; i++)
      await wait(5);
    assert.equal(jobs.jobs.get(next)?.status, "succeeded");
    await wait(40);
    assert.equal(closes, 2);
    release!();
    await wait(40);
    assert.equal(
      closes,
      2,
      "idle cleanup must not become a recurring close loop",
    );
  } finally {
    const closing = jobs.close();
    release?.();
    await closing;
  }
  assert.throws(() => jobs.add("late", { format: "png" }), /关闭/);
});

test("busy export is never closed by the idle timer", async () => {
  let active = false,
    closes = 0;
  const renderer = {
    render: async () => {
      active = true;
      await wait(70);
      active = false;
      return {
        data: Buffer.from("ok"),
        mime: "image/png",
        width: 1,
        height: 1,
        warnings: [],
      };
    },
    reset: async () => {},
    close: async () => {
      assert.equal(active, false);
      closes++;
    },
  } as unknown as Renderer;
  const jobs = new Jobs(renderer, 15);
  try {
    jobs.add("one", { format: "png" });
    jobs.add("two", { format: "png" });
    await wait(100);
    assert.equal(closes, 0);
    await wait(90);
    assert.equal(closes, 1);
  } finally {
    await jobs.close();
  }
});
