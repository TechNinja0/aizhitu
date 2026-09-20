import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { categories, templates } from "../../../packages/diagram-templates";
import "./templates.css";

import { workspaceApi } from "./SharedWorkspace";
import {
  previewFor,
  countsFor,
  isPersonal,
  type TemplateChoice,
} from "./template-library";
import type { PersonalTemplate } from "../../../packages/diagram-templates/personal";

export function TemplatePicker({
  initialName = "",
  mode = "create",
  onClose,
  onCreate,
}: {
  initialName?: string;
  mode?: "create" | "fill";
  onClose: () => void;
  onCreate: (template: TemplateChoice | null, name: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [category, setCategory] = useState("all"),
    [query, setQuery] = useState("");
  const [selected, setSelected] = useState<TemplateChoice | null>(null);
  const [name, setName] = useState(initialName.replace(/\.drawio$/i, ""));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [personal, setPersonal] = useState<PersonalTemplate[]>([]);
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const [level, setLevel] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const [editFields, setEditFields] = useState<{
    name: string;
    description: string;
    category: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void workspaceApi("templates")
      .then((data) => {
        if (active) setPersonal(data);
      })
      .catch((e) => {
        if (active) setLoadError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  const allTemplates: TemplateChoice[] = [...templates, ...personal];
  const manage = async (remove: boolean) => {
    if (busy || !selected || !isPersonal(selected)) return;
    setBusy(true);
    setError("");
    try {
      if (remove) {
        await workspaceApi(`templates/${selected.id}`, undefined, "DELETE");
        setPersonal((items) => items.filter((t) => t.id !== selected.id));
        setSelected(null);
        setDeleteConfirm(false);
      } else {
        const next = await workspaceApi(
          `templates/${selected.id}`,
          editFields,
          "PATCH",
        );
        setPersonal((items) => items.map((t) => (t.id === next.id ? next : t)));
        setSelected(next);
        setEditFields(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
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
  const filtered = allTemplates.filter(
    (t) =>
      (category === "all" ||
        (category === "personal" ? isPersonal(t) : t.category === category)) &&
      (level === "all" ||
        (!isPersonal(t) &&
          (level === "advanced"
            ? t.complexity === "advanced"
            : !t.complexity))) &&
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
          <h2 id="template-picker-title">
            {mode === "fill" ? "选择模板" : "新建图稿"}
          </h2>
          <p>
            {mode === "fill"
              ? "为当前空白草稿选择一个起点，图形、文字与连线均可继续编辑。"
              : "选择一份模板，把想法变成清晰的图。也可以从空白画布开始。"}
          </p>
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
          {[
            { id: "all", name: "全部模板", symbol: "▦" },
            { id: "personal", name: "我的模板", symbol: "☆" },
            ...categories,
          ].map((c) => (
            <button
              key={c.id}
              disabled={busy}
              aria-pressed={category === c.id}
              className={category === c.id ? "selected" : ""}
              onClick={() => {
                setCategory(c.id);
                setLevel("all");
                setExpanded(false);
              }}
            >
              <span aria-hidden="true">{c.symbol}</span>
              {c.name}
              <small>
                {c.id === "all"
                  ? allTemplates.length
                  : c.id === "personal"
                    ? personal.length
                    : allTemplates.filter((t) => t.category === c.id).length}
              </small>
            </button>
          ))}
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
          <div className="template-filters" aria-label="模板复杂度">
            {category !== "personal" &&
              [
                ["all", "全部难度"],
                ["advanced", "进阶模板"],
                ["basic", "基础模板"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  disabled={busy}
                  aria-pressed={level === value}
                  onClick={() => setLevel(value)}
                >
                  {label}
                </button>
              ))}
            {loading && <small role="status">正在加载我的模板…</small>}
          </div>
          {loadError && (
            <p className="template-load-error" role="alert">
              我的模板加载失败：{loadError}
              <button disabled={busy} onClick={() => setRefresh((x) => x + 1)}>
                重试
              </button>
            </p>
          )}
          <div className="template-cards">
            {mode === "create" && (
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
            )}
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
                  setEditFields(null);
                  setDeleteConfirm(false);
                  setError("");
                }}
              >
                <div className="template-thumbnail">
                  <img
                    src={previewFor(t)}
                    alt={`${t.name}缩略图`}
                    loading="lazy"
                  />
                  <span className="template-card-check" aria-hidden="true">
                    ✓
                  </span>
                </div>
                <div className="template-card-copy">
                  <strong>{t.name}</strong>
                  <span className="template-level">
                    {isPersonal(t)
                      ? "我的模板"
                      : t.complexity === "advanced"
                        ? "进阶"
                        : "基础"}
                  </span>
                  <small>{t.tags.slice(0, 2).join(" · ")}</small>
                </div>
              </button>
            ))}
          </div>
          {!filtered.length && (
            <div className="template-no-results" role="status">
              <strong>
                {category === "personal" && !personal.length
                  ? "还没有个人模板"
                  : "没有找到匹配的模板"}
              </strong>
              <p>
                {category === "personal" && !personal.length
                  ? "在编辑器中打开图稿，点击「保存为模板」，即可在这里复用。"
                  : mode === "fill"
                    ? "试试其他关键词，或查看全部模板。"
                    : "试试其他关键词，或直接创建空白画布。"}
              </p>
              <button
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                  setLevel("all");
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
              <button
                onClick={() => {
                  setExpanded(!expanded);
                  setPreviewZoom(1);
                }}
              >
                {expanded ? "收起预览" : "放大预览"}
              </button>
            )}
          </div>
          {expanded && (
            <div className="template-preview-zoom" aria-label="模板预览缩放">
              <button
                onClick={() => setPreviewZoom((z) => Math.max(1, z / 1.5))}
                disabled={previewZoom === 1}
              >
                缩小
              </button>
              <button onClick={() => setPreviewZoom(1)}>适应</button>
              <button
                onClick={() => setPreviewZoom((z) => Math.min(4, z * 1.5))}
                disabled={previewZoom === 4}
              >
                放大
              </button>
              <small>{Math.round(previewZoom * 100)}%</small>
            </div>
          )}
          <div
            className={`template-large-preview ${expanded && previewZoom > 1 ? "zoomed" : ""}`}
          >
            {selected ? (
              <img
                src={previewFor(selected)}
                alt={`${selected.name}大图预览`}
                style={
                  expanded && previewZoom > 1
                    ? {
                        width: `${previewZoom * 100}%`,
                        height: `${previewZoom * 100}%`,
                        maxWidth: "none",
                      }
                    : undefined
                }
              />
            ) : (
              <div className="template-blank-detail">
                <span className="template-blank-page">＋</span>
                <span>
                  {mode === "fill"
                    ? "点击模板卡片查看预览"
                    : "无限想法，从这里展开"}
                </span>
              </div>
            )}
          </div>
          <div className="template-detail-copy">
            <span className="template-detail-category">
              {selected
                ? categories.find((c) => c.id === selected.category)?.name
                : "自由创作"}
            </span>
            <h3>
              {selected?.name ||
                (mode === "fill" ? "选择一个模板" : "空白画布")}
            </h3>
            <p>
              {selected?.description ||
                (mode === "fill"
                  ? "所选模板将应用到当前空白草稿，保留文件名与分享链接。"
                  : "没有预设的结构。添加第一个图形，开始绘制属于你的图稿。")}
            </p>
            {selected && (
              <>
                <div className="template-tags">
                  {selected.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <small className="template-object-count">
                  {countsFor(selected).nodes} 个图形 ·{" "}
                  {countsFor(selected).edges} 条连线 · 可编辑
                </small>
                {!isPersonal(selected) && (
                  <>
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
                {isPersonal(selected) && (
                  <div className="template-management">
                    <small>
                      仅自己可见 ·{" "}
                      {new Date(selected.updatedAt).toLocaleDateString("zh-CN")}
                    </small>
                    {editFields ? (
                      <div className="template-edit-fields">
                        <label>
                          名称
                          <input
                            aria-label="编辑模板名称"
                            maxLength={100}
                            value={editFields.name}
                            disabled={busy}
                            onChange={(e) =>
                              setEditFields({
                                ...editFields,
                                name: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          分类
                          <select
                            aria-label="编辑模板分类"
                            value={editFields.category}
                            disabled={busy}
                            onChange={(e) =>
                              setEditFields({
                                ...editFields,
                                category: e.target.value,
                              })
                            }
                          >
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          说明
                          <textarea
                            aria-label="编辑模板说明"
                            maxLength={300}
                            rows={3}
                            value={editFields.description}
                            disabled={busy}
                            onChange={(e) =>
                              setEditFields({
                                ...editFields,
                                description: e.target.value,
                              })
                            }
                          />
                        </label>
                        <button
                          disabled={busy || !editFields.name.trim()}
                          onClick={() => void manage(false)}
                        >
                          保存模板信息
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => setEditFields(null)}
                        >
                          取消编辑
                        </button>
                      </div>
                    ) : deleteConfirm ? (
                      <div>
                        <p>删除模板后，已创建的图稿仍会保留。</p>
                        <button
                          disabled={busy}
                          onClick={() => void manage(true)}
                        >
                          确认删除模板
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => setDeleteConfirm(false)}
                        >
                          保留模板
                        </button>
                      </div>
                    ) : (
                      <div>
                        <button
                          disabled={busy}
                          onClick={() =>
                            setEditFields({
                              name: selected.name,
                              description: selected.description,
                              category: selected.category,
                            })
                          }
                        >
                          编辑信息
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => setDeleteConfirm(true)}
                        >
                          删除模板
                        </button>
                      </div>
                    )}
                  </div>
                )}
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
        {mode === "create" ? (
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
        ) : (
          <span className="template-current-file">
            应用到当前草稿：{initialName}
          </span>
        )}
        {error && (
          <p className="template-error" role="alert">
            {error}
          </p>
        )}
        <div className="template-footer-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || (mode === "fill" && !selected)}
          >
            {busy
              ? mode === "fill"
                ? "正在应用…"
                : "正在创建…"
              : mode === "fill"
                ? "应用到当前草稿"
                : selected
                  ? "使用此模板"
                  : "创建空白画布"}
            <span aria-hidden="true"> →</span>
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
