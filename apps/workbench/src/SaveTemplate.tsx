import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { categories } from "../../../packages/diagram-templates";
import { uuid } from "./uuid";
import type { Bridge } from "./bridge";

type Api = (path: string, body?: unknown, method?: string) => Promise<Response>;
export function SaveTemplate({
  bridge,
  api,
  name,
  onClose,
  onSaved,
}: {
  bridge: Bridge;
  api: Api;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    id = useRef(uuid()),
    active = useRef(true),
    saving = useRef(false);
  const snapshot = useRef<string | undefined>(undefined),
    jobId = useRef<string | undefined>(undefined);
  const [title, setTitle] = useState(name.replace(/\.drawio$/i, "")),
    [description, setDescription] = useState(""),
    [category, setCategory] = useState("architecture");
  const [preview, setPreview] = useState(""),
    [rendering, setRendering] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement,
      element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    active.current = true;
    let stopped = false,
      url = "",
      timer: ReturnType<typeof setTimeout> | undefined;
    setRendering(true);
    setError("");
    setPreview("");
    const render = async () => {
      if (!snapshot.current) {
        const s = await bridge.invoke("snapshot");
        if (!s.counts.nodes) throw Error("空白图稿不能保存为模板");
        snapshot.current = s.xml;
      }
      if (stopped) return;
      const job = await (
        await api("exports", {
          xml: snapshot.current,
          options: { format: "png", scale: 1, margin: 20 },
        })
      ).json();
      if (stopped) {
        void api(`jobs/${job.jobId}`, undefined, "DELETE").catch(() => {});
        return;
      }
      jobId.current = job.jobId;
      const poll = async () => {
        try {
          const state = await (await api(`jobs/${job.jobId}`)).json();
          if (stopped) return;
          if (state.status === "failed" || state.status === "cancelled")
            throw Error(state.error || "预览已取消");
          if (state.status !== "succeeded") {
            timer = setTimeout(() => void poll(), 400);
            return;
          }
          const response = await api(`jobs/${job.jobId}/result`),
            blob = await response.blob();
          if (stopped) return;
          url = URL.createObjectURL(blob);
          setPreview(url);
          setRendering(false);
        } catch (e) {
          if (!stopped) {
            setError((e as Error).message);
            setRendering(false);
          }
        }
      };
      await poll();
    };
    void render().catch((e) => {
      if (!stopped) {
        setError(e.message);
        setRendering(false);
      }
    });
    return () => {
      active.current = false;
      stopped = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
      if (jobId.current) {
        void api(`jobs/${jobId.current}`, undefined, "DELETE").catch(() => {});
        jobId.current = undefined;
      }
    };
  }, [attempt]);
  const save = async () => {
    if (saving.current || rendering || !preview) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await api("templates", {
        id: id.current,
        name: title.trim(),
        description,
        category,
        xml: snapshot.current,
        previewJobId: jobId.current,
      });
      if (active.current) onSaved();
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="save-template-dialog"
      aria-label="保存为模板"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <div>
          <span className="template-kicker">沉淀一份可复用的经验</span>
          <h2>保存为模板</h2>
        </div>
        <button aria-label="关闭保存模板" disabled={busy} onClick={onClose}>
          ×
        </button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="save-template-body">
          <div className="save-template-preview">
            {preview ? (
              <img src={preview} alt="个人模板预览" />
            ) : (
              <p role="status">
                {rendering ? "正在生成图稿预览…" : "预览暂不可用"}
              </p>
            )}
          </div>
          <div className="save-template-fields">
            <label>
              模板名称
              <input
                required
                aria-label="模板名称"
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              模板分类
              <select
                aria-label="模板分类"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={busy}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模板说明
              <textarea
                aria-label="模板说明"
                maxLength={300}
                rows={4}
                placeholder="例如：适合跨部门的多级审批，可调整部门与审批条件。"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
              />
            </label>
            <p>
              保存到「我的模板」，仅自己可见。保存的是当前图稿的独立快照，之后修改原图不会影响模板。
            </p>
          </div>
        </div>
        {error && (
          <div className="save-template-error" role="alert">
            {error}
            <button
              type="button"
              disabled={busy || rendering}
              onClick={() => setAttempt((a) => a + 1)}
            >
              重新生成预览
            </button>
          </div>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={busy || rendering || !preview || !title.trim()}
          >
            {busy ? "正在保存…" : "保存到我的模板"}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
