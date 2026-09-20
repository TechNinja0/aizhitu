import React, { useEffect, useState } from "react";
import type { Bridge } from "./bridge";
import {
  addVersion,
  listVersions,
  removeVersion,
  type Version,
} from "./versions";
type Props = {
  bridge: Bridge;
  api: (p: string, b?: unknown) => Promise<Response>;
  documentId?: string;
  name: string;
  ready: boolean;
  onApply: (s: any) => void;
  onError: (e: unknown) => void;
};
export function DocumentTools({
  bridge,
  api,
  documentId,
  name,
  ready,
  onApply,
  onError,
}: Props) {
  const [panel, setPanel] = useState<"search" | "versions" | null>(null),
    [query, setQuery] = useState(""),
    [objects, setObjects] = useState<any[]>([]),
    [versions, setVersions] = useState<Version[]>([]),
    [label, setLabel] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setPanel(null);
    setObjects([]);
    setVersions([]);
    setQuery("");
    setNotice("");
  }, [documentId]);
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
  async function reload() {
    if (documentId) setVersions(await listVersions(documentId));
  }
  async function search() {
    const s = await bridge.invoke("snapshot");
    const d = await (await api("validate", { xml: s.xml })).json();
    setObjects(
      d.cells.filter((c: any) => c.kind === "node" || c.kind === "edge"),
    );
  }
  const matches = objects.filter((c) =>
    `${c.label} ${c.id}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  async function restore(v: Version) {
    const current = await bridge.invoke("snapshot");
    if (current.metadata.documentId !== v.documentId)
      throw Error("图稿已切换，请重新打开版本记录");
    const checked = await (await api("validate", { xml: v.xml })).json();
    if (checked.metadata.documentId !== v.documentId)
      throw Error("版本身份不匹配");
    await addVersion({
      documentId: v.documentId,
      name,
      label: "恢复版本前自动备份",
      xml: current.xml,
    });
    onApply(
      await bridge.invoke("applyCandidate", {
        xml: checked.xml,
        documentId: v.documentId,
        expectedRevision: current.revision,
      }),
    );
    await reload();
    setNotice("已恢复版本，可一步撤销；恢复前画布也已备份。");
  }
  return (
    <>
      <button
        disabled={!ready}
        onClick={() =>
          void run(async () => {
            setPanel("search");
            await search();
          })
        }
      >
        查找对象
      </button>
      <button
        disabled={!ready}
        onClick={() =>
          void run(async () => {
            setPanel("versions");
            await reload();
          })
        }
      >
        版本记录
      </button>
      {panel && (
        <div className="scrim">
          <section
            className="modal document-tools"
            role="dialog"
            aria-modal="true"
            aria-label={panel === "search" ? "查找图稿对象" : "本地版本记录"}
          >
            <div className="modal-heading">
              <h2>{panel === "search" ? "查找图稿对象" : "本地版本记录"}</h2>
              <button disabled={busy} onClick={() => setPanel(null)}>
                关闭
              </button>
            </div>
            {panel === "search" ? (
              <>
                <p>按文字或对象 ID 查找节点和连线，选择结果会定位到画布。</p>
                <div className="ai-row">
                  <input
                    autoFocus
                    aria-label="查找文字或对象 ID"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button disabled={busy} onClick={() => void run(search)}>
                    刷新对象列表
                  </button>
                </div>
                <p>{matches.length} 个匹配对象</p>
                <div className="document-list">
                  {matches.map((c) => (
                    <button
                      key={c.id}
                      onClick={() =>
                        void run(async () => {
                          await bridge.invoke("focus", { ids: [c.id] });
                          setPanel(null);
                        })
                      }
                    >
                      <strong>{c.label || "无文字对象"}</strong>
                      <small>
                        {c.kind === "edge" ? "连线" : "节点"} · {c.id}
                      </small>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p>
                  保存关键节点的版本，跨刷新保留。每份图稿最多 20
                  版；全部版本合计最多 40
                  MiB，超限清理最旧记录。只在本浏览器、当前地址保存，不代替本地文件。
                </p>
                <div className="ai-row">
                  <input
                    aria-label="版本说明"
                    disabled={busy}
                    placeholder="例如：评审前 / 初稿"
                    value={label}
                    maxLength={80}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const s = await bridge.invoke("snapshot");
                        if (s.metadata.documentId !== documentId)
                          throw Error("图稿已切换");
                        await addVersion({
                          documentId: documentId!,
                          name,
                          label: label.trim() || "手动版本",
                          xml: s.xml,
                        });
                        setLabel("");
                        await reload();
                        setNotice("版本已保存");
                      })
                    }
                  >
                    保存当前版本
                  </button>
                </div>
                <div className="document-list">
                  {versions.map((v) => (
                    <article key={v.id}>
                      <strong>{v.label}</strong>
                      <small>
                        {new Date(v.time).toLocaleString()} · {v.name}
                      </small>
                      <div className="ai-row">
                        <button
                          disabled={busy}
                          onClick={() => void run(() => restore(v))}
                        >
                          恢复此版本
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            const url = URL.createObjectURL(
                              new Blob([v.xml], { type: "application/xml" }),
                            );
                            const a = document.createElement("a");
                            a.href = url;
                            a.download =
                              v.name.replace(/\.drawio$/, "") +
                              "-" +
                              v.label.replace(/[\\/:*?"<>|]/g, "_") +
                              ".drawio";
                            a.click();
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          }}
                        >
                          下载此版本
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await removeVersion(v.id);
                              await reload();
                            })
                          }
                        >
                          删除版本
                        </button>
                      </div>
                    </article>
                  ))}
                  {!versions.length && (
                    <p>还没有版本。可手动保存；AI 应用前也会自动保存一版。</p>
                  )}
                </div>
              </>
            )}
            <p role="status">{notice}</p>
          </section>
        </div>
      )}
    </>
  );
}
