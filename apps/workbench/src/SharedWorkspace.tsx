import React, { useEffect, useRef, useState } from "react";
import type { Bridge } from "./bridge";
import "./shared.css";
import { TemplatePicker } from "./TemplatePicker";
import { templateXml } from "../../../packages/diagram-templates";

import { uuid, copyText } from "./uuid";
export type Actor = { id: string; name: string; admin: boolean };
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
      ? boot.token || localStorage.getItem("zhitu-session") || ""
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
          localStorage.removeItem("zhitu-session");
          workspaceContext.token = "";
        } else {
          setConnectionError(true);
          setError(e.message || "工作区暂时无法连接");
        }
      })
      .finally(() => setLoading(false));
  }, []);
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
  if (!actor)
    return (
      <main className="shared-login">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              const r = await workspaceApi("session", { name });
              localStorage.setItem("zhitu-session", r.token);
              workspaceContext.token = r.token;
              workspaceContext.actor = r.actor;
              setActor(r.actor);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="shared-kicker">AI智图 · 团队工作区</span>
          <h1>一起维护清晰的图稿</h1>
          <p>首次填写用户名即可进入，同一浏览器下次自动识别。</p>
          <label>
            用户名
            <input
              required
              autoFocus
              autoComplete="nickname"
              placeholder="例如：小王"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="primary" disabled={busy || !name.trim()}>
            {busy ? "正在进入…" : "进入工作区"}
          </button>
          <small>同一时间一人编辑，保存后其他访问者自动更新。</small>
        </form>
      </main>
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
  const [docs, setDocs] = useState<any[]>([]),
    [trash, setTrash] = useState(false),
    [query, setQuery] = useState(""),
    [name, setName] = useState("未命名图稿"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const reload = async () =>
    setDocs(await workspaceApi("documents" + (trash ? "?deleted=1" : "")));
  useEffect(() => {
    let active = true;
    const update = async () => {
      try {
        const d = await workspaceApi("documents" + (trash ? "?deleted=1" : ""));
        if (active) {
          setDocs(d);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void update();
    const t = setInterval(update, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [trash]);
  const run = async (fn: () => Promise<void>) => {
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
  return (
    <main className="shared-library">
      <header>
        <a className="shared-brand" href="/">
          图 <strong>AI智图</strong>
          <span>共享工作区</span>
        </a>
        <div>
          {actor.name} · {actor.admin ? "管理员" : "成员"}
          {actor.id !== "local-admin" && (
            <button
              onClick={() =>
                void run(async () => {
                  const name = prompt("修改用户名", actor.name);
                  if (name === null) return;
                  const next = await workspaceApi("session", { name }, "PATCH");
                  workspaceContext.actor = next;
                  onActor(next);
                })
              }
            >
              修改用户名
            </button>
          )}
        </div>
      </header>
      <section className="shared-hero">
        <span className="shared-kicker">团队图稿，集中保存</span>
        <h1>文件库</h1>
        <p>
          打开一份图稿，获取编辑权后开始修改。保存的内容会自动更新到其他页面。
        </p>
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
          新建共享图稿
        </button>
        {templateOpen && <TemplatePicker initialName={name === "未命名图稿" ? "" : name} onClose={() => setTemplateOpen(false)} onCreate={async (template, title) => {
          const d = await workspaceApi("documents", { name: title, xml: templateXml(template, title) });
          location.assign("/documents/" + d.id);
        }} />}
        <label className="shared-import">
          导入 .drawio
          <input
            aria-label="导入共享图稿"
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
            <button
              className={!trash ? "active" : ""}
              onClick={() => setTrash(false)}
            >
              全部文件
            </button>
            <button
              className={trash ? "active" : ""}
              onClick={() => setTrash(true)}
            >
              回收站
            </button>
          </div>
          <input
            aria-label="搜索图稿"
            placeholder="搜索图稿名称"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="shared-table">
          <div className="shared-row shared-table-head">
            <span>图稿名称</span>
            <span>创建人</span>
            <span>最后保存人 / 时间</span>
            <span>编辑状态</span>
            <span>操作</span>
          </div>
          {docs
            .filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
            .map((d) => (
              <div className="shared-row" key={d.id}>
                <div>
                  <a href={trash ? undefined : "/documents/" + d.id}>
                    {d.name}
                  </a>
                  <small>版本 {d.revision}</small>
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
                      : "可获取编辑权"}
                </span>
                <div>
                  {trash ? (
                    <button
                      disabled={busy || (!actor.admin && actor.id !== d.owner)}
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
                    <a className="shared-open" href={"/documents/" + d.id}>
                      打开图稿 →
                    </a>
                  )}
                </div>
              </div>
            ))}
          {!docs.length && (
            <div className="shared-empty">
              {trash ? "回收站为空" : "还没有共享图稿，创建或导入第一份图稿。"}
            </div>
          )}
        </div>
      </section>
      <footer>
        文件保存在运行服务的电脑上 · 每份图稿保留最近 50 个服务器版本
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
  link,
  message,
  copying,
  trigger,
  onCopy,
  onClose,
}: {
  link: string;
  message: string;
  copying: boolean;
  trigger: React.RefObject<HTMLButtonElement | null>;
  onCopy: () => void;
  onClose: () => void;
}) {
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
      <p>同一局域网的同事打开链接，首次填写用户名即可查看。</p>
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
        <button className="primary" disabled={copying} onClick={onCopy}>
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
    if (!id || !options.ready) return;
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
          initialized.current = true;
          setNotice(`已同步服务器版本 ${d.revision} · 只读`);
        } else {
          setDoc((old: any) => ({ ...old, lock: d.lock }));
        }
        if (
          lease.current &&
          opts.current.state.current.dirty &&
          !(await opts.current.bridge.invoke("editing")).editing
        )
          await save();
      } catch (e) {
        if (!stopped) {
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
  }, [id, options.ready]);
  const run = async (fn: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      await pollFinished.current;
      await fn();
    } catch (e) {
      options.onError(e);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const acquire = () =>
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
    });
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
        <a href="/">← 文件库</a>
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
          ref={shareButton}
          onClick={() => {
            setSharing(true);
            void copyShareLink();
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
    editing,
    panel,
    save,
    doc,
    isDirty: (snapshot: any) =>
      snapshot.revision !== opts.current.savedRevision.current ||
      (!!current.current &&
        current.current.name !== opts.current.state.current.name),
  };
}
