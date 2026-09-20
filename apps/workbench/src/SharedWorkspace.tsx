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

import { uuid, copyText } from "./uuid";
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
  lockToken?: string;
} = { token: "" };
export const documentId = () =>
  location.pathname.match(/^\/documents\/([\w-]+)$/)?.[1];
export function workspaceHeaders() {
  return {
    Authorization: `Bearer ${workspaceContext.token}`,
    ...(workspaceContext.documentId
      ? { "X-Document-Id": workspaceContext.documentId }
      : {}),
    ...(workspaceContext.lockToken
      ? { "X-Lock-Token": workspaceContext.lockToken }
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
    [name, setName] = useState("未命名图稿"),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<
      Record<string, { id: string; revision: number; name: string }>
    >({});
  const trash = view === "trash";
  const endpoint = `documents?view=${view}&deleted=${trash ? 1 : 0}&mine=${mine ? 1 : 0}`;
  const reload = async () => setDocs(await workspaceApi(endpoint));
  useEffect(() => {
    let active = true;
    setLoading(true);
    setDocs([]);
    setSelected({});
    setError("");
    const update = async () => {
      try {
        const result = await workspaceApi(endpoint);
        if (active) {
          setDocs(result);
          setLoadError("");
        }
      } catch (e) {
        if (active) setLoadError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    };
    void update();
    const timer = setInterval(update, 3000);
    return () => {
      active = false;
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
  const visible = docs.filter((d) =>
    d.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selectable = visible
    .filter((d) => manageable(d) && !d.lock)
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
      <section className="shared-hero">
        <span className="shared-kicker">团队图稿，集中保存</span>
        <h1>文件库</h1>
        {!actor.admin && (
          <small className="shared-identity">
            我的身份：{actor.name} · {actor.id}
          </small>
        )}
        <p>
          新建和保存的图稿默认仅自己可见。在分享窗口设置权限后，指定成员或所有成员才可访问。
        </p>
        <small>
          {actor.admin
            ? "当前为本机管理员，可管理所有文件。"
            : "你可以管理自己创建的文件；管理员需在服务电脑打开 " +
              location.protocol +
              "//127.0.0.1:" +
              location.port +
              "/。"}
        </small>
      </section>
      <section className="shared-create">
        <label>
          新图稿名称
          <input
            aria-label="新图稿名称"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={busy}
          onClick={() => setTemplateOpen(true)}
        >
          新建图稿
        </button>
        {templateOpen && (
          <TemplatePicker
            initialName={name === "未命名图稿" ? "" : name}
            onClose={() => setTemplateOpen(false)}
            onCreate={async (template, title) => {
              startNewDocument(
                title,
                await resolveTemplateXml(template, title),
              );
            }}
          />
        )}
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
                  if (f.size > 20 * 1024 * 1024) throw Error("文件超过 20 MiB");
                  const d = await workspaceApi("documents", {
                    name: f.name,
                    xml: await f.text(),
                  });
                  sessionStorage.setItem(`zhitu-edit:${d.id}`, "1");
                  location.assign("/documents/" + d.id);
                });
            }}
          />
        </label>
        <a href="/local">本地临时画布</a>
      </section>
      <section className="shared-files">
        <div className="shared-files-toolbar">
          <div>
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
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
            <label className="shared-mine">
              <input
                type="checkbox"
                checked={mine}
                disabled={busy}
                onChange={(e) => setMine(e.target.checked)}
              />
              我拥有的
            </label>
          </div>
          <input
            aria-label="搜索图稿"
            placeholder="搜索图稿名称"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected({});
            }}
          />
        </div>
        <div className="shared-batch">
          <span>
            {loading
              ? "正在加载…"
              : `共 ${visible.length} 份${query ? `（总计 ${docs.length} 份）` : ""}`}
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
              <small>每次最多 100 份；正在编辑的文件不可操作</small>
            </>
          )}
        </div>
        {(error || loadError) && <p role="alert">{error || loadError}</p>}
        <div className="shared-table">
          <div className="shared-row shared-table-head">
            <span>
              {!trash && (
                <input
                  type="checkbox"
                  aria-label="全选可管理文件"
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
                    : "可编辑"}
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
                        title={d.lock ? "正在编辑，请先结束编辑" : "移入回收站"}
                        disabled={busy || !!d.lock}
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

type Options = {
  bridge: Bridge;
  ready: boolean;
  state: React.RefObject<any>;
  savedRevision: React.RefObject<number>;
  load: (xml: string, name: string) => Promise<void>;
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
}: {
  id: string;
  link: string;
  message: string;
  copying: boolean;
  trigger: React.RefObject<HTMLButtonElement | null>;
  onCopy: () => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<any>();
  const [members, setMembers] = useState<Actor[]>([]);
  const [visibility, setVisibility] = useState("private");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const dirty =
    settings &&
    (visibility !== settings.visibility ||
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
          accessRevision: settings.accessRevision,
        },
        "PUT",
      );
      setSettings(result);
      setRecipients(result.recipients);
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
      <p>只有已授权成员才能通过链接访问。已授权成员可查看并申请编辑权。</p>
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
          {visibility === "selected" && (
            <fieldset className="shared-sharing-members" disabled={saving}>
              <legend>选择成员</legend>
              <p>
                让对方先注册或登录工作区，再从这里选择。按账号授权，同名成员请核对登录名；同一账号换浏览器后权限不变。
              </p>
              {members
                .filter((m) => m.id !== settings.owner)
                .map((m) => (
                  <label key={m.id}>
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
                        {m.login ? `登录名 ${m.login} · ` : "待补设账号 · "}身份{" "}
                        {m.id}
                      </small>
                    </span>
                  </label>
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
  const id = documentId(),
    opts = useRef(options);
  opts.current = options;
  const [doc, setDoc] = useState<any>(),
    [editing, setEditing] = useState(false),
    [denied, setDenied] = useState(false),
    [notice, setNotice] = useState("正在加载共享文档…"),
    [versions, setVersions] = useState<any[] | null>(null),
    [sharing, setSharing] = useState(false),
    [copying, setCopying] = useState(false),
    [shareMessage, setShareMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const shareLink =
    (workspaceContext.shareOrigin || location.origin) + location.pathname;
  const copyShareLink = async () => {
    setCopying(true);
    setShareMessage("正在复制链接…");
    try {
      await copyText(shareLink);
      setShareMessage("链接已复制，可以发送给同事");
    } catch {
      setShareMessage("自动复制未成功，请选中下方链接手动复制");
    } finally {
      setCopying(false);
    }
  };
  const pollFinished = useRef<Promise<void>>(Promise.resolve());
  const shareButton = useRef<HTMLButtonElement>(null);
  const current = useRef<any>(undefined),
    lease = useRef<any>(undefined),
    saving = useRef(false),
    initialized = useRef(false),
    client = useRef(uuid()),
    operation = useRef(false),
    mounted = useRef(true);
  const keep = (d: any) => {
    current.current = d;
    setDoc(d);
  };
  const readonly = async () => {
    lease.current = undefined;
    workspaceContext.lockToken = undefined;
    setEditing(false);
    await opts.current.bridge.invoke("setReadOnly", { value: true });
    const snapshot = await opts.current.bridge.invoke("snapshot");
    if (snapshot.revision !== opts.current.savedRevision.current) {
      opts.current.state.current.dirty = true;
      opts.current.setDirty(true);
    }
  };
  const adopt = async (d: any) => {
    await opts.current.load(d.xml, d.name);
    keep(d);
  };
  const save = async () => {
    if (!id || !lease.current || saving.current || !current.current)
      return false;
    saving.current = true;
    try {
      const snapshot = await opts.current.bridge.invoke("snapshot"),
        name = opts.current.state.current.name,
        lockToken = lease.current.token;
      const d = await workspaceApi(
        `documents/${id}`,
        {
          xml: snapshot.xml,
          name,
          revision: current.current.revision,
          lockToken,
        },
        "PUT",
      );
      keep(d);
      opts.current.savedRevision.current = snapshot.revision;
      const latest = await opts.current.bridge.invoke("snapshot");
      const clean =
        latest.revision === snapshot.revision &&
        name === opts.current.state.current.name;
      opts.current.setDirty(!clean);
      opts.current.state.current.dirty = !clean;
      setNotice(`已保存到服务器 · 版本 ${d.revision}`);
      return clean;
    } catch (e) {
      if ([403, 404].includes((e as any).status)) {
        lease.current = undefined;
        workspaceContext.lockToken = undefined;
        opts.current.state.current.dirty = false;
        opts.current.setDirty(false);
        setDenied(true);
        return false;
      }
      if (
        !(e as any).status ||
        [401, 403, 404, 409, 423].includes((e as any).status)
      )
        await readonly();
      setNotice(
        (e as Error).message + "；当前修改已保留，可下载副本或重新获取编辑权。",
      );
      return false;
    } finally {
      saving.current = false;
    }
  };
  useEffect(() => {
    if (!id || !options.ready || denied) return;
    mounted.current = true;
    workspaceContext.documentId = id;
    let stopped = false,
      polling = false;
    const poll = async () => {
      if (polling || operation.current || saving.current) return;
      polling = true;
      let complete!: () => void;
      pollFinished.current = new Promise<void>((resolve) => {
        complete = resolve;
      });
      try {
        if (lease.current) {
          const requestedAt = Date.now();
          const r = await workspaceApi(`documents/${id}/heartbeat`, {
            lockToken: lease.current.token,
          });
          if (lease.current) lease.current.expires = requestedAt + r.leaseMs;
        }
        const d = await workspaceApi(`documents/${id}/state`);
        if (stopped) return;
        if (
          !initialized.current ||
          (current.current?.revision !== d.revision &&
            !opts.current.state.current.dirty &&
            !lease.current)
        ) {
          await opts.current.bridge.invoke("setReadOnly", { value: true });
          await adopt(await workspaceApi(`documents/${id}`));
          const firstOpen = !initialized.current;
          initialized.current = true;
          setNotice(`已同步服务器版本 ${d.revision} · 只读`);
          if (
            firstOpen &&
            sessionStorage.getItem(`zhitu-edit:${id}`) === "1" &&
            d.owner === workspaceContext.actor?.id &&
            !d.lock
          ) {
            const requestedAt = Date.now();
            const l = await workspaceApi(`documents/${id}/lock`, {
              client: client.current,
            });
            lease.current = { ...l, expires: requestedAt + l.leaseMs };
            workspaceContext.lockToken = l.token;
            await opts.current.bridge.invoke("setReadOnly", { value: false });
            setEditing(true);
            sessionStorage.removeItem(`zhitu-edit:${id}`);
            setNotice("你正在编辑 · 修改每 2 秒自动保存到服务器");
          }
        } else {
          const access = {
            lock: d.lock,
            visibility: d.visibility,
            accessRevision: d.accessRevision,
          };
          current.current = { ...current.current, ...access };
          setDoc((old: any) => ({ ...old, ...access }));
        }
        if (
          lease.current &&
          opts.current.state.current.dirty &&
          !(await opts.current.bridge.invoke("editing")).editing
        )
          await save();
      } catch (e) {
        if (!stopped) {
          if ((e as any).status === 404 || (e as any).status === 403) {
            lease.current = undefined;
            workspaceContext.lockToken = undefined;
            opts.current.state.current.dirty = false;
            opts.current.setDirty(false);
            setDenied(true);
            setSharing(false);
            stopped = true;
            return;
          }
          await readonly().catch(() => {});
          setNotice((e as Error).message + "；画布已暂停编辑，本地内容保留。");
        }
      } finally {
        polling = false;
        complete();
      }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    const release = () => {
      if (lease.current)
        void fetch(`/api/documents/${id}/release`, {
          method: "POST",
          keepalive: true,
          headers: {
            ...workspaceHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ lockToken: lease.current.token }),
        }).catch(() => {});
    };
    const expiry = setInterval(() => {
      if (lease.current && Date.now() >= lease.current.expires) {
        void readonly().catch(() => {});
        setNotice("编辑锁已到期，修改保留在当前页面，请重新获取编辑权。");
      }
    }, 500);
    window.addEventListener("pagehide", release);
    return () => {
      stopped = true;
      mounted.current = false;
      clearInterval(timer);
      clearInterval(expiry);
      window.removeEventListener("pagehide", release);
      release();
      workspaceContext.documentId = undefined;
      workspaceContext.lockToken = undefined;
    };
  }, [id, options.ready, denied]);
  const run = async (fn: () => Promise<void>, propagateError = false) => {
    if (operation.current) {
      if (propagateError) throw Error("正在处理其他操作，请稍后重试");
      return;
    }
    operation.current = true;
    setBusy(true);
    try {
      await pollFinished.current;
      await fn();
    } catch (e) {
      if (propagateError) throw e;
      options.onError(e);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const acquire = (propagateError = false) =>
    run(async () => {
      const requestedAt = Date.now();
      const l = await workspaceApi(`documents/${id}/lock`, {
        client: client.current,
      });
      try {
        const d = await workspaceApi(`documents/${id}`);
        if (
          opts.current.state.current.dirty &&
          d.revision !== current.current?.revision
        )
          throw Error(
            "服务器已有新版本。请先下载当前副本，再加载最新版本；当前修改未覆盖。",
          );
        if (!opts.current.state.current.dirty) await adopt(d);
        lease.current = { ...l, expires: requestedAt + l.leaseMs };
        workspaceContext.lockToken = l.token;
        await options.bridge.invoke("setReadOnly", { value: false });
        setEditing(true);
        setNotice("你正在编辑 · 修改每 2 秒自动保存到服务器");
      } catch (e) {
        await workspaceApi(`documents/${id}/release`, {
          lockToken: l.token,
        }).catch(() => {});
        throw e;
      }
    }, propagateError);
  const release = () =>
    run(async () => {
      if (saving.current) throw Error("正在保存，请稍后结束编辑");
      if (!(await save())) return;
      await workspaceApi(`documents/${id}/release`, {
        lockToken: lease.current?.token,
      });
      await readonly();
      setNotice("已结束编辑，其他人可以获取编辑权");
    });
  const reload = () =>
    run(async () => {
      if (
        opts.current.state.current.dirty &&
        !confirm(
          "加载服务器最新版本会放弃当前未同步的修改。请先用“保存副本”下载备份。确定继续？",
        )
      )
        return;
      if (lease.current)
        await workspaceApi(`documents/${id}/release`, {
          lockToken: lease.current.token,
        }).catch(() => {});
      await readonly();
      await adopt(await workspaceApi(`documents/${id}`));
      initialized.current = true;
      setNotice("已加载最新版本 · 只读");
    });
  const panel = id ? (
    <>
      <div className="shared-document-bar">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            void run(async () => {
              if (saving.current) throw Error("正在保存，请稍后返回文件库");
              if (lease.current) {
                if (!(await save())) return;
                await workspaceApi(`documents/${id}/release`, {
                  lockToken: lease.current.token,
                });
                lease.current = undefined;
                workspaceContext.lockToken = undefined;
              } else if (
                opts.current.state.current.dirty &&
                !confirm("当前有未同步修改，建议先下载副本。仍返回文件库？")
              )
                return;
              location.assign("/");
            });
          }}
        >
          ← 文件库
        </a>
        <strong>{workspaceContext.actor?.name}</strong>
        <span className={editing ? "shared-editing" : "shared-readonly"}>
          {editing
            ? "你正在编辑"
            : doc?.lock
              ? `${doc.lock.name} 正在编辑 · 你只读`
              : "只读"}
        </span>
        <span className="shared-notice" role="status">
          {notice}
        </span>
        <button
          disabled={!doc}
          ref={shareButton}
          onClick={() => {
            setSharing(true);
            setShareMessage("");
          }}
        >
          分享链接
        </button>
        {editing ? (
          <>
            <button disabled={busy} onClick={() => void save()}>
              保存到服务器
            </button>
            <button disabled={busy} onClick={() => void release()}>
              结束编辑
            </button>
          </>
        ) : (
          <button
            className="primary"
            disabled={!doc || busy}
            onClick={() => void acquire()}
          >
            获取编辑权
          </button>
        )}
        <button disabled={busy} onClick={() => void reload()}>
          加载最新版本
        </button>
        <button
          onClick={() =>
            void run(async () =>
              setVersions(await workspaceApi(`documents/${id}/versions`)),
            )
          }
        >
          服务器版本
        </button>
        <button
          disabled={
            !editing ||
            busy ||
            (!workspaceContext.actor?.admin &&
              workspaceContext.actor?.id !== doc?.owner)
          }
          onClick={() =>
            void run(async () => {
              if (!confirm("将这份图稿移入回收站？之后可在文件库恢复。"))
                return;
              if (saving.current) throw Error("正在保存，请稍后删除");
              if (!(await save())) return;
              await workspaceApi(`documents/${id}/trash`, {
                revision: current.current.revision,
                lockToken: lease.current?.token,
              });
              await readonly();
              location.assign("/");
            })
          }
        >
          移入回收站
        </button>
      </div>
      {sharing && (
        <ShareDialog
          id={id!}
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
              <button onClick={() => setVersions(null)}>关闭</button>
            </div>
            <p>
              每次保存保留一个版本，最多 50
              个。恢复会生成新版本，其他只读页面自动更新。
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
                  disabled={!editing || busy}
                  onClick={() =>
                    void run(async () => {
                      if (saving.current) throw Error("正在保存，请稍后恢复");
                      if (!(await save())) return;
                      const d = await workspaceApi(
                        `documents/${id}/versions/${v.revision}/restore`,
                        {
                          revision: current.current.revision,
                          lockToken: lease.current?.token,
                        },
                      );
                      await adopt(d);
                      setVersions(
                        await workspaceApi(`documents/${id}/versions`),
                      );
                      setNotice(`已恢复历史内容，当前版本 ${d.revision}`);
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
    denied,
    editing,
    acquire: () => acquire(true),
    panel,
    save,
    doc,
    isDirty: (snapshot: any) =>
      snapshot.revision !== opts.current.savedRevision.current ||
      (!!current.current &&
        current.current.name !== opts.current.state.current.name),
  };
}
