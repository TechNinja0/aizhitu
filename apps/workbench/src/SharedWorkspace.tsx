import { collaborationPresentation } from "./collaboration-policy";
import { useCollaboration } from "./Collaboration";
import { startNewDocument } from "./NewDocument";
import {
  AccountEntry,
  AccountSettings,
  AdminUsers,
  clearSession,
  signOut,
} from "./AccountViews";
import React, { useEffect, useRef, useState } from "react";
import type { Bridge } from "./bridge";
import "./shared.css";
import { TemplatePicker } from "./TemplatePicker";
import { resolveTemplateXml } from "./template-library";

import { copyText } from "./uuid";
export type Actor = {
  id: string;
  name: string;
  admin: boolean;
  login?: string | null;
  needsSetup?: boolean;
};
export const workspaceContext: {
  token: string;
  shareOrigin?: string;
  actor?: Actor;
  documentId?: string;
  collaborationToken?: string;
} = { token: "" };
export const documentId = () =>
  location.pathname.match(/^\/documents\/([\w-]+)$/)?.[1];
export function workspaceHeaders() {
  return {
    Authorization: `Bearer ${workspaceContext.token}`,
    ...(documentId() || workspaceContext.documentId
      ? { "X-Document-Id": documentId() || workspaceContext.documentId! }
      : {}),
    ...(workspaceContext.collaborationToken
      ? { "X-Collaboration-Token": workspaceContext.collaborationToken }
      : {}),
  };
}
export async function workspaceApi(
  path: string,
  body?: unknown,
  method?: string,
) {
  const r = await fetch("/api/" + path, {
    method: method || (body ? "POST" : "GET"),
    signal: AbortSignal.timeout(15000),
    headers: { ...workspaceHeaders(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok)
    throw Object.assign(Error(result.error || "操作失败"), {
      status: r.status,
    });
  return result;
}
export function SharedRoot({
  children,
  boot,
}: {
  children: React.ReactNode;
  boot: { token: string; shared?: boolean; publicOrigin?: string };
}) {
  const [actor, setActor] = useState<Actor>(),
    [loading, setLoading] = useState(true),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [connectionError, setConnectionError] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    workspaceContext.shareOrigin = boot.publicOrigin || location.origin;
    workspaceContext.token = boot.shared
      ? boot.token ||
        sessionStorage.getItem("zhitu-session") ||
        localStorage.getItem("zhitu-session") ||
        ""
      : boot.token;
    if (!boot.shared) {
      setLoading(false);
      return;
    }
    void workspaceApi("session")
      .then((a) => {
        workspaceContext.actor = a;
        setActor(a);
      })
      .catch((e) => {
        if (e.status === 401) {
          clearSession();
        } else {
          setConnectionError(true);
          setError(e.message || "工作区暂时无法连接");
        }
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!boot.shared || !actor || actor.admin) return;
    let stopped = false;
    const timer = setInterval(async () => {
      const token = workspaceContext.token;
      try {
        const next = await workspaceApi("session");
        if (!stopped && token === workspaceContext.token) {
          workspaceContext.actor = next;
          setActor(next);
        }
      } catch (e) {
        if (
          !stopped &&
          token === workspaceContext.token &&
          (e as any).status === 401
        ) {
          clearSession();
          setActor(undefined);
        }
      }
    }, 10000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [boot.shared, actor?.id, actor?.admin]);
  if (!boot.shared) return <>{children}</>;
  if (loading) return <div className="shared-empty">正在连接共享工作区…</div>;
  if (connectionError)
    return (
      <main className="shared-login">
        <section>
          <h1>暂时无法连接工作区</h1>
          <p role="alert">{error}</p>
          <p>浏览器中的身份已保留，连接恢复后可继续使用。</p>
          <button onClick={() => location.reload()}>重新连接</button>
        </section>
      </main>
    );
  if (!actor || (!actor.admin && actor.needsSetup))
    return (
      <AccountEntry
        actor={actor}
        onSuccess={(a) => {
          workspaceContext.actor = a;
          setActor(a);
        }}
      />
    );
  if (location.pathname === "/admin/users")
    return actor.admin ? (
      <AdminUsers />
    ) : (
      <main className="shared-empty">
        <h1>仅本机管理员可管理用户</h1>
        <a href="/">返回文件库</a>
      </main>
    );
  if (location.pathname === "/account")
    return actor.admin ? (
      <main className="shared-empty">
        <a href="/admin/users">进入用户管理</a>
      </main>
    ) : (
      <AccountSettings actor={actor} />
    );
  if (location.pathname === "/")
    return <Library actor={actor} onActor={setActor} />;
  return <>{children}</>;
}
function Library({
  actor,
  onActor,
}: {
  actor: Actor;
  onActor: (actor: Actor) => void;
}) {
  const [templateOpen, setTemplateOpen] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareId, setShareId] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const shareTrigger = useRef<HTMLButtonElement>(null);
  const copyShare = async (link: string) => {
    setCopying(true);
    setShareMessage("正在复制链接…");
    try {
      await copyText(link);
      setShareMessage("链接已复制，可以发送给同事");
    } catch {
      setShareMessage("自动复制未成功，请选中下方链接手动复制");
    } finally {
      setCopying(false);
    }
  };

  const [docs, setDocs] = useState<any[]>([]),
    [view, setView] = useState<"shared" | "trash">("shared"),
    [mine, setMine] = useState(false),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(() => {
      try {
        const saved = Number(localStorage.getItem("zhitu-library-page-size"));
        return [10, 20, 50, 100].includes(saved) ? saved : 10;
      } catch {
        return 10;
      }
    }),
    [total, setTotal] = useState(0),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<
      Record<string, { id: string; revision: number; name: string }>
    >({});
  const trash = view === "trash";
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageNumbers = [
    ...new Set([
      1,
      ...Array.from({ length: 5 }, (_, i) => page + i - 2),
      pages,
    ]),
  ]
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b);
  const table = useRef<HTMLDivElement>(null);
  const endpoint = `documents?view=${view}&deleted=${trash ? 1 : 0}&mine=${mine ? 1 : 0}&page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(search)}`;
  const latestEndpoint = useRef(endpoint);
  latestEndpoint.current = endpoint;
  const requestSequence = useRef(0);
  const pendingRequests = useRef(0);
  const reload = async () => {
    const sequence = ++requestSequence.current;
    pendingRequests.current++;
    try {
      const result = await workspaceApi(endpoint);
      if (
        sequence !== requestSequence.current ||
        latestEndpoint.current !== endpoint
      )
        return;
      setDocs(result.items);
      setTotal(result.total);
      setPage(result.page);
      setLoadError("");
    } catch (e) {
      if (
        sequence === requestSequence.current &&
        latestEndpoint.current === endpoint
      )
        setLoadError((e as Error).message);
    } finally {
      pendingRequests.current--;
      if (
        sequence === requestSequence.current &&
        latestEndpoint.current === endpoint
      )
        setLoading(false);
    }
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setLoading(true);
    setDocs([]);
    setSelected({});
    setError("");
    if (table.current) table.current.scrollTop = 0;
    void reload();
    const timer = setInterval(() => {
      if (!pendingRequests.current) void reload();
    }, 3000);
    return () => {
      requestSequence.current++;
      clearInterval(timer);
    };
  }, [endpoint]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const manageable = (d: any) => actor.admin || actor.id === d.owner;
  const visible = docs;
  const selectable = visible
    .filter((d) => manageable(d) && !d.lock && !d.collaborators?.length)
    .slice(0, 100);
  const chosen = Object.values(selected);
  const remove = (items: { id: string; revision: number; name: string }[]) =>
    run(async () => {
      if (
        !items.length ||
        !confirm(
          `将以下 ${items.length} 份文件移入回收站？之后可以恢复。\n${items
            .slice(0, 5)
            .map((d) => d.name)
            .join("\n")}${items.length > 5 ? "\n…" : ""}`,
        )
      )
        return;
      await workspaceApi("documents/batch-trash", { items });
      setSelected({});
      await reload();
    });
  return (
    <main className="shared-library">
      <header>
        <a className="shared-brand" href="/">
          图 <strong>AI智图</strong>
          <span>共享工作区</span>
        </a>
        <div>
          {actor.name} · {actor.admin ? "管理员" : "成员"}
          {actor.admin ? (
            <a href="/admin/users">用户管理</a>
          ) : (
            <>
              <a href="/account">账号设置</a>
              <button disabled={busy} onClick={() => void run(signOut)}>
                退出登录
              </button>
            </>
          )}
          {actor.id !== "local-admin" && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const nextName = prompt("修改姓名", actor.name);
                  if (nextName === null) return;
                  const next = await workspaceApi(
                    "session",
                    { name: nextName },
                    "PATCH",
                  );
                  workspaceContext.actor = next;
                  onActor(next);
                })
              }
            >
              修改姓名
            </button>
          )}
        </div>
      </header>
      <h1 className="shared-library-title">文件库</h1>
      {templateOpen && (
        <TemplatePicker
          onClose={() => setTemplateOpen(false)}
          onCreate={async (template, title) => {
            startNewDocument(title, await resolveTemplateXml(template, title));
          }}
        />
      )}
      <section className="shared-files">
        <div className="shared-files-toolbar">
          <div className="shared-library-filters">
            {(
              [
                ["shared", "全部文件"],
                ["trash", "回收站"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                disabled={busy}
                className={view === key ? "active" : ""}
                onClick={() => {
                  setView(key);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
            <label className="shared-mine">
              <input
                type="checkbox"
                checked={mine}
                disabled={busy}
                onChange={(e) => {
                  setMine(e.target.checked);
                  setPage(1);
                }}
              />
              我拥有的
            </label>
            <input
              aria-label="搜索图稿"
              placeholder="搜索图稿名称"
              maxLength={120}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected({});
              }}
            />
          </div>
          <div className="shared-file-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => setTemplateOpen(true)}
            >
              新建图稿
            </button>
            <label className="shared-import">
              导入图稿
              <input
                aria-label="导入图稿"
                type="file"
                accept=".drawio,.xml"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f)
                    void run(async () => {
                      if (f.size > 20 * 1024 * 1024)
                        throw Error("文件超过 20 MiB");
                      const d = await workspaceApi("documents", {
                        name: f.name,
                        xml: await f.text(),
                      });
                      location.assign("/documents/" + d.id);
                    });
                }}
              />
            </label>
            <a href="/local">本地临时画布</a>
          </div>
        </div>
        <div className="shared-batch">
          <span>
            {loading
              ? "正在加载…"
              : `共 ${total} 份${search ? "（搜索结果）" : ""}`}
          </span>
          {!trash && (
            <>
              <span>已选 {chosen.length} 份</span>
              <button
                disabled={busy || !chosen.length}
                onClick={() => void remove(chosen)}
              >
                批量移入回收站
              </button>
              <small>仅选择本页文件；正在编辑的文件不可操作</small>
            </>
          )}
        </div>
        {(error || loadError) && <p role="alert">{error || loadError}</p>}
        <div
          className="shared-table"
          ref={table}
          role="region"
          aria-label="文件列表"
          tabIndex={0}
        >
          <div className="shared-row shared-table-head">
            <span>
              {!trash && (
                <input
                  type="checkbox"
                  aria-label="全选可管理文件"
                  title="全选本页可管理文件"
                  disabled={busy || !selectable.length}
                  checked={
                    !!selectable.length &&
                    selectable.every((d) => !!selected[d.id])
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? Object.fromEntries(
                            selectable.map((d) => [
                              d.id,
                              { id: d.id, revision: d.revision, name: d.name },
                            ]),
                          )
                        : {},
                    )
                  }
                />
              )}
            </span>
            <span>图稿名称</span>
            <span>创建人</span>
            <span>最后保存人 / 时间</span>
            <span>编辑状态</span>
            <span>操作</span>
          </div>
          {visible.map((d) => (
            <div className="shared-row" key={d.id}>
              <span>
                {!trash && (
                  <input
                    type="checkbox"
                    aria-label={`选择 ${d.name}`}
                    disabled={
                      busy ||
                      !manageable(d) ||
                      !!d.lock ||
                      !!d.collaborators?.length ||
                      (!selected[d.id] && chosen.length >= 100)
                    }
                    checked={!!selected[d.id]}
                    onChange={(e) =>
                      setSelected((old) => {
                        const next = { ...old };
                        if (e.target.checked)
                          next[d.id] = {
                            id: d.id,
                            revision: d.revision,
                            name: d.name,
                          };
                        else delete next[d.id];
                        return next;
                      })
                    }
                  />
                )}
              </span>
              <div>
                <a href={trash ? undefined : "/documents/" + d.id}>{d.name}</a>
                <small>
                  版本 {d.revision} ·{" "}
                  {d.visibility === "everyone"
                    ? "所有成员可见"
                    : d.visibility === "selected"
                      ? "指定成员可见"
                      : "仅自己可见"}
                </small>
              </div>
              <span>{d.createdBy || "历史创建者"}</span>
              <div>
                {d.updatedBy}
                <small>{new Date(d.updatedAt).toLocaleString()}</small>
              </div>
              <span>
                {trash
                  ? "已删除"
                  : d.lock
                    ? `${d.lock.name} 正在编辑`
                    : d.collaborators?.length
                      ? `${d.collaborators.length} 个页面协同编辑`
                      : d.canEdit
                        ? "可编辑"
                        : "仅查看"}
              </span>
              <div className="shared-row-actions">
                {trash ? (
                  <button
                    disabled={busy || !manageable(d)}
                    onClick={() =>
                      void run(async () => {
                        await workspaceApi(`documents/${d.id}/untrash`, {
                          revision: d.revision,
                        });
                        await reload();
                      })
                    }
                  >
                    恢复文件
                  </button>
                ) : (
                  <>
                    {
                      <button
                        className="shared-action-icon"
                        aria-label="分享图稿"
                        title="分享图稿"
                        disabled={busy}
                        onClick={(e) => {
                          shareTrigger.current = e.currentTarget;
                          const link =
                            (workspaceContext.shareOrigin || location.origin) +
                            "/documents/" +
                            d.id;
                          setShareLink(link);
                          setShareId(d.id);
                          setShareMessage("");
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <circle cx="18" cy="5" r="3" />
                          <circle cx="6" cy="12" r="3" />
                          <circle cx="18" cy="19" r="3" />
                          <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
                        </svg>
                      </button>
                    }
                    {manageable(d) && (
                      <button
                        className="shared-action-icon shared-action-delete"
                        aria-label="移入回收站"
                        title={
                          d.lock || d.collaborators?.length
                            ? "正在编辑，请先返回文件库"
                            : "移入回收站"
                        }
                        disabled={busy || !!d.lock || !!d.collaborators?.length}
                        onClick={() =>
                          void remove([
                            { id: d.id, revision: d.revision, name: d.name },
                          ])
                        }
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          {!loading && !visible.length && (
            <div className="shared-empty">
              {query
                ? "没有匹配的图稿，请调整搜索条件。"
                : trash
                  ? "回收站为空"
                  : "还没有可访问的图稿，新建并修改后会自动保存，也可请创建者分享给你。"}
            </div>
          )}
        </div>
        <nav className="shared-pagination" aria-label="文件分页">
          <span>
            {total
              ? `第 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} 条，共 ${total} 条`
              : "共 0 条"}
          </span>
          <div className="shared-page-buttons">
            <button
              aria-label="上一页"
              disabled={busy || loading || page <= 1}
              onClick={() => setPage(page - 1)}
            >
              ‹
            </button>
            {pageNumbers.map((n, i) => (
              <React.Fragment key={n}>
                {i > 0 && n - pageNumbers[i - 1] > 1 && (
                  <span className="shared-page-gap">…</span>
                )}
                <button
                  aria-label={`第 ${n} 页`}
                  aria-current={page === n ? "page" : undefined}
                  disabled={busy || loading}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              </React.Fragment>
            ))}
            <button
              aria-label="下一页"
              disabled={busy || loading || page >= pages}
              onClick={() => setPage(page + 1)}
            >
              ›
            </button>
          </div>
          <select
            aria-label="每页显示数量"
            value={pageSize}
            disabled={busy}
            onChange={(e) => {
              const size = Number(e.target.value);
              setPageSize(size);
              setPage(1);
              try {
                localStorage.setItem("zhitu-library-page-size", String(size));
              } catch {}
            }}
          >
            {[10, 20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size} 条/页
              </option>
            ))}
          </select>
        </nav>
      </section>
      {shareLink && (
        <ShareDialog
          id={shareId}
          link={shareLink}
          message={shareMessage}
          copying={copying}
          trigger={shareTrigger}
          onCopy={() => void copyShare(shareLink)}
          onClose={() => setShareLink("")}
        />
      )}
      <footer>
        已保存文件保存在运行服务的电脑上 · 每份图稿保留最近 50 个服务器版本 ·
        回收站中的文件可恢复
      </footer>
    </main>
  );
}

export type Options = {
  bridge: Bridge;
  ready: boolean;
  state: React.RefObject<any>;
  savedRevision: React.RefObject<number>;
  load: (xml: string, name: string) => Promise<void>;
  applySnapshot: (snapshot: any) => void;
  setStatus: (status: string) => void;
  setDirty: (v: boolean) => void;
  setName: (v: string) => void;
  onError: (e: unknown) => void;
};
function ShareDialog({
  id,
  link,
  message,
  copying,
  trigger,
  onCopy,
  onClose,
  onSaved,
}: {
  id: string;
  link: string;
  message: string;
  copying: boolean;
  trigger: React.RefObject<HTMLButtonElement | null>;
  onCopy: () => void;
  onClose: () => void;
  onSaved?: (settings: any) => void;
}) {
  const [settings, setSettings] = useState<any>();
  const [members, setMembers] = useState<Actor[]>([]);
  const [visibility, setVisibility] = useState("private");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [role, setRole] = useState("view");
  const [recipientRoles, setRecipientRoles] = useState<Record<string, string>>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const dirty =
    settings &&
    (visibility !== settings.visibility ||
      (visibility === "everyone" && role !== settings.role) ||
      (visibility === "selected" &&
        recipients.some(
          (id) =>
            (recipientRoles[id] || "view") !== settings.recipientRoles[id],
        )) ||
      JSON.stringify([...recipients].sort()) !==
        JSON.stringify([...settings.recipients].sort()));
  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const result = await workspaceApi(`documents/${id}/sharing`);
        const roster = result.canManage ? await workspaceApi("members") : [];
        if (stopped) return;
        setSettings(result);
        setVisibility(result.visibility);
        setRole(result.role);
        setRecipientRoles(result.recipientRoles);
        setRecipients(result.recipients);
        setMembers(roster);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [id]);
  const apply = async () => {
    setSaving(true);
    setError("");
    setSavedMessage("");
    try {
      const result = await workspaceApi(
        `documents/${id}/sharing`,
        {
          visibility,
          recipients: visibility === "selected" ? recipients : [],
          role,
          recipientRoles:
            visibility === "selected"
              ? Object.fromEntries(
                  recipients.map((id) => [id, recipientRoles[id] || "view"]),
                )
              : {},
          accessRevision: settings.accessRevision,
        },
        "PUT",
      );
      setSettings(result);
      setRecipients(result.recipients);
      setRecipientRoles(result.recipientRoles);
      onSaved?.(result);
      setSavedMessage(
        result.visibility === "private"
          ? "已收回分享，仅自己和本机管理员可见"
          : "分享权限已保存，可以复制链接发送给已授权成员",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    node.querySelector("input")?.focus();
    return () => {
      node.close();
      trigger.current?.focus({ preventScroll: true });
    };
  }, [trigger]);
  return (
    <dialog
      ref={dialog}
      className="modal shared-share"
      aria-label="分享图稿"
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="modal-heading">
        <h2>分享图稿</h2>
        <button onClick={onClose}>关闭</button>
      </div>
      <p>
        分享链接默认以查看方式打开；“可编辑”成员可主动切换到编辑态，“仅查看”成员不能修改。
      </p>
      {!settings && !error && <p role="status">正在加载分享权限…</p>}
      {error && <p role="alert">{error}</p>}
      {settings?.canManage ? (
        <>
          <fieldset className="shared-sharing-scope" disabled={saving}>
            <legend>谁可以访问</legend>
            {[
              ["private", "仅自己"],
              ["selected", "指定成员"],
              ["everyone", "所有成员"],
            ].map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="share-scope"
                  value={value}
                  checked={visibility === value}
                  onChange={() => {
                    setVisibility(value);
                    setSavedMessage("");
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
          {visibility === "everyone" && (
            <fieldset disabled={saving} className="shared-sharing-scope">
              <legend>成员权限</legend>
              {[
                ["view", "仅查看"],
                ["edit", "可编辑"],
              ].map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="share-role"
                    value={value}
                    checked={role === value}
                    onChange={() => {
                      setRole(value);
                      setSavedMessage("");
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          {visibility === "selected" && (
            <fieldset className="shared-sharing-members" disabled={saving}>
              <legend>选择成员</legend>
              <p>
                让对方先注册或登录工作区，再从这里选择。按账号授权，同名成员请核对登录名；同一账号换浏览器后权限不变。
              </p>
              {members
                .filter((m) => m.id !== settings.owner)
                .map((m) => (
                  <div key={m.id} className="shared-member-permission">
                    <label>
                      <input
                        type="checkbox"
                        checked={recipients.includes(m.id)}
                        onChange={(e) => {
                          setRecipients((prev) =>
                            e.target.checked
                              ? [...prev, m.id]
                              : prev.filter((v) => v !== m.id),
                          );
                          setSavedMessage("");
                        }}
                      />{" "}
                      <span>
                        {m.name}{" "}
                        <small>
                          {m.login ? `登录名 ${m.login} · ` : "待补设账号 · "}
                          身份 {m.id}
                        </small>
                      </span>
                    </label>
                    <select
                      aria-label={`成员权限：${m.login || m.id}`}
                      disabled={!recipients.includes(m.id)}
                      value={recipientRoles[m.id] || "view"}
                      onChange={(e) => {
                        setRecipientRoles((old) => ({
                          ...old,
                          [m.id]: e.target.value,
                        }));
                        setSavedMessage("");
                      }}
                    >
                      <option value="view">仅查看</option>
                      <option value="edit">可编辑</option>
                    </select>
                  </div>
                ))}
              {recipients
                .filter((r) => !members.some((m) => m.id === r))
                .map((r) => (
                  <label key={r}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        setRecipients((prev) => prev.filter((v) => v !== r))
                      }
                    />
                    已停用或删除的成员 <small>{r}</small>
                  </label>
                ))}
              {!members.some((m) => m.id !== settings.owner) && (
                <p>暂无其他成员。</p>
              )}
            </fieldset>
          )}
          <p className="shared-share-note">
            本机管理员始终保留管理权限。复制链接不会自动开放访问。
          </p>
          <button
            className="primary"
            disabled={
              !dirty ||
              saving ||
              (visibility === "selected" && !recipients.length)
            }
            onClick={() => void apply()}
          >
            {saving ? "正在保存权限…" : "保存分享权限"}
          </button>
          {dirty && <p role="status">权限尚未保存，保存后才会生效。</p>}
        </>
      ) : (
        settings && (
          <p>你已获授权访问；只有文件所有者或本机管理员可以调整分享范围。</p>
        )
      )}
      {savedMessage && <p role="status">{savedMessage}</p>}
      <p role="status">{message}</p>
      <label>
        图稿链接
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => {
            const input = e.currentTarget;
            requestAnimationFrame(() => input.select());
          }}
        />
      </label>
      <div className="modal-actions">
        <button
          className="primary"
          disabled={copying || !settings || saving || !!dirty}
          onClick={onCopy}
        >
          {copying ? "正在复制…" : "复制链接"}
        </button>
      </div>
    </dialog>
  );
}
export function useSharedDocument(options: Options) {
  const id = documentId();
  const collaboration = useCollaboration(id, options);
  const doc = collaboration.document;
  const [versions, setVersions] = useState<any[] | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const shareButton = useRef<HTMLButtonElement>(null);
  const shareLink =
    (workspaceContext.shareOrigin || location.origin) + location.pathname;
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (e) {
      options.onError(e);
    }
  };
  const copyShareLink = async () => {
    setCopying(true);
    try {
      await copyText(shareLink);
      setShareMessage("链接已复制，可以发送给同事");
    } catch {
      setShareMessage("自动复制未成功，请选中下方链接手动复制");
    } finally {
      setCopying(false);
    }
  };
  const canManage =
    workspaceContext.actor?.admin || workspaceContext.actor?.id === doc?.owner;
  const presentation = doc
    ? collaborationPresentation(
        doc,
        collaboration.members,
        workspaceContext.actor?.id,
        collaboration.viewing,
      )
    : null;
  const panel = id ? (
    <>
      <div className="shared-document-bar">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            void collaboration.back();
          }}
        >
          ← 文件库
        </a>
        {presentation && (
          <span aria-label="图稿分享范围" title={presentation.scopeTitle}>
            {presentation.scope}
          </span>
        )}
        {(collaboration.paused ||
          !collaboration.active ||
          collaboration.viewing ||
          presentation?.mode) && (
          <span
            aria-label="当前编辑状态"
            title={`当前账号：${workspaceContext.actor?.name || ""}`}
            className={
              collaboration.editable ? "shared-editing" : "shared-readonly"
            }
          >
            {collaboration.paused
              ? "同步已暂停"
              : collaboration.active
                ? presentation?.mode
                : "正在连接文档"}
          </span>
        )}
        {collaboration.active &&
          !collaboration.paused &&
          presentation?.membersText && (
            <span
              className="collaboration-members"
              aria-label="在线协同成员"
              title={presentation.membersTitle}
            >
              {presentation.membersText}
            </span>
          )}
        <span
          className="shared-notice"
          role="status"
          title={collaboration.noticeTitle}
        >
          {collaboration.notice}
        </span>
        {doc?.canEdit && (
          <button
            aria-label="编辑"
            aria-pressed={
              collaboration.active &&
              !collaboration.viewing &&
              !collaboration.paused
            }
            className="editing-toggle"
            disabled={
              !collaboration.active ||
              collaboration.paused ||
              collaboration.busy
            }
            title={
              collaboration.viewing ? "开始编辑" : "保存修改并切换为仅查看"
            }
            onClick={() => void collaboration.toggleEditing()}
          >
            编辑
          </button>
        )}
        <button
          ref={shareButton}
          disabled={!doc || collaboration.busy}
          onClick={() => {
            setSharing(true);
            setShareMessage("");
          }}
        >
          分享链接
        </button>
        {(!collaboration.active || collaboration.paused) && (
          <button
            disabled={collaboration.busy}
            onClick={() => void collaboration.reconnect()}
          >
            重新连接
          </button>
        )}
        <button
          disabled={!doc || collaboration.busy}
          onClick={() =>
            void run(async () =>
              setVersions(await workspaceApi(`documents/${id}/versions`)),
            )
          }
        >
          服务器版本
        </button>
        <button
          disabled={!collaboration.editable || !canManage}
          onClick={() => {
            if (
              !confirm(
                "将这份图稿移入回收站？之后可在文件库恢复。其他页面仍在编辑时无法删除。",
              )
            )
              return;
            void collaboration.perform(async (current, token) => {
              await workspaceApi(`documents/${id}/trash`, {
                revision: current.revision,
                collaborationToken: token,
              });
              location.assign("/");
            });
          }}
        >
          移入回收站
        </button>
      </div>
      {sharing && (
        <ShareDialog
          id={id}
          onSaved={collaboration.refreshSharing}
          link={shareLink}
          message={shareMessage}
          copying={copying}
          trigger={shareButton}
          onCopy={() => void copyShareLink()}
          onClose={() => setSharing(false)}
        />
      )}
      {versions && (
        <div className="scrim">
          <div
            className="modal shared-versions"
            role="dialog"
            aria-label="服务器版本"
          >
            <div className="modal-heading">
              <h2>服务器版本</h2>
              <button
                disabled={collaboration.busy}
                onClick={() => setVersions(null)}
              >
                关闭
              </button>
            </div>
            <p>
              仅在内容变化时保存版本，最多保留 50
              个。恢复会生成新版本；请让其他编辑页面切换为仅查看或返回文件库后再恢复。
            </p>
            {versions.map((v) => (
              <div className="shared-version" key={v.revision}>
                <span>
                  <strong>
                    版本 {v.revision} · {v.name}
                  </strong>
                  <small>
                    {v.author} · {new Date(v.time).toLocaleString()} · {v.label}
                  </small>
                </span>
                <button
                  disabled={!collaboration.editable}
                  onClick={() =>
                    void collaboration.perform(async (current, token) => {
                      const restored = await workspaceApi(
                        `documents/${id}/versions/${v.revision}/restore`,
                        {
                          revision: current.revision,
                          collaborationToken: token,
                        },
                      );
                      await collaboration.resetBase(restored);
                      setVersions(
                        await workspaceApi(`documents/${id}/versions`),
                      );
                    })
                  }
                >
                  恢复此版本
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  ) : null;
  return {
    id,
    denied: collaboration.denied,
    editing: collaboration.editable,
    ensureEditable: collaboration.ensureEditable,
    beforeNavigate: collaboration.beforeNavigate,
    panel,
    save: collaboration.save,
    doc,
    isDirty: collaboration.isDirty,
  };
}
