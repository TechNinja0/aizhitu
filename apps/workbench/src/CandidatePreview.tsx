import React, { useEffect, useRef, useState } from "react";
export function downloadCandidate(xml: string, name = "AI候选.drawio") {
  const url = URL.createObjectURL(
    new Blob([xml], { type: "application/xml;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export function CandidatePreview({
  url,
  busy,
  error,
  alt,
  onClose,
  onRetry,
  onApply,
  onLoaded,
}: {
  url: string;
  busy: boolean;
  error: string;
  alt: string;
  onClose: () => void;
  onRetry: () => void;
  onApply?: () => void;
  onLoaded?: () => void;
}) {
  const [width, setWidth] = useState(0),
    [loaded,setLoaded]=useState(false),
    [fit, setFit] = useState(true),
    [failed, setFailed] = useState(false);
  useEffect(() => {setFailed(false);setLoaded(false);}, [url]);
  const imageRef=useRef<HTMLImageElement>(null);
  const zoom=(factor:number)=>{setWidth(Math.min(16000,Math.max(80,(imageRef.current?.getBoundingClientRect().width || 600)*factor)));setFit(false);};
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    close.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="scrim candidate-preview-scrim"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
        if (e.key === "Tab") {
          const buttons = Array.from(
            e.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          );
          const first = buttons[0],
            last = buttons.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <section
        className="preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="候选大图预览"
      >
        <header>
          <div>
            <strong>候选预览</strong>
            <small>画布尚未改变 · 核对后再应用</small>
          </div>
          <button ref={close} onClick={onClose} aria-label="关闭候选预览">
            ×
          </button>
        </header>
        <div className="preview-image-area" aria-busy={busy}>
          {busy ? (
            <p role="status">正在渲染预览，请稍候…</p>
          ) : error || failed ? (
            <div role="alert">
              <p>{error || "图片加载失败，请重新预览或下载候选"}</p>
              <button
                onClick={() => {
                  setFailed(false);
                  onRetry();
                }}
              >
                重新预览
              </button>
            </div>
          ) : (
            url && (
              <img
                ref={imageRef}
                src={url}
                alt={alt}
                className={fit ? "fit" : ""}
                style={
                  fit
                    ? undefined
                    : {
                        width: `${width}px`,
                        maxWidth: "none",
                        maxHeight: "none",
                      }
                }
                onLoad={()=>{setLoaded(true);onLoaded?.();}}
                onError={() => setFailed(true)}
              />
            )
          )}
        </div>
        <footer>
          <button
            disabled={!url || busy}
            onClick={() => {
              zoom(1/1.25);
            }}
          >
            缩小预览
          </button>
          <button
            disabled={!url || busy}
            onClick={() => {
              setFit(true);
              setWidth(0);
            }}
          >
            适应预览
          </button>
          <button
            disabled={!url || busy}
            onClick={() => {
              zoom(1.25);
            }}
          >
            放大预览
          </button>
          <span />
          {onApply && (
            <button
              disabled={!url || !loaded || busy || !!error || failed}
              className="primary"
              onClick={onApply}
            >
              应用此候选
            </button>
          )}
          <button onClick={onClose}>返回画布</button>
        </footer>
      </section>
    </div>
  );
}
