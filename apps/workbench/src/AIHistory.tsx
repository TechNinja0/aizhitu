import React, { useEffect, useRef, useState } from "react";
export function AIHistoryPanel({
  api,
  documentId,
  onRecover,
  onRestore,
  onError,
  running,
}: {
  api: (path: string, body?: unknown, method?: string) => Promise<Response>;
  documentId?: string;
  onRecover: (id: string) => Promise<void>;
  onRestore: (items: any[]) => void;
  onError: (e: any) => void;
  running: boolean;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(1),
    [data, setData] = useState<any>({ items: [], total: 0 }),
    [settings, setSettings] = useState<any>(),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState<string>();
  const doc = useRef(documentId);
  doc.current = documentId;
  const refresh = async (p = page) => {
    if (!documentId) return;
    const id = documentId;
    const d = await (
      await api(`ai/history?documentId=${encodeURIComponent(id)}&page=${p}`)
    ).json();
    if (doc.current === id) setData(d);
  };
  useEffect(() => {
    setPage(1);
    setData({ items: [], total: 0 });
    const id = documentId;
    let stopped = false;
    if (id)
      void api(`ai/history?documentId=${encodeURIComponent(id)}&page=1`)
        .then((r) => r.json())
        .then((d) => {
          if (stopped || doc.current !== id) return;
          setData(d);
          onRestore(
            d.items
              .filter((j: any) => j.kind === "generate")
              .slice(0, 12)
              .reverse(),
          );
        })
        .catch(onError);
    return () => {
      stopped = true;
    };
  }, [documentId]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      setSettings(await (await api("ai/history/settings")).json());
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        disabled={!documentId || busy}
        onClick={() => {
          setOpen(!open);
          void action(() => refresh());
        }}
      >
        历史与候选
      </button>
      {open && (
        <section className="p0-history" aria-label="图稿会话历史">
          <p className="p0-hint">
            按账号保存到服务器，重启可继续。截图需重新上传；命名候选也受保留期限与容量限制。
          </p>
          {settings && (
            <label>
              保留期限{" "}
              <select
                aria-label="历史保留期限"
                value={settings.days}
                disabled={busy}
                onChange={(e) =>
                  void action(() =>
                    api("ai/history/settings", {
                      days: Number(e.target.value),
                    }),
                  )
                }
              >
                {[7, 30, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} 天
                  </option>
                ))}
              </select>
              <small>
                {" "}
                {settings.count} 条 ·{" "}
                {(settings.bytes / 1024 / 1024).toFixed(1)} MiB / 128 MiB
              </small>
            </label>
          )}
          {data.items.map((j: any) => (
            <article key={j.id}>
              <strong>{j.name || "未命名方案"}</strong>
              <small>
                {new Date(j.createdAt).toLocaleString()} ·{" "}
                {
                  (
                    {
                      succeeded: "已完成",
                      failed: "失败/中断",
                      cancelled: "已取消",
                      queued: "排队中",
                      running: "执行中",
                      validating: "校验中",
                    } as any
                  )[j.status]
                }{" "}
                ·{" "}
                {
                  (
                    {
                      pending: "未应用",
                      applied: "已应用",
                      partial: "部分已应用",
                      discarded: "已丢弃",
                    } as any
                  )[j.disposition]
                }
              </small>
              <p>{j.requestPrompt}</p>
              {j.error && <p>{j.error}</p>}
              {j.hasImage && (
                <small>此请求包含截图，再次生成需重新上传。</small>
              )}
              <input
                aria-label="候选方案名称"
                defaultValue={j.name}
                placeholder="例如：方案 B"
                maxLength={100}
                onBlur={(e) => {
                  if (e.target.value !== (j.name || ""))
                    void action(() =>
                      api(
                        "ai/history/" + j.id,
                        { name: e.target.value },
                        "PATCH",
                      ),
                    );
                }}
              />
              <div>
                <button
                  disabled={busy || running}
                  onClick={() => void onRecover(j.id)}
                >
                  {j.hasCandidate ? "接回候选 / 继续修改" : "取回要求"}
                </button>
                <button
                  disabled={
                    busy ||
                    ["queued", "running", "validating"].includes(j.status)
                  }
                  onClick={() => setDeleting(j.id)}
                >
                  删除历史记录
                </button>
                {deleting === j.id && (
                  <>
                    <span>删除后无法接回此记录。</span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await api("ai/history/" + j.id, undefined, "DELETE");
                          setDeleting(undefined);
                        })
                      }
                    >
                      确认删除记录
                    </button>
                    <button onClick={() => setDeleting(undefined)}>
                      保留记录
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
          {!data.items.length && <p>此图稿暂无历史。</p>}
          <div>
            <button
              disabled={page <= 1 || busy}
              onClick={() => {
                setPage(page - 1);
                void action(() => refresh(page - 1));
              }}
            >
              历史上一页
            </button>
            <span>
              {page} / {Math.max(1, Math.ceil(data.total / 20))}
            </span>
            <button
              disabled={page * 20 >= data.total || busy}
              onClick={() => {
                setPage(page + 1);
                void action(() => refresh(page + 1));
              }}
            >
              历史下一页
            </button>
            <button
              disabled={busy}
              onClick={() => void action(() => refresh())}
            >
              刷新与清理过期记录
            </button>
          </div>
        </section>
      )}
    </>
  );
}
