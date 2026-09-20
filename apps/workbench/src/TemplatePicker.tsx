import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  categories,
  templates,
  templateSvg,
  type DiagramTemplate,
} from "../../../packages/diagram-templates";
import "./templates.css";

const previews = new Map(
  templates.map((t) => [
    t.id,
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(templateSvg(t))}`,
  ]),
);
export function TemplatePicker({
  initialName = "",
  onClose,
  onCreate,
}: {
  initialName?: string;
  onClose: () => void;
  onCreate: (template: DiagramTemplate | null, name: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [category, setCategory] = useState("all"),
    [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DiagramTemplate | null>(null);
  const [name, setName] = useState(initialName.replace(/\.drawio$/i, ""));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      prior?.focus({ preventScroll: true });
    };
  }, []);
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = templates.filter(
    (t) =>
      (category === "all" || t.category === category) &&
      words.every((word) =>
        `${t.name} ${t.description} ${t.tags.join(" ")} ${categories.find((c) => c.id === t.category)?.name}`
          .toLocaleLowerCase()
          .includes(word),
      ),
  );
  const create = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await onCreate(selected, name.trim() || selected?.name || "未命名图稿");
    } catch (e) {
      setError((e as Error).message || "创建失败，请重试");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="template-picker"
      aria-labelledby="template-picker-title"
      onCancel={(event) => {
        event.preventDefault();
        if (expanded) setExpanded(false);
        else if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          const r = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header className="template-heading">
        <div>
          <span className="template-kicker">从一个好起点开始</span>
          <h2 id="template-picker-title">新建图稿</h2>
          <p>选择一份模板，把想法变成清晰的图。也可以从空白画布开始。</p>
        </div>
        <button
          aria-label="关闭模板选择"
          className="template-close"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="template-body">
        <aside
          className="template-sidebar"
          aria-label="模板分类"
          inert={expanded}
        >
          <span className="template-section-label">模板分类</span>
          {[{ id: "all", name: "全部模板", symbol: "▦" }, ...categories].map(
            (c) => (
              <button
                key={c.id}
                disabled={busy}
                aria-pressed={category === c.id}
                className={category === c.id ? "selected" : ""}
                onClick={() => {
                  setCategory(c.id);
                  setExpanded(false);
                }}
              >
                <span aria-hidden="true">{c.symbol}</span>
                {c.name}
                <small>
                  {c.id === "all"
                    ? templates.length
                    : templates.filter((t) => t.category === c.id).length}
                </small>
              </button>
            ),
          )}
          <div className="template-sidebar-note">
            <span aria-hidden="true">↗</span>
            <strong>起步即有结构</strong>
            <p>
              图形、文字、连线
              <br />
              创建后均可自由编辑
            </p>
          </div>
        </aside>
        <section
          className="template-browser"
          aria-label="模板列表"
          inert={expanded}
        >
          <div className="template-search-row">
            <label className="template-search">
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <circle cx="10" cy="10" r="6" />
                <path d="m15 15 5 5" />
              </svg>
              <input
                aria-label="搜索模板"
                type="search"
                placeholder="搜索模板，例如：微服务、审批、ER"
                value={query}
                disabled={busy}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <span>{filtered.length} 个模板</span>
          </div>
          <div className="template-cards">
            <button
              className={`template-card template-blank ${!selected ? "selected" : ""}`}
              aria-label="选择空白画布"
              aria-pressed={!selected}
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setExpanded(false);
              }}
            >
              <div className="template-thumbnail">
                <span className="template-blank-page">＋</span>
                <span className="template-card-check" aria-hidden="true">
                  ✓
                </span>
              </div>
              <div className="template-card-copy">
                <strong>空白画布</strong>
                <small>自由绘制，从零开始</small>
              </div>
            </button>
            {filtered.map((t) => (
              <button
                key={t.id}
                className={`template-card ${selected?.id === t.id ? "selected" : ""}`}
                aria-label={`选择模板：${t.name}`}
                aria-pressed={selected?.id === t.id}
                disabled={busy}
                onClick={() => {
                  setSelected(t);
                  setExpanded(false);
                }}
              >
                <div className="template-thumbnail">
                  <img
                    src={previews.get(t.id)}
                    alt={`${t.name}缩略图`}
                    loading="lazy"
                  />
                  <span className="template-card-check" aria-hidden="true">
                    ✓
                  </span>
                </div>
                <div className="template-card-copy">
                  <strong>{t.name}</strong>
                  <small>{t.tags.slice(0, 2).join(" · ")}</small>
                </div>
              </button>
            ))}
          </div>
          {!filtered.length && (
            <div className="template-no-results" role="status">
              <strong>没有找到匹配的模板</strong>
              <p>试试其他关键词，或直接创建空白画布。</p>
              <button
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
              >
                查看全部模板
              </button>
            </div>
          )}
        </section>
        <aside
          className={`template-detail ${expanded ? "expanded" : ""}`}
          aria-label="所选模板预览"
        >
          <div className="template-detail-top">
            <span className="template-section-label">
              {expanded ? "大图预览" : "当前选择"}
            </span>
            {selected && (
              <button onClick={() => setExpanded(!expanded)}>
                {expanded ? "收起预览" : "放大预览"}
              </button>
            )}
          </div>
          <div className="template-large-preview">
            {selected ? (
              <img
                src={previews.get(selected.id)}
                alt={`${selected.name}大图预览`}
              />
            ) : (
              <div className="template-blank-detail">
                <span className="template-blank-page">＋</span>
                <span>无限想法，从这里展开</span>
              </div>
            )}
          </div>
          <div className="template-detail-copy">
            <span className="template-detail-category">
              {selected
                ? categories.find((c) => c.id === selected.category)?.name
                : "自由创作"}
            </span>
            <h3>{selected?.name || "空白画布"}</h3>
            <p>
              {selected?.description ||
                "没有预设的结构。添加第一个图形，开始绘制属于你的图稿。"}
            </p>
            {selected && (
              <>
                <div className="template-tags">
                  {selected.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <small className="template-object-count">
                  {selected.nodes.length} 个图形 · {selected.edges.length}{" "}
                  条连线 · 可编辑
                </small>
                <a
                  className="template-reference"
                  href={selected.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  参考：{selected.source.name} ↗
                </a>
                <small className="template-reference-note">
                  依据常见图式重新绘制
                </small>
              </>
            )}
          </div>
        </aside>
      </div>
      <form
        className="template-footer"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label>
          图稿名称
          <input
            aria-label="新建图稿名称"
            maxLength={112}
            value={name}
            disabled={busy}
            placeholder={selected?.name || "未命名图稿"}
            onChange={(event) => setName(event.target.value)}
          />
          <span>.drawio</span>
        </label>
        {error && (
          <p className="template-error" role="alert">
            {error}
          </p>
        )}
        <div className="template-footer-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "正在创建…" : selected ? "使用此模板" : "创建空白画布"}
            <span aria-hidden="true"> →</span>
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
