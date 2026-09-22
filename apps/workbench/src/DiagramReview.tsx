import React, { useEffect, useRef, useState } from "react";
import { Bridge } from "./bridge";
import type { ChangeGroup } from "../../../packages/document-tools/review";
import "./p0.css";
export const changeColor = (kind: string) =>
  ({
    新增: "#15803d",
    删除: "#dc2626",
    文字: "#b77900",
    "位置/尺寸/折点": "#2563eb",
    样式: "#9333ea",
    关系: "#9333ea",
  })[kind] || "#9333ea";
export function DiagramReview({
  bridge,
  baseXml,
  candidateXml,
  groups = [],
  onClose,
  onCompose,
  onVerified,
  busy = false,
  notice = "",
}: {
  bridge: Bridge;
  baseXml: string;
  candidateXml: string;
  groups?: ChangeGroup[];
  onClose: () => void;
  onCompose?: (ids: string[]) => Promise<void>;
  onVerified?: () => void;
  busy?: boolean;
  notice?: string;
}) {
  const frames = [
    useRef<HTMLIFrameElement>(null),
    useRef<HTMLIFrameElement>(null),
  ];
  const peers = useRef<Bridge[]>([]),
    activeSide = useRef(0),
    loaded = useRef([false, false]);
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [selected, setSelected] = useState(groups.map((g) => g.id));
  const close = useRef<HTMLButtonElement>(null);
  const fitBoth = async (links = peers.current) => {
    const bounds = await Promise.all(
      links.map((l) => l.invoke("reviewBounds")),
    );
    const x = Math.min(...bounds.map((b) => b.x)),
      y = Math.min(...bounds.map((b) => b.y)),
      right = Math.max(...bounds.map((b) => b.x + b.width)),
      bottom = Math.max(...bounds.map((b) => b.y + b.height));
    const scale = Math.min(
      1,
      ...bounds.map((b) =>
        Math.min(
          (b.viewport.width - 50) / Math.max(1, right - x),
          (b.viewport.height - 50) / Math.max(1, bottom - y),
        ),
      ),
    );
    await Promise.all(
      links.map((l) =>
        l.invoke("reviewView", {
          scale: Math.max(0.1, scale),
          x: (x + right) / 2,
          y: (y + bottom) / 2,
        }),
      ),
    );
  };
  useEffect(() => {
    close.current?.focus();
  }, []);
  useEffect(() => {
    const links = frames.map((f) => new Bridge(() => f.current, bridge.origin));
    peers.current = links;
    loaded.current = [false, false];
    setReady(false);
    let stopped = false;
    const receive = async (event: MessageEvent) => {
      const i = frames.findIndex(
        (f) => f.current?.contentWindow === event.source,
      );
      if (i < 0) return;
      const data = links[i].receive(event);
      if (!data) return;
      try {
        if (data.event === "ready") {
          await links[i].invoke("reviewSetup");
          await links[i].invoke("load", { xml: i ? candidateXml : baseXml });
          await links[i].invoke("setReadOnly", { value: true });
          const changes = groups
            .flatMap((g) => g.changes)
            .filter((c) => (i ? c.kind !== "删除" : c.kind !== "新增"))
            .map((c) => ({ id: c.id, color: changeColor(c.kind) }));
          await links[i].invoke("reviewHighlight", { changes });
          loaded.current[i] = true;
          if (loaded.current.every(Boolean) && !stopped) {
            await fitBoth(links);
            setReady(true);
            onVerified?.();
          }
        }
        if (
          data.event === "reviewViewport" &&
          i === activeSide.current &&
          loaded.current.every(Boolean)
        )
          await links[1 - i].invoke("reviewView", data);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    window.addEventListener("message", receive);
    return () => {
      stopped = true;
      window.removeEventListener("message", receive);
      links.forEach((l) => l.close());
    };
  }, [baseXml, candidateXml]);
  const zoom = async (action: string) => {
    try {
      if (action === "fit") {
        await fitBoth();
        return;
      }
      await peers.current[0].invoke("zoom", { action });
      await peers.current[1].invoke(
        "reviewView",
        await peers.current[0].invoke("reviewView"),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const focus = async (ids: string[]) => {
    try {
      for (const p of peers.current) await p.invoke("focus", { ids });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div
      className="scrim p0-review-scrim"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <section
        className="p0-review"
        role="dialog"
        aria-modal="true"
        aria-label="可视化改稿审阅"
      >
        <header>
          <div>
            <strong>审阅修改</strong>
            <small>原稿与候选 · 同步缩放和平移 · 画布尚未改变</small>
          </div>
          <button ref={close} onClick={onClose} aria-label="关闭修改审阅">
            ×
          </button>
        </header>
        <nav>
          <button disabled={!ready} onClick={() => void zoom("out")}>
            缩小对比
          </button>
          <button disabled={!ready} onClick={() => void zoom("fit")}>
            适应对比
          </button>
          <button disabled={!ready} onClick={() => void zoom("in")}>
            放大对比
          </button>
          <span>
            绿色：新增　红色：删除　黄色：文字　蓝色：位置　紫色：样式/关系
          </span>
        </nav>
        {(error || notice) && <p role="status">{error || notice}</p>}
        <div className="p0-review-body">
          <div className="p0-canvases">
            {["原稿", "候选"].map((name, i) => (
              <section
                key={name}
                onMouseEnter={() => {
                  activeSide.current = i;
                }}
              >
                <h3>{name}</h3>
                <iframe
                  key={(i ? candidateXml : baseXml).length + ":" + i}
                  title={name + "审阅画布"}
                  ref={frames[i]}
                  src={bridge.frame()?.src}
                />
              </section>
            ))}
          </div>
          <aside>
            <p>{groups.length} 个操作组</p>
            {onCompose && (
              <button
                disabled={busy}
                onClick={() =>
                  setSelected(selected.length ? [] : groups.map((g) => g.id))
                }
              >
                全选 / 全不选
              </button>
            )}
            {groups.map((g) => (
              <article key={g.id}>
                {onCompose && (
                  <input
                    type="checkbox"
                    aria-label={g.label}
                    checked={selected.includes(g.id)}
                    disabled={busy}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked
                          ? [...s, g.id]
                          : s.filter((id) => id !== g.id),
                      )
                    }
                  />
                )}
                <strong>{g.label}</strong>
                {g.changes.map((c, i) => (
                  <p
                    key={i}
                    style={{
                      borderLeft: `3px solid ${changeColor(c.kind)}`,
                      paddingLeft: 6,
                    }}
                  >
                    {c.kind} · {c.label || c.id}
                    {c.kind === "文字" && (
                      <small>
                        {c.before} → {c.after}
                      </small>
                    )}
                  </p>
                ))}
                <button disabled={!ready} onClick={() => void focus(g.ids)}>
                  定位变化
                </button>
              </article>
            ))}
          </aside>
        </div>
        <footer>
          {onCompose && (
            <button
              className="primary"
              disabled={!ready || busy || !selected.length}
              onClick={() =>
                void onCompose(selected).catch((e) => setError(e.message))
              }
            >
              生成所选修改预览
            </button>
          )}
          <button onClick={onClose}>返回画布</button>
        </footer>
      </section>
    </div>
  );
}
