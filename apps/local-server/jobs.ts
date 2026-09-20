import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Renderer,
  type ExportOptions,
} from "../../packages/render-worker/index.ts";
type JobResult = {
  path: string;
  width: number;
  height: number;
  mime: string;
  warnings: unknown[];
};
type Job = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  created: number;
  xml?: string;
  options: ExportOptions;
  result?: JobResult;
  error?: string;
};
export class Jobs {
  jobs = new Map<string, Job>();
  running = false;
  closed = false;
  storage = mkdtemp(join(tmpdir(), "diagram-exports-"));
  cleanupTimer: NodeJS.Timeout;
  constructor(public renderer: Renderer) {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60000);
    this.cleanupTimer.unref();
  }
  add(xml: string, options: ExportOptions) {
    this.cleanup();
    if (
      [...this.jobs.values()].filter((j) => j.status === "queued").length >= 4
    )
      throw Error("QUEUE_FULL");
    const j: Job = {
      id: randomUUID(),
      status: "queued",
      created: Date.now(),
      xml,
      options,
    };
    this.jobs.set(j.id, j);
    void this.pump();
    return j.id;
  }
  cleanup() {
    for (const [id, j] of this.jobs)
      if (
        Date.now() - j.created > 600_000 &&
        ["succeeded", "failed", "cancelled"].includes(j.status)
      ) {
        if (j.result) void rm(j.result.path, { force: true });
        this.jobs.delete(id);
      }
  }
  async pump() {
    if (this.running || this.closed) return;
    const j = [...this.jobs.values()].find((j) => j.status === "queued");
    if (!j) return;
    this.running = true;
    j.status = "running";
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        this.renderer.render(j.xml!, j.options),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error("导出超时（30 秒）")), 30000);
        }),
      ]);
      if (j.status === "running") {
        const path = join(await this.storage, j.id + "." + j.options.format);
        await writeFile(path, result.data, { flag: "wx", mode: 0o600 });
        if ((j as Job).status === "cancelled" || this.closed)
          await rm(path, { force: true });
        else {
          const { data: _, ...metadata } = result;
          j.result = { path, ...metadata };
          j.status = "succeeded";
        }
      }
    } catch (e) {
      if ((j as Job).status !== "cancelled") {
        j.status = "failed";
        j.error = (e as Error).message;
      }
      await this.renderer.reset();
    } finally {
      clearTimeout(timer);
      delete j.xml;
      this.running = false;
      void this.pump();
    }
  }
  async cancel(id: string) {
    const j = this.jobs.get(id);
    if (!j) return false;
    const running = j.status === "running";
    j.status = "cancelled";
    delete j.xml;
    if (j.result) await rm(j.result.path, { force: true });
    delete j.result;
    if (running) await this.renderer.reset();
    return true;
  }
  async close() {
    this.closed = true;
    clearInterval(this.cleanupTimer);
    for (const j of this.jobs.values()) j.status = "cancelled";
    await this.renderer.close();
    await rm(await this.storage, { recursive: true, force: true });
  }
}
