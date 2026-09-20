import { CandidatePreview, downloadCandidate } from "./CandidatePreview";
import { addVersion } from "./versions";
import React, { useRef, useState, useEffect } from "react";
import type { Bridge } from "./bridge";
export function CandidateReview({
  bridge,
  api,
  onApply,
  onError,
  disabled,
  documentName,
}: {
  documentName: string;
  bridge: Bridge;
  api: (path: string, body?: unknown) => Promise<Response>;
  onApply: (s: any) => void;
  onError: (e: any) => void;
  disabled: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<string>();
  const [previewVerified, setPreviewVerified] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false),
    [previewError, setPreviewError] = useState("");
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function compare(f: File) {
    setBusy(true);
    try {
      if (f.size > 20 * 1024 * 1024) throw Error("候选超过 20 MiB");
      const current = await bridge.invoke("snapshot");
      const result = await (
        await api("diff", {
          baseXml: current.xml,
          candidateXml: await f.text(),
        })
      ).json();
      if (preview) URL.revokeObjectURL(preview);
      setPreview(undefined);
      setPreviewVerified(false);
      setPreviewError("");
      setCandidate({ ...result, revision: current.revision, name: f.name });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function render(force = false) {
    setPreviewOpen(true);
    setPreviewError("");
    if (preview && !force) return;
    setPreviewVerified(false);
    setBusy(true);
    try {
      const job = await (
        await api("exports", {
          xml: candidate.candidateXml,
          options: { format: "png", scale: 1 },
        })
      ).json();
      for (let i = 0; i < 210; i++) {
        const state = await (await api("jobs/" + job.jobId)).json();
        if (state.status === "failed") throw Error(state.error);
        if (state.status === "succeeded") {
          if (preview) URL.revokeObjectURL(preview);
          setPreview(
            URL.createObjectURL(
              await (await api("jobs/" + job.jobId + "/result")).blob(),
            ),
          );
          return;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      throw Error("预览超时");
    } catch (e) {
      setPreviewError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    setPreviewOpen(false);
    setCandidate(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(undefined);
  }
  return (
    <>
      <button disabled={disabled || busy} onClick={() => file.current?.click()}>
        比较 AI 候选
      </button>
      <input
        hidden
        type="file"
        aria-label="候选图稿文件"
        accept=".drawio,.xml"
        ref={file}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void compare(f);
        }}
      />
      {candidate && (
        <div className="scrim">
          <section
            className="modal candidate-modal"
            role="dialog"
            aria-modal="true"
            aria-label="AI 候选差异"
          >
            <div className="modal-heading">
              <h2>AI 候选差异</h2>
              <button onClick={close} disabled={busy}>
                关闭
              </button>
            </div>
            <p>
              {candidate.name} · {candidate.changes.length} 项变化
            </p>
            {!candidate.sameDocument && (
              <p className="error-text">
                候选属于另一个文档，只能检查，不能应用到当前图稿。
              </p>
            )}
            <div className="candidate-changes">
              {candidate.changes.map((c: any, i: number) => (
                <article key={i}>
                  <strong>
                    {c.kind} · {c.id}
                  </strong>
                  <span>{c.label}</span>
                  {c.kind === "文字" && (
                    <p>
                      {c.before} → {c.after}
                    </p>
                  )}
                  <button
                    onClick={() =>
                      void bridge
                        .invoke("focus", { ids: [c.id] })
                        .catch(onError)
                    }
                  >
                    定位原对象
                  </button>
                </article>
              ))}
              {!candidate.changes.length && <p>没有对象差异。</p>}
            </div>
            {preview && (
              <button
                className="preview-thumbnail"
                onClick={() => setPreviewOpen(true)}
              >
                <img src={preview} alt="外部候选缩略图" />
                <span>点击查看大图</span>
              </button>
            )}
            {previewOpen && (
              <CandidatePreview
                url={preview || ""}
                busy={busy}
                error={previewError}
                alt="AI 候选图稿预览"
                onClose={() => setPreviewOpen(false)}
                onLoaded={() => setPreviewVerified(true)}
                onRetry={() => void render(true)}
              />
            )}
            <div className="modal-actions">
              <button
                onClick={() =>
                  downloadCandidate(candidate.candidateXml, candidate.name)
                }
              >
                下载候选
              </button>
              <button disabled={busy} onClick={() => void render()}>
                预览候选图
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !previewVerified ||
                  !candidate.sameDocument ||
                  !candidate.changes.length
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    const now = await bridge.invoke("snapshot");
                    const fresh = await (
                      await api("diff", {
                        baseXml: now.xml,
                        candidateXml: candidate.candidateXml,
                      })
                    ).json();
                    if (fresh.baseHash !== candidate.baseHash)
                      throw Error(
                        "当前图稿已变化，候选基线过期。请重新选择候选进行比较。",
                      );
                    await addVersion({
                      documentId: now.metadata.documentId,
                      name: documentName,
                      label: "外部候选应用前自动备份",
                      xml: now.xml,
                    });
                    onApply(
                      await bridge.invoke("applyCandidate", {
                        xml: candidate.candidateXml,
                        expectedRevision: now.revision,
                        documentId: candidate.documentId,
                      }),
                    );
                    close();
                  } catch (e) {
                    onError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                应用候选（可一步撤销）
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
