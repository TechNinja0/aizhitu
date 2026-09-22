import React, { useEffect, useRef, useState } from "react";
import type { Bridge } from "./bridge";
import { DiagramReview } from "./DiagramReview";
import { addVersion } from "./versions";
export function QualityPanel({
  bridge,
  api,
  onApply,
  onError,
  disabled,
  documentName,
}: {
  bridge: Bridge;
  api: (path: string, body?: unknown) => Promise<Response>;
  onApply: (s: any) => void;
  onError: (e: any) => void;
  disabled: boolean;
  documentName: string;
}) {
  const [open, setOpen] = useState(false),
    [mode, setMode] = useState("vertical"),
    [scope, setScope] = useState("all"),
    [gap, setGap] = useState(40),
    [layerGap, setLayerGap] = useState(80),
    [fontSize, setFontSize] = useState(14),
    [uniform, setUniform] = useState(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(),
    [review, setReview] = useState(false),
    [verified, setVerified] = useState(false),
    [quality, setQuality] = useState<any>(),
    [notice, setNotice] = useState("");
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setVerified(false);
    setResult(undefined);
  }, [mode, scope, gap, layerGap, fontSize, uniform]);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  const check = async () => {
    setBusy(true);
    try {
      const s = await bridge.invoke("snapshot");
      setQuality(await (await api("quality/check", { xml: s.xml })).json());
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const plan = async () => {
    setBusy(true);
    setVerified(false);
    const version = ++epoch.current;
    try {
      const s = await bridge.invoke("snapshot");
      if (scope === "selection" && !s.selection.length)
        throw Error("请先在画布选择要整理的对象");
      const r = await (
        await api("quality/plan", {
          xml: s.xml,
          options: {
            mode,
            gap,
            layerGap,
            fontSize,
            uniform,
            selection: scope === "selection" ? s.selection : [],
          },
        })
      ).json();
      if (version !== epoch.current) return;
      const groups = await (
        await api("review/groups", {
          baseXml: s.xml,
          candidateXml: r.candidateXml,
        })
      ).json();
      if (version !== epoch.current) return;
      setResult({ ...r, groups: groups.groups, revision: s.revision });
      setQuality(r.quality);
      setNotice(r.warnings.join("；"));
      setReview(true);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    setBusy(true);
    try {
      const s = await bridge.invoke("snapshot"),
        d = await (
          await api("diff", {
            baseXml: s.xml,
            candidateXml: result.candidateXml,
          })
        ).json();
      if (
        s.metadata.documentId !== result.documentId ||
        d.baseHash !== result.baseHash
      )
        throw Error("图稿已变化，请重新生成排版预览");
      await addVersion({
        documentId: result.documentId,
        name: documentName,
        label: "排版应用前备份",
        xml: s.xml,
      });
      onApply(
        await bridge.invoke("applyCandidate", {
          xml: result.candidateXml,
          expectedRevision: s.revision,
          documentId: result.documentId,
        }),
      );
      setResult(undefined);
      setVerified(false);
      setNotice("排版已应用，可一步撤销");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          void check();
        }}
      >
        排版与检查
      </button>
      {open && (
        <div className="scrim">
          <section
            className="p0-panel"
            role="dialog"
            aria-modal="true"
            aria-label="排版与交付检查"
          >
            <header>
              <h2>排版与交付检查</h2>
              <button
                onClick={() => {
                  epoch.current++;
                  setOpen(false);
                }}
              >
                关闭
              </button>
            </header>
            <p className="p0-hint">
              保留文字与连接关系，保护锁定对象。排版前后可对比，应用后可撤销。
            </p>
            <div className="p0-options">
              <label>
                排版方式
                <select
                  aria-label="排版方式"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="appearance">整理外观</option>
                  <option value="vertical">纵向流程</option>
                  <option value="horizontal">横向流程</option>
                  <option value="architecture">分层架构</option>
                </select>
              </label>
              <label>
                修改范围
                <select
                  aria-label="排版范围"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="all">整张图稿</option>
                  <option value="selection">当前选区</option>
                </select>
              </label>
              <label>
                节点间距
                <input
                  type="number"
                  min={16}
                  max={200}
                  value={gap}
                  onChange={(e) => setGap(Number(e.target.value))}
                />
              </label>
              <label>
                层间距
                <input
                  type="number"
                  min={32}
                  max={300}
                  value={layerGap}
                  onChange={(e) => setLayerGap(Number(e.target.value))}
                />
              </label>
              <label>
                字号
                <input
                  type="number"
                  min={12}
                  max={32}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                />
              </label>
              <label>
                <span>
                  <input
                    type="checkbox"
                    checked={uniform}
                    onChange={(e) => setUniform(e.target.checked)}
                  />{" "}
                  统一同层普通节点尺寸
                </span>
              </label>
            </div>
            <div className="ai-row">
              <button disabled={busy || disabled} onClick={() => void plan()}>
                生成排版预览
              </button>
              <button disabled={busy} onClick={() => void check()}>
                重新检查当前图
              </button>
              <button
                className="primary"
                disabled={
                  busy || disabled || !verified || !result?.changes.length
                }
                onClick={() => void apply()}
              >
                应用排版
              </button>
            </div>
            {notice && <p role="status">{notice}</p>}
            {quality && (
              <>
                <h3>{quality.total} 项交付检查提示</h3>
                <p className="p0-hint">
                  {result
                    ? "当前列表为候选检查结果；定位基于原画布。"
                    : "当前图稿检查结果。"}
                  文字和穿线检查为估计，请结合预览核对。
                </p>
                <div className="p0-issues">
                  {quality.issues.map((q: any, i: number) => (
                    <article key={i}>
                      <strong>{q.kind}</strong>
                      <p>{q.message}</p>
                      <button
                        onClick={() => {
                          setOpen(false);
                          void bridge
                            .invoke("focus", { ids: q.ids })
                            .catch(onError);
                        }}
                      >
                        定位对象
                      </button>
                    </article>
                  ))}
                </div>
                {quality.truncated && (
                  <p>仅显示前 200 项，请修复后重新检查。</p>
                )}
              </>
            )}
          </section>
        </div>
      )}
      {review && result && (
        <DiagramReview
          bridge={bridge}
          baseXml={result.baseXml}
          candidateXml={result.candidateXml}
          groups={result.groups}
          onVerified={() => setVerified(true)}
          onClose={() => setReview(false)}
        />
      )}
    </>
  );
}
