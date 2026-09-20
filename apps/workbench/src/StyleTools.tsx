import React, { useState, useEffect, useRef } from "react";
import type { Bridge } from "./bridge";
import "../../../packages/editor-adapter/themes.js";
const STORAGE = "zhitu-recent-colors-v1";
const basic = [
  "#ffffff",
  "#24323c",
  "#448464",
  "#4c78b8",
  "#7972b1",
  "#b57585",
  "#b68a39",
  "#488c91",
];
function readColors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE) || "[]");
    return Array.isArray(v)
      ? v
          .filter((c) => typeof c === "string" && /^#[\da-f]{6}$/i.test(c))
          .slice(0, 10)
      : [];
  } catch {
    return [];
  }
}
export function StyleTools({
  bridge,
  ready,
  selection,
  onApply,
  onError,
  onNotice,
}: {
  bridge: Bridge;
  ready: boolean;
  selection: string[];
  onApply: (s: any) => void;
  onError: (e: unknown) => void;
  onNotice: (s: string) => void;
}) {
  const [recent, setRecent] = useState(readColors),
    [color, setColor] = useState("#448464"),
    [target, setTarget] = useState("fillColor"),
    [palette, setPalette] = useState(false),
    [copied, setCopied] = useState<any>(),
    [busy, setBusy] = useState(false),
    [custom, setCustom] = useState("#448464");
  const container=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!palette)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setPalette(false);};const outside=(e:PointerEvent)=>{if(!container.current?.contains(e.target as Node))setPalette(false);};document.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);};},[palette]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const remember = (c: string) => {
    if (c === "none") return;
    const value = c.toLowerCase();
    setRecent((old) => {
      const next = [value, ...old.filter((x) => x !== value)].slice(0, 10);
      try {
        localStorage.setItem(STORAGE, JSON.stringify(next));
      } catch {}
      return next;
    });
    setColor(value);
    setCustom(value);
  };
  const applyColor = (c: string) =>
    void run(async () => {
      if (!/^#[\da-f]{6}$|^none$/i.test(c))
        throw Error("请输入 #RRGGBB 格式的颜色");
      onApply(await bridge.invoke("color", { key: target, value: c }));
      remember(c);
      onNotice("颜色已应用，可一步撤销");
    });
  const theme = (name: string) =>
    void run(async () => {
      const result = await bridge.invoke("preset", {
        name,
        all: selection.length === 0,
      });
      onApply(result);
      setPalette(false);
      onNotice(
        `已应用${DiagramThemes.find((t) => t.id === name)?.name}主题 · ${selection.length ? "所选对象" : "整张图"}，可一步撤销`,
      );
    });
  return (
    <div ref={container} className="style-toolbar" aria-label="快捷样式栏">
      <div className="style-toolbar-section">
        <button
          disabled={!ready || busy}
          onClick={() => setPalette(!palette)}
          aria-expanded={palette}
        >
          ◉ 主题配色
        </button>
        <select
          aria-label="样式预设"
          value=""
          disabled={!ready || busy}
          onChange={(e) => theme(e.target.value)}
        >
          <option value="" disabled>
            选择主题
          </option>
          {DiagramThemes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <small>
          {selection.length
            ? `应用于 ${selection.length} 个选中对象`
            : "主题应用于整张图"}
        </small>
      </div>
      <div className="style-toolbar-section">
        <select
          aria-label="颜色作用对象"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="fillColor">填充</option>
          <option value="strokeColor">边框 / 连线</option>
          <option value="fontColor">文字</option>
        </select>
        <label className="custom-color" title="选择自定义颜色">
          <input
            type="color"
            aria-label="选取颜色"
            value={color}
            disabled={!ready || !selection.length || busy}
            onChange={(e) => {
              setColor(e.target.value);
              setCustom(e.target.value);
            }}
          />
        </label>
        {basic.map((c) => (
          <button
            key={c}
            className="color-swatch"
            style={{ background: c }}
            title={`应用 ${c}`}
            aria-label={`颜色 ${c}`}
            disabled={!ready || !selection.length || busy}
            onClick={() => applyColor(c)}
          />
        ))}
        <input
          className="hex-color"
          aria-label="十六进制颜色"
          value={custom}
          maxLength={7}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && selection.length) applyColor(custom);
          }}
        />
        <button
          disabled={!ready || !selection.length || busy}
          onClick={() => applyColor(custom)}
        >
          用色
        </button>
        <button
          disabled={
            !ready || !selection.length || busy || target === "fontColor"
          }
          onClick={() => applyColor("none")}
        >
          无色
        </button>
      </div>
      {!!recent.length && (
        <div
          className="style-toolbar-section recent-colors"
          aria-label="最近使用颜色"
        >
          <small>最近</small>
          {recent.map((c) => (
            <button
              key={c}
              className="color-swatch"
              style={{ background: c }}
              title={c}
              aria-label={`最近颜色 ${c}`}
              disabled={!ready || !selection.length || busy}
              onClick={() => applyColor(c)}
            />
          ))}
        </div>
      )}
      <div className="style-toolbar-section">
        <button
          disabled={!ready || !selection.length || busy}
          onClick={() =>
            void run(async () => {
              setCopied(await bridge.invoke("copyAppearance"));
              onNotice("已复制外观，选择目标后点击粘贴样式");
            })
          }
        >
          复制样式
        </button>
        <button
          disabled={!ready || !selection.length || !copied || busy}
          title={copied ? `样式来自 ${copied.label}` : "先复制一个对象的样式"}
          onClick={() =>
            void run(async () => {
              onApply(await bridge.invoke("pasteAppearance", copied));
              onNotice("已粘贴样式，可一步撤销");
            })
          }
        >
          粘贴样式
        </button>
        <select
          aria-label="对齐与分布"
          value=""
          disabled={!ready || selection.length < 2 || busy}
          onChange={(e) => {
            const action = e.target.value;
            void run(async () => {
              onApply(await bridge.invoke("arrange", { action }));
              onNotice("排列已应用，可一步撤销");
            });
          }}
        >
          <option value="" disabled>
            对齐与分布
          </option>
          {[
            ["left", "左对齐"],
            ["center", "水平居中"],
            ["right", "右对齐"],
            ["top", "顶对齐"],
            ["middle", "垂直居中"],
            ["bottom", "底对齐"],
            ["horizontal", "水平等间距"],
            ["vertical", "垂直等间距"],
          ].map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {!selection.length && (
        <small className="style-selection-hint">
          选择对象后可改色与复制样式
        </small>
      )}
      {palette && (
        <div className="theme-popover" role="dialog" aria-label="图稿主题配色">
          <header>
            <div>
              <strong>给图稿一个清晰的风格</strong>
              <p>
                {selection.length ? "仅修改所选对象" : "应用于整张图"} ·
                保留文字、布局和连接关系 · 跳过锁定对象
              </p>
            </div>
            <button aria-label="关闭主题配色" onClick={() => setPalette(false)}>
              ×
            </button>
          </header>
          <div className="theme-grid">
            {DiagramThemes.map((t) => (
              <button key={t.id} disabled={busy} onClick={() => theme(t.id)}>
                <div
                  className="theme-sample"
                  style={{
                    background: t.colors[0],
                    borderColor: t.colors[1],
                    color: t.colors[2],
                  }}
                >
                  节点 <span>→</span> 节点
                </div>
                <strong>{t.name}</strong>
                <small>{t.description}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
