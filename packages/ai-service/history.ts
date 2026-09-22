import { documentModel } from "../document-tools/model.ts";
import { compareDocuments } from "../document-tools/diff.ts";
import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
import path from "node:path";
export const HISTORY_LIMITS = { count: 100, bytes: 128 * 1024 * 1024 };
export class AIHistory {
  db: DatabaseSync;
  constructor(
    directory: string,
    public limits = HISTORY_LIMITS,
  ) {
    const file = path.join(directory, "ai-history.sqlite");
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS ai_history(id TEXT PRIMARY KEY,owner TEXT NOT NULL,documentId TEXT NOT NULL,createdAt INTEGER NOT NULL,status TEXT NOT NULL,bytes INTEGER NOT NULL,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ai_history_owner_doc ON ai_history(owner,documentId,createdAt DESC);
    CREATE TABLE IF NOT EXISTS ai_history_links(owner TEXT NOT NULL,sourceId TEXT NOT NULL,documentId TEXT NOT NULL,PRIMARY KEY(owner,sourceId));
    CREATE TABLE IF NOT EXISTS ai_history_preferences(owner TEXT PRIMARY KEY,days INTEGER NOT NULL DEFAULT 30);`);
    const interrupted = this.db
      .prepare(
        "SELECT payload FROM ai_history WHERE status IN ('queued','running','validating')",
      )
      .all();
    for (const row of interrupted) {
      const job = JSON.parse(String(row.payload));
      job.status = "failed";
      job.error = "服务已重启，任务已中断；请重新发送，未自动调用模型";
      job.finishedAt = Date.now();
      this.put(job);
    }
  }
  days(owner: string) {
    return Number(
      this.db
        .prepare("SELECT days FROM ai_history_preferences WHERE owner=?")
        .get(owner)?.days || 30,
    );
  }
  clean(owner: string) {
    this.db
      .prepare(
        "DELETE FROM ai_history WHERE owner=? AND createdAt<? AND status NOT IN ('queued','running','validating')",
      )
      .run(owner, Date.now() - this.days(owner) * 86400000);
    let rows = this.db
        .prepare(
          "SELECT id,bytes,status FROM ai_history WHERE owner=? ORDER BY createdAt DESC,id DESC",
        )
        .all(owner),
      bytes = rows.reduce((s, r) => s + Number(r.bytes), 0),
      count = rows.length;
    for (const row of rows.reverse())
      if (
        (bytes > this.limits.bytes || count > this.limits.count) &&
        !["queued", "running", "validating"].includes(String(row.status))
      ) {
        this.db.prepare("DELETE FROM ai_history WHERE id=?").run(row.id);
        bytes -= Number(row.bytes);
        count--;
      }
  }
  put(job: any) {
    const { controller, done, ...data } = job;
    if (data.owner && data.documentId && !data.workspaceDocument) {
      const link = this.db
        .prepare(
          "SELECT documentId FROM ai_history_links WHERE owner=? AND sourceId=?",
        )
        .get(data.owner, data.documentId);
      if (link) {
        const newId = String(link.documentId);
        const rebind = (xml: string) => {
          const m = documentModel(xml);
          const root = m.entries.get("0");
          const meta = JSON.parse(root.getAttribute("dw_meta"));
          meta.documentId = newId;
          root.setAttribute("dw_meta", JSON.stringify(meta));
          return m.serialize();
        };
        if (data.baseXml) data.baseXml = rebind(data.baseXml);
        if (data.result?.candidateXml && data.baseXml)
          data.result = compareDocuments(
            data.baseXml,
            rebind(data.result.candidateXml),
          );
        data.documentId = newId;
        data.workspaceDocument = true;
      }
    }
    if (!data.owner || !data.documentId || data.kind !== "generate") return;
    const old = this.db
      .prepare("SELECT payload FROM ai_history WHERE id=?")
      .get(data.id);
    const previous = old ? JSON.parse(String(old.payload)) : {};
    const payload = JSON.stringify({
      ...data,
      name: data.name ?? previous.name ?? "",
      disposition: data.disposition ?? previous.disposition ?? "pending",
    });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT OR REPLACE INTO ai_history VALUES (?,?,?,?,?,?,?)")
        .run(
          data.id,
          data.owner,
          data.documentId,
          data.createdAt,
          data.status,
          Buffer.byteLength(payload),
          payload,
        );
      this.clean(data.owner);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  linkDocument(owner: string, sourceId: string, documentId: string) {
    if (sourceId === documentId) return;
    // A saved/shared document can never be reclassified as a temporary graph to bypass revoked access.
    this.db
      .prepare("INSERT OR IGNORE INTO ai_history_links VALUES (?,?,?)")
      .run(owner, sourceId, documentId);
    const records = this.db
      .prepare("SELECT payload FROM ai_history WHERE owner=? AND documentId=?")
      .all(owner, sourceId);
    for (const row of records) {
      const job = JSON.parse(String(row.payload));
      if (!job.workspaceDocument) this.put(job);
    }
  }
  accessInfo(id: string) {
    return this.db
      .prepare(
        "SELECT owner,documentId,json_extract(payload,'$.workspaceDocument') AS workspaceDocument FROM ai_history WHERE id=?",
      )
      .get(id);
  }
  requiresDocumentAccess(owner: string, documentId: string) {
    return !!this.db
      .prepare(
        "SELECT 1 FROM ai_history WHERE owner=? AND documentId=? AND json_extract(payload,'$.workspaceDocument')=1 LIMIT 1",
      )
      .get(owner, documentId);
  }
  get(id: string, owner?: string) {
    const row = this.db
      .prepare("SELECT owner,payload FROM ai_history WHERE id=?")
      .get(id);
    if (!row || (owner !== undefined && row.owner !== owner))
      throw Error("历史记录不存在或不属于当前访问者");
    return JSON.parse(String(row.payload));
  }
  list(owner: string, documentId: string, page = 1) {
    this.clean(owner);
    if (!Number.isInteger(page) || page < 1 || page > 100000)
      throw Error("页码无效");
    const rows = this.db
      .prepare(
        "SELECT payload FROM ai_history WHERE owner=? AND documentId=? ORDER BY createdAt DESC,id DESC LIMIT 20 OFFSET ?",
      )
      .all(owner, documentId, (page - 1) * 20);
    return {
      items: rows.map((r) => {
        const { baseXml, result, owner, ...rest } = JSON.parse(
          String(r.payload),
        );
        return { ...rest, hasCandidate: !!result };
      }),
      total: Number(
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM ai_history WHERE owner=? AND documentId=?",
          )
          .get(owner, documentId)!.n,
      ),
      page,
    };
  }
  update(id: string, owner: string, input: any) {
    const j = this.get(id, owner);
    if (
      input.name !== undefined &&
      (typeof input.name !== "string" || input.name.length > 100)
    )
      throw Error("方案名称不能超过 100 字");
    if (
      input.disposition !== undefined &&
      !["pending", "applied", "partial", "discarded"].includes(
        input.disposition,
      )
    )
      throw Error("候选状态无效");
    this.put({
      ...j,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.disposition !== undefined
        ? { disposition: input.disposition }
        : {}),
    });
    return this.get(id, owner);
  }
  remove(id: string, owner: string) {
    const j = this.get(id, owner);
    if (["queued", "running", "validating"].includes(j.status))
      throw Error("请先取消正在执行的任务");
    this.db
      .prepare("DELETE FROM ai_history WHERE id=? AND owner=?")
      .run(id, owner);
  }
  settings(owner: string, days?: number) {
    if (days !== undefined) {
      if (![7, 30, 90].includes(days))
        throw Error("保留期限仅支持 7、30、90 天");
      this.db
        .prepare("INSERT OR REPLACE INTO ai_history_preferences VALUES (?,?)")
        .run(owner, days);
    }
    this.clean(owner);
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM ai_history WHERE owner=?",
      )
      .get(owner);
    return {
      days: this.days(owner),
      count: Number(row?.count || 0),
      bytes: Number(row?.bytes || 0),
      limits: this.limits,
    };
  }
  close() {
    this.db.close();
  }
}
