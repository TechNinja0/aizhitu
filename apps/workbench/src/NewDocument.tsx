import React, { useEffect, useRef, useState } from "react";
import type { Bridge } from "./bridge";
import { workspaceApi, workspaceContext } from "./SharedWorkspace";
import { uuid } from "./uuid";

type Content = { name: string; xml: string };
type Pending = Content & { owner: string; submission?: Content };
const keyFor = (id: string) => `zhitu-new:${id}`;
export function startNewDocument(name: string, xml: string) {
  const id = uuid();
  sessionStorage.setItem(
    keyFor(id),
    JSON.stringify({ name, xml, owner: workspaceContext.actor!.id }),
  );
  location.assign(`/new/${id}`);
}

// The seed stays in this tab only. A server document is created on the first real edit.
export function useNewDocument(options: {
  bridge: Bridge;
  state: React.RefObject<{ name: string; dirty: boolean }>;
  load: (xml: string, name: string) => Promise<void>;
  setDirty: (dirty: boolean) => void;
}) {
  const id = location.pathname.match(/^\/new\/([\w-]+)$/)?.[1];
  const opts = useRef(options);
  opts.current = options;
  const seed = useRef<Pending | undefined>(undefined);
  const baseline = useRef({ revision: 0, name: "" });
  const initialized = useRef(false);
  const saving = useRef<Promise<boolean> | undefined>(undefined);
  const [frozen, setFrozen] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  async function initialize() {
    if (!id) return;
    try {
      const raw = sessionStorage.getItem(keyFor(id));
      if (!raw) throw Error("missing");
      const value: Pending = JSON.parse(raw);
      if (value.owner !== workspaceContext.actor?.id) throw Error("owner");
      seed.current = value;
      const content = value.submission || value;
      await opts.current.load(content.xml, content.name);
      const snapshot = await opts.current.bridge.invoke("snapshot");
      baseline.current = { revision: snapshot.revision, name: content.name };
      initialized.current = true;
      setPrepared(true);
      if (value.submission) {
        await opts.current.bridge.invoke("setReadOnly", { value: true });
        opts.current.state.current.dirty = true;
        opts.current.setDirty(true);
        setFrozen(true);
        setError("上次保存未确认，内容已保留在此标签页。请重试保存。");
      }
    } catch {
      setMissing(true);
    }
  }
  function isDirty(snapshot: { revision: number }) {
    return (
      initialized.current &&
      (snapshot.revision !== baseline.current.revision ||
        opts.current.state.current.name !== baseline.current.name ||
        !!seed.current?.submission)
    );
  }
  function save(force = false, returning = false): Promise<boolean> {
    if (saving.current) return saving.current;
    if (!id || !initialized.current || !seed.current)
      return Promise.resolve(false);
    const work = async () => {
      let submitted = !!seed.current?.submission;
      try {
        const snapshot = await opts.current.bridge.invoke("snapshot");
        if (!force && !isDirty(snapshot)) {
          opts.current.state.current.dirty = false;
          opts.current.setDirty(false);
          if (returning) {
            sessionStorage.removeItem(keyFor(id));
            location.assign("/");
          }
          return true;
        }
        setFrozen(true);
        setError("");
        // Commit any active text editor, then freeze until the first save is acknowledged.
        await opts.current.bridge.invoke("setReadOnly", { value: true });
        const latest = await opts.current.bridge.invoke("snapshot");
        const content = seed.current!.submission || {
          xml: latest.xml,
          name: opts.current.state.current.name,
        };
        const next = { ...seed.current!, submission: content };
        sessionStorage.setItem(keyFor(id), JSON.stringify(next));
        seed.current = next;
        submitted = true;
        opts.current.state.current.dirty = true;
        opts.current.setDirty(true);
        const document = await workspaceApi("documents", {
          ...content,
          requestKey: id,
        });
        opts.current.state.current.dirty = false;
        opts.current.setDirty(false);
        sessionStorage.removeItem(keyFor(id));
        location.replace(returning ? "/" : `/documents/${document.id}`);
        return true;
      } catch (e) {
        const rejected = [400, 422].includes(
          (e as { status?: number }).status || 0,
        );
        if (rejected && seed.current) {
          // Validation failed before any write: allow the user to correct the current graph/name.
          delete seed.current.submission;
          try {
            sessionStorage.setItem(keyFor(id), JSON.stringify(seed.current));
          } catch {}
          submitted = false;
        }
        setError(
          `${(e as Error).message}；${rejected ? "请修正后重新保存。" : "内容保留在当前标签页，请重试保存。"}`,
        );
        // Keep the submitted payload fixed if an interrupted response may already have saved it.
        if (!submitted) {
          await opts.current.bridge.invoke("setReadOnly", { value: false });
          setFrozen(false);
        }
        return false;
      } finally {
        saving.current = undefined;
      }
    };
    saving.current = work();
    return saving.current;
  }
  const latestSave = useRef(save);
  latestSave.current = save;
  useEffect(() => {
    if (!id) return;
    const timer = setInterval(async () => {
      if (
        !initialized.current ||
        saving.current ||
        seed.current?.submission ||
        !opts.current.state.current.dirty
      )
        return;
      try {
        if (!(await opts.current.bridge.invoke("editing")).editing)
          await latestSave.current();
      } catch (e) {
        setError((e as Error).message);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [id]);
  return {
    active: !!id,
    frozen,
    missing,
    initialize,
    isDirty,
    replaceSeed: async (xml: string, name: string) => {
      if (!id || !seed.current || seed.current.submission)
        throw Error("当前图稿正在保存");
      const next = { xml, name, owner: seed.current.owner };
      sessionStorage.setItem(keyFor(id), JSON.stringify(next));
      await initialize();
    },
    save: (force = false) => save(force),
    panel: id ? (
      <div className="shared-document-bar">
        <a
          href="/"
          onClick={(e) => {
            if (!initialized.current) return;
            e.preventDefault();
            if (missing) location.assign("/");
            else void save(false, true);
          }}
        >
          ← 文件库
        </a>
        <span>新图稿 · 修改后自动保存，仅自己可见；未修改返回不保存</span>
        <button disabled={!prepared || frozen} onClick={() => void save(true)}>
          保存到文件库
        </button>
        {error && !frozen && <span role="alert">{error}</span>}
      </div>
    ) : null,
    overlay:
      id && frozen ? (
        <div className="scrim">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="首次保存图稿"
          >
            <h2>{error ? "保存尚未完成" : "正在保存图稿…"}</h2>
            <p role="status">{error || "正在创建文件，保存成功后继续编辑。"}</p>
            {error && (
              <>
                <button className="primary" onClick={() => void save(true)}>
                  重试保存
                </button>
                <button
                  onClick={() => {
                    const content = seed.current?.submission;
                    if (!content) return;
                    const url = URL.createObjectURL(
                      new Blob([content.xml], { type: "application/xml" }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = content.name.endsWith(".drawio")
                      ? content.name
                      : content.name + ".drawio";
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                  }}
                >
                  下载当前副本
                </button>
              </>
            )}
          </section>
        </div>
      ) : null,
  };
}
