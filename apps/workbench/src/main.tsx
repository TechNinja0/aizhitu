import { startNewDocument, useNewDocument } from "./NewDocument";
import { SharedRoot, useSharedDocument, workspaceContext, workspaceHeaders, workspaceApi, documentId } from "./SharedWorkspace";
import { uuid, copyText } from "./uuid";
import { StyleTools } from "./StyleTools";
import {DocumentTools} from "./DocumentTools";
import {AIChat} from "./AIChat";
import {CandidateReview} from "./CandidateReview";
import { TemplatePicker } from "./TemplatePicker";
import { resolveTemplateXml, type TemplateChoice } from "./template-library";
import { SaveTemplate } from "./SaveTemplate";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bridge } from "./bridge";
import { allDrafts, storeDraft, deleteDraft, type Draft } from "./drafts";
import type {
  Metadata,
  Validation,
} from "../../../packages/document-core/types";
import "./styles.css";
declare global {
  interface Window {
    __BOOT__: { token: string; shared?: boolean; publicOrigin?: string; leaseMs?: number; editorUrl: string; editorOrigin: string };
  }
}
const boot = window.__BOOT__;
delete (window as any).__BOOT__;
async function api(path: string, body?: unknown, method?: string) {
  const r = await fetch("/api/" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      ...workspaceHeaders(),
      Authorization: `Bearer ${workspaceContext.token || boot.token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let e;
    try {
      e = await r.json();
    } catch {}
    throw Error(
      e?.errors
        ?.map((x: any) => `${x.objectId ? x.objectId + "：" : ""}${x.message}`)
        .join("\n") ||
        e?.error ||
        `请求失败 (${r.status})`,
    );
  }
  return r;
}
const iconPaths: Record<string, React.ReactNode> = {
  open: (
    <>
      <path d="M3 7h6l2 2h10l-3 10H3z" />
      <path d="M3 7V4h7l2 3h7v2" />
    </>
  ),
  save: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5" />
      <path d="M4 16v5h16v-5" />
    </>
  ),
  add: <path d="M12 5v14M5 12h14" />,
  undo: (
    <>
      <path d="m9 5-5 5 5 5" />
      <path d="M4 10h10a6 6 0 0 1 6 6v3" />
    </>
  ),
  redo: (
    <>
      <path d="m15 5 5 5-5 5" />
      <path d="M20 10h-10a6 6 0 0 0-6 6v3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1" />
      <path d="m3 17 6-6 4 4 3-3 5 5" />
    </>
  ),
  check: <path d="m5 12 4 4 10-10" />,
  export: (
    <>
      <path d="M12 15V3m-5 5 5-5 5 5" />
      <path d="M4 13v8h16v-8" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  book: (
    <>
      <path d="M12 5v16M3 3l9 2 9-2v16l-9 2-9-2z" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
};
function Icon({ name }: { name: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    ref.current?.focus();
    return () => prior?.focus();
  }, []);
  return (
    <div className="scrim" onClick={onClose}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Tab") {
            const nodes = ref.current?.querySelectorAll<HTMLElement>(
              "button,input,select,a[href]",
            );
            if (nodes?.length) {
              const first = nodes[0],
                last = nodes[nodes.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
          }
        }}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function App() {
  const directFile = useRef<{handle:any;lastContent?:string}|null>(null);
  const writing = useRef(false);
  const frame = useRef<HTMLIFrameElement>(null),
    file = useRef<HTMLInputElement>(null),
    sourceInput = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null);
  const bridge = useRef(
    new Bridge(() => frame.current, boot.editorOrigin),
  ).current;
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasInsets, setCanvasInsets] = useState<{right:number;bottom:number;sidebar?:{left:number;width:number;bottom:number}}>();
  const [ready, setReady] = useState(false),
    [name, setName] = useState("订单服务架构.drawio"),
    [dirty, setDirty] = useState(false),
    [status, setStatus] = useState("正在加载本地内核…"),
    [meta, setMeta] = useState<Metadata>(),
    [selection, setSelection] = useState<string[]>([]),
    [counts, setCounts] = useState({ nodes: 0, edges: 0 });
  const [panel, setPanel] = useState<"review" | "help" | null>(null),
    [exportOpen, setExportOpen] = useState(false),
    [format, setFormat] = useState("png"),
    [scale, setScale] = useState(2),
    [margin, setMargin] = useState(20),
    [transparent, setTransparent] = useState(false),
    [embed, setEmbed] = useState(false),
    [scope, setScope] = useState("all"),
    [job, setJob] = useState<string | null>(null),
    [jobStatus, setJobStatus] = useState("");
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [draftOpen, setDraftOpen] = useState(false),
    [pending, setPending] = useState(false),
    [source, setSource] = useState<{
      url: string;
      width: number;
      height: number;
      sha256: string;
    }>(),
    [activeReview, setActiveReview] = useState<string>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [fillTemplateOpen, setFillTemplateOpen] = useState(false);
  const [aiOpen,setAiOpen] = useState(false), [aiSettings,setAiSettings]=useState(false);
  const [canUndo, setCanUndo] = useState(false),
    [canRedo, setCanRedo] = useState(false);
  const state = useRef({
    name,
    dirty,
    xml: "",
    revision: 0,
    metadata: undefined as Metadata | undefined,
  });
  state.current.name = name;
  state.current.dirty = dirty;
  const loadEpoch = useRef(0);
  const savedRevision = useRef(0),
    session = useRef(uuid()),
    pendingAction = useRef<(() => Promise<void>) | null>(null),
    initialised = useRef(false);
  const showError = (e: unknown) => setError((e as Error).message || String(e));
  const shared = useSharedDocument({ bridge, ready, state, savedRevision, load: (xml, name) => load(xml, name, true), setDirty, setName, onError: showError });
  const pendingDocument = useNewDocument({ bridge, state, load: (xml, title) => load(xml, title, true), setDirty });
  const editable = ready && !pendingDocument.frozen && (!shared.id || shared.editing);
  function applySnapshot(s: any) {
    if(s.zoom) setCanvasZoom(s.zoom);
    state.current.xml = s.xml;
    state.current.revision = s.revision;
    state.current.metadata = s.metadata;
    setMeta(s.metadata);
    setSelection(s.selection || []);
    if (s.counts) setCounts(s.counts);
    setCanUndo(!!s.canUndo);
    setCanRedo(!!s.canRedo);
  }
  async function load(xml: string, newName: string, internal = false) {
    if (boot.shared && (shared.id || pendingDocument.active) && !internal) {
      startNewDocument(newName, xml); return;
    }
    loadEpoch.current++;
    directFile.current = null;
    const d: Validation = await (await api("validate", { xml })).json();
    const snapshot = await bridge.invoke("load", { xml: d.xml });
    applySnapshot(snapshot);
    savedRevision.current = snapshot.revision;
    setDirty(false);
    state.current.dirty = false;
    state.current.name = newName;
    setName(newName);
    setStatus(
      d.warnings.length ? "已打开 · 字体已按本地配置替换" : "文件已打开",
    );
    setSource((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return undefined;
    });
    setActiveReview(undefined);
    if (d.metadata?.reviewItems.length) setPanel("review");
  }
  async function openExample(id: string) {
    const d = await (await api("examples/" + id)).json();
    await load(
      d.xml,
      {
        flow: "申请审批流程.drawio",
        architecture: "订单服务架构.drawio",
        review: "待核对的架构图.drawio",
      }[id] || "示例.drawio",
    );
    setStatus("本地示例 · 编辑后保存为自己的图稿");
  }
  async function guard(action: () => Promise<void>) {
    if (state.current.dirty) {
      pendingAction.current = action;
      setPending(true);
    } else
      try {
        await action();
      } catch (e) {
        showError(e);
      }
  }
  async function createFromTemplate(template: TemplateChoice | null, title: string) {
    // Browsing is non-destructive; ask about unsaved edits only after choosing Create.
    setTemplateOpen(false);
    await guard(async () => {
      const fileName = /\.drawio$/i.test(title) ? title : title + ".drawio";
      await load(await resolveTemplateXml(template, title), fileName);
      if (shared.id || pendingDocument.active) return;
      if (template) {
        savedRevision.current = -1;
        state.current.dirty = true;
        setDirty(true);
        await storeDraft({ key: state.current.metadata!.documentId + ":" + session.current,
          documentId: state.current.metadata!.documentId, session: session.current,
          name: fileName, xml: state.current.xml, revision: state.current.revision, time: Date.now() });
      }
      setStatus(template ? `已从「${template.name}」创建 · 请保存图稿` : "空白画布已创建");
    });
  }
  async function fillFromTemplate(template: TemplateChoice | null) {
    if (!template) return;
    if (shared.id && !shared.editing) await shared.acquire();
    // Acquiring a shared lease reloads the latest server state; recheck emptiness afterward.
    const current = await bridge.invoke("snapshot");
    if (current.counts.nodes || current.counts.edges) throw Error("当前画布已有内容，未应用模板。请关闭浮窗后检查图稿。");
    const checked = await (await api("validate", { xml: await resolveTemplateXml(template, state.current.name, current.metadata) })).json();
    if (pendingDocument.active && !pendingDocument.isDirty(current)) {
      await pendingDocument.replaceSeed(checked.xml, state.current.name);
      setFillTemplateOpen(false);
      setToast(`已选择「${template.name}」，修改后自动保存`);
      return;
    }
    const result = await bridge.invoke("applyCandidate", {
      xml: checked.xml, expectedRevision: current.revision, documentId: current.metadata.documentId,
    });
    applySnapshot(result);
    state.current.dirty = true;
    setDirty(true);
    setFillTemplateOpen(false);
    await bridge.invoke("zoom", { action: "fit" });
    setToast(`已应用「${template.name}」，可一步撤销`);
  }
  async function save() {
    const epoch=loadEpoch.current, filename=state.current.name;
    const s = await bridge.invoke("snapshot");
    if(epoch!==loadEpoch.current)throw Error("图稿已切换，请重新保存当前图稿");
    const d = await (await api("validate", { xml: s.xml })).json();
    download(
      new Blob([d.xml], { type: "application/xml" }),
      filename.endsWith(".drawio")
        ? filename
        : filename + ".drawio",
    );
    if(epoch!==loadEpoch.current)return false;
    if (shared.id || pendingDocument.active) { setToast("已下载副本；服务器保存状态不变"); const now = await bridge.invoke("snapshot"); return now.revision === s.revision && state.current.name === filename && epoch === loadEpoch.current; }
    savedRevision.current = s.revision;
    const current = await bridge.invoke("snapshot");
    if(epoch!==loadEpoch.current)return false;
    applySnapshot(current);
    setDirty(current.revision !== s.revision);
    setStatus(
      current.revision === s.revision
        ? "已生成下载副本"
        : "已生成副本 · 仍有新的未保存修改",
    );
    setToast("已生成 .drawio 下载副本；请确认浏览器中的保存位置。");
    return current.revision === s.revision;
  }
  async function saveDirect() {
    if(writing.current)return;
    if(!(window as any).showSaveFilePicker){setToast("当前浏览器不支持直接写回，已生成下载副本");await save();return;}
    writing.current=true;
    const epoch=loadEpoch.current,docId=state.current.metadata?.documentId;
    const unchanged=()=>epoch===loadEpoch.current&&docId===state.current.metadata?.documentId;
    const check=()=>{if(!unchanged())throw Error('保存期间已切换图稿，本次写入已取消');};
    try{
      let target=directFile.current;
      if(!target){const handle=await (window as any).showSaveFilePicker({suggestedName:state.current.name,types:[{description:"可编辑图稿",accept:{"application/xml":[".drawio"]}}]});target={handle};}
      check();const snap=await bridge.invoke("snapshot");check();
      const checked=await(await api("validate",{xml:snap.xml})).json();check();
      if(target.lastContent!==undefined && await (await target.handle.getFile()).text()!==target.lastContent) {if(unchanged())directFile.current=null;throw Error("磁盘文件已被其他程序修改，未覆盖。请重新打开文件或另选保存位置。");}
      check();const stream=await target.handle.createWritable();
      try{check();await stream.write(checked.xml);check();await stream.close();}catch(error){await stream.abort().catch(()=>{});throw error;}
      if(!unchanged())return;
      target.lastContent=checked.xml;directFile.current=target;
      if (shared.id || pendingDocument.active) { setToast(`已写入本地文件 ${target.handle.name}；服务器保存状态不变`); return; }
      savedRevision.current=snap.revision;
      const current=await bridge.invoke("snapshot");if(!unchanged())return;
      applySnapshot(current);setDirty(current.revision!==snap.revision);
      setStatus(current.revision===snap.revision ? `已保存到 ${target.handle.name}` : "已保存文件 · 仍有新的未保存修改");
      setToast(`已写入 ${target.handle.name}`);
    }catch(error){if((error as any).name!=="AbortError")showError(error);}finally{writing.current=false;}
  }
  async function action(name: string) {
    try {
      applySnapshot(await bridge.invoke("action", { name }));
    } catch (e) {
      showError(e);
    }
  }
  useEffect(() => {
    const listener = async (e: MessageEvent) => {
      const d = bridge.receive(e);
      if (!d) return;
      if (d.event === "viewport") setCanvasZoom(d.scale);
      try {
        if (d.event === "ready" && !initialised.current) {
          initialised.current = true;
          setReady(true);
          if (documentId()) { await bridge.invoke("setReadOnly", { value: true }); return; }
          if (pendingDocument.active) { await pendingDocument.initialize(); return; }
          await openExample("architecture");
          const list = await allDrafts();
          setDrafts(list);
          if (list.length) setDraftOpen(true);
        }
        if (d.event === "editing") { state.current.dirty = true; setDirty(true); }
        if (d.event === "changed") {
          applySnapshot(d);
          const changed = documentId() ? shared.isDirty(d) : pendingDocument.active ? pendingDocument.isDirty(d) : d.revision !== savedRevision.current;
          state.current.dirty = changed;
          setDirty(changed);
          if (changed && d.metadata?.documentId) {
            try {
              await storeDraft({
                key: d.metadata.documentId + ":" + session.current,
                documentId: d.metadata.documentId,
                session: session.current,
                name: state.current.name,
                xml: d.xml,
                revision: d.revision,
                time: Date.now(),
              });
              setStatus("有未保存修改 · 恢复草稿已更新");
            } catch {
              setStatus("有未保存修改 · 草稿写入失败，请下载副本");
            }
          }
        }
        if (d.event === "viewportBounds") setCanvasInsets({right:d.right,bottom:d.bottom,sidebar:d.sidebar});
        if (d.event === "selection") setSelection(d.ids);
        if (d.event === "deleteRequested") setDeleteOpen(true);
        if (d.event === "saveRequested") { if (documentId()) await shared.save(); else if (pendingDocument.active) await pendingDocument.save(true); else await save(); }
      } catch (err) {
        showError(err);
      }
    };
    window.addEventListener("message", listener);
    const unload = (e: BeforeUnloadEvent) => {
      if (state.current.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    const timeout = setTimeout(() => {
      if (!initialised.current)
        setError("本地画布加载超时。请检查服务终端或刷新。");
    }, 30000);
    return () => {
      window.removeEventListener("message", listener);
      window.removeEventListener("beforeunload", unload);
      clearTimeout(timeout);
      bridge.close();
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.code !== "Space" || event.isComposing || !frame.current?.matches(":hover") ||
          target?.closest("input, textarea, select, [role=textbox], [role=dialog]") || target?.isContentEditable) return;
      event.preventDefault();
      void bridge.invoke("panMode", { active: true }).catch(() => {});
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") void bridge.invoke("panMode", { active: false }).catch(() => {});
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [ready]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!job) return;
    let stop = false;
    const poll = async () => {
      try {
        const j = await (await api("jobs/" + job)).json();
        if (stop) return;
        setJobStatus(j.status === "queued" ? "正在排队…" : "正在本地渲染…");
        if (j.status === "succeeded") {
          const r = await api("jobs/" + job + "/result");
          download(
            await r.blob(),
            name.replace(/\.drawio$/, "") + "." + format,
          );
          setToast(
            `${format.toUpperCase()} 已生成 · ${Math.round(j.width)} × ${Math.round(j.height)}`,
          );
          setJob(null);
          setExportOpen(false);
          return;
        }
        if (j.status === "failed" || j.status === "cancelled") {
          setJob(null);
          if (j.error) throw Error(j.error);
          return;
        }
        setTimeout(poll, 300);
      } catch (e) {
        if (!stop) {
          setJob(null);
          showError(e);
        }
      }
    };
    void poll();
    return () => {
      stop = true;
    };
  }, [job]);
  async function exportFile() {
    try {
      if (scope === "selection" && selection.length === 0)
        throw Error("请先选择需要导出的对象");
      const s = await bridge.invoke("snapshot");
      const data = await (
        await api("exports", {
          xml: s.xml,
          options: {
            format,
            embedSource: embed && format!=="pdf" && scope==="all",
            scale,
            margin,
            background: transparent ? "transparent" : "#ffffff",
            selection:
              scope === "selection" && format !== "pdf" ? s.selection : [],
          },
        })
      ).json();
      setJob(data.jobId);
      setJobStatus("正在排队…");
    } catch (e) {
      showError(e);
    }
  }
  async function pickImage(f: File, asSource: boolean) {
    if (f.size > 12 * 1024 * 1024) throw Error("图片文件超过 12 MiB");
    if (!["image/png", "image/jpeg"].includes(f.type))
      throw Error("只支持 PNG/JPEG");
    const bitmap = await createImageBitmap(f);
    const { width, height } = bitmap;
    bitmap.close();
    if (width * height > 16_000_000) throw Error("图片超过 1,600 万像素");
    if (asSource) {
      const bytes = await f.arrayBuffer();
      const sha256 = crypto.subtle ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(b => b.toString(16).padStart(2, "0")).join("") : (await (await api("hash", { data: await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(f); }) })).json()).sha256;
      setSource((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { url: URL.createObjectURL(f), width, height, sha256 };
      });
      setPanel("review");
    } else {
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(f);
      });
      applySnapshot(await bridge.invoke("image", { data, width, height }));
    }
  }
  const items = meta?.reviewItems || [],
    remaining = items.filter((i) => i.status === "needsReview").length,
    active = items.find((i) => i.id === activeReview),
    sourceMismatch = !!(
      source &&
      meta?.source &&
      source.sha256 !== meta.source.sha256
    );
  if (pendingDocument.missing) return <main className="shared-empty"><h1>未找到临时图稿</h1><p>新图稿尚未保存到服务器，请从原标签页继续，或返回文件库重新新建。</p><a href="/">返回文件库</a></main>;
  if (shared.denied) return <main className="shared-empty"><h1>无法访问此图稿</h1>
    <p>文件不存在、已删除或你尚未获得访问权限。请联系创建者设置分享权限。</p>
    <a href="/">返回文件库</a></main>;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">图</span>
          <span>
            AI智图<span className="brand-sub">AI 辅助制图工作台</span>
          </span>
        </div>
        <div className="file-heading">
          <input
            disabled={pendingDocument.frozen || (!!shared.id && !shared.editing)}
            aria-label="图稿文件名"
            value={name}
            onChange={(e) => { setName(e.target.value); if (shared.id || pendingDocument.active) { state.current.name = e.target.value; state.current.dirty = true; setDirty(true); } }}
            maxLength={120}
          />
          <span className={"save-state " + (dirty ? "unsaved" : "")}>
            <i />
            {dirty ? "尚未保存" : shared.id ? "服务器图稿" : pendingDocument.active ? "尚未创建文件" : "本地图稿"}
          </span>
        </div>
        <div className="header-right">
          <button className={aiOpen ? "active" : ""} onClick={()=>{setAiOpen(!aiOpen);setPanel(null);}}>AI 会话</button>
          {(!boot.shared || workspaceContext.actor?.admin) && <button onClick={()=>setAiSettings(true)}>设置</button>}
          <span className="local-badge">
            <i />
            {boot.shared ? "共享工作区" : "本地运行"}
          </span>
          <button
            className="quiet"
            onClick={() => {setPanel(panel === "help" ? null : "help");setAiOpen(false);}}
          >
            <Icon name="book" />
            AI 使用指南
          </button>
          <button
            className="primary"
            disabled={!ready}
            onClick={() => setExportOpen(true)}
          >
            <Icon name="export" />
            导出
          </button>
        </div>
      </header>
      {shared.panel}
      {pendingDocument.panel}
      {pendingDocument.overlay}
      {boot.shared && !shared.id && !pendingDocument.active && <div className="shared-document-bar"><a href="/">← 文件库</a><span>本地临时画布 · 主动保存后进入文件库，默认仅自己可见</span><button disabled={!ready} onClick={async () => { try { const snapshot = await bridge.invoke("snapshot"); const d = await workspaceApi("documents", { name, xml: snapshot.xml }); sessionStorage.setItem(`zhitu-edit:${d.id}`, "1"); location.assign("/documents/" + d.id); } catch (e) { showError(e); } }}>保存到文件库</button></div>}
      <nav className="commandbar" aria-label="文件与画布操作">
        <div className="command-group">
          <button
            disabled={!ready}
            onClick={() => setTemplateOpen(true)}
          >
            <Icon name="add" />
            新建
          </button>
          <button disabled={!ready} onClick={() => file.current?.click()}>
            <Icon name="open" />
            打开
          </button>
          <button
            disabled={!ready}
            title="下载当前图稿为 .drawio 文件，不会在文件库新建文件"
            onClick={() => void save().catch(showError)}
          >
            <Icon name="save" />
            下载副本
          </button>
          <button disabled={!ready} title="授权保存到本地文件，后续可直接写回；检测磁盘修改冲突" onClick={()=>void saveDirect()}>保存到文件</button>
          <button disabled={!ready || counts.nodes === 0} onClick={() => setSaveTemplateOpen(true)}>保存为模板</button>
        </div>
        <span className="divider" />
        <div className="command-group">
          <button
            className="icon-button"
            aria-label="撤销"
            disabled={!editable || !canUndo}
            onClick={() => void action("undo")}
          >
            <Icon name="undo" />
          </button>
          <button
            className="icon-button"
            aria-label="重做"
            disabled={!editable || !canRedo}
            onClick={() => void action("redo")}
          >
            <Icon name="redo" />
          </button>
        </div>
        <span className="divider" />
          <DocumentTools bridge={bridge} api={api} documentId={meta?.documentId} name={name} ready={editable} onApply={applySnapshot} onError={showError}/>
          <CandidateReview documentName={name} bridge={bridge} api={api} onApply={applySnapshot} onError={showError} disabled={!editable}/>
          <button disabled={!editable} title="当前仅整理连线：消除可安全拉直的多余折点，不移动节点或重排整图；有选区时只处理选区，可一步撤销" onClick={async()=>{
            try {const result=await bridge.invoke("beautify");applySnapshot(result);setToast(result.beautified ? `已优化 ${result.beautified} 条连线，可一步撤销` : "没有可安全拉直的连线，已保留原布局");}catch(error){showError(error);}
          }}>✦ 一键美化</button>
        <button disabled={!editable} onClick={() => imageInput.current?.click()}>
          <Icon name="image" />
          插入图片
        </button>
        <div className="spacer" />
        <button title="选择原始截图，与重绘的图稿并排对照检查" onClick={() => sourceInput.current?.click()}>
          <Icon name="image" />
          原图对照
        </button>
        <button
          className={panel === "review" ? "active" : ""}
          title="检查并确认 AI 标注的识别疑点，数字表示待核对项数"
          onClick={() => {setPanel(panel === "review" ? null : "review");setAiOpen(false);}}
        >
          <Icon name="check" />
          识别核对 <span className="count">{remaining}</span>
        </button>
      </nav>
      <StyleTools bridge={bridge} ready={editable} selection={selection} onApply={applySnapshot} onError={showError} onNotice={setToast}/>
      <main className="workspace">
        <section className="canvas-shell" aria-label="绘图画布">
          <iframe title="结构化图形编辑器" ref={frame} src={boot.editorUrl} />
          {ready && meta && counts.nodes === 0 && counts.edges === 0 && canvasInsets?.sidebar && canvasInsets.sidebar.width > 80 && (
            <div className="empty-canvas-templates" style={{left:canvasInsets.sidebar.left,width:canvasInsets.sidebar.width,bottom:canvasInsets.sidebar.bottom}}>
              <button onClick={() => setFillTemplateOpen(true)}><span aria-hidden="true">▦</span>选择模板<span aria-hidden="true">↗</span></button>
            </div>
          )}
          {ready && canvasInsets && (
            <div className="canvas-zoom" role="group" aria-label="画布缩放" style={{right:canvasInsets.right+16,bottom:canvasInsets.bottom+16}}>
              {([['out','缩小画布','−'],['reset','恢复 100% 缩放',`${Math.round(canvasZoom*100)}%`],['in','放大画布','+'],['fit','适应画布','适应']] as const).map(([action,label,text]) => <button key={action} aria-label={label} title={label} disabled={!ready} onClick={()=>void bridge.invoke("zoom",{action}).then(r=>setCanvasZoom(r.scale)).catch(showError)}>{text}</button>)}
            </div>
          )}
          {!ready && (
            <div className="loading">
              <span className="spinner" />
              正在打开本地画布
            </div>
          )}
        </section>
        <AIChat bridge={bridge} api={api} onApply={applySnapshot} onError={showError} ready={editable} open={aiOpen} onClose={()=>setAiOpen(false)} settingsOpen={aiSettings} onSettings={(open) => { if (!boot.shared || workspaceContext.actor?.admin) setAiSettings(open); else setToast("AI 客户端由工作区管理员统一配置"); }} documentId={meta?.documentId} documentName={name}/>
        {panel && (
          <aside className="sidepanel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">
                  {panel === "review" ? "REVIEW" : "AI WORKFLOW"}
                </span>
                <h2>
                  {panel === "review"
                    ? "把细节核对清楚"
                    : "从截图，到可编辑图稿"}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="关闭侧栏"
                onClick={() => setPanel(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            {panel === "review" ? (
              <>
                <div className="review-summary">
                  <strong>{remaining}</strong>
                  <span>
                    处待核对<small>{items.length - remaining} 处已确认</small>
                  </span>
                  <span className="review-ring">
                    <Icon name="check" />
                  </span>
                </div>
                <div className="source-title">
                  <h3>原始截图</h3>
                  <button
                    className="text-button"
                    onClick={() => sourceInput.current?.click()}
                  >
                    {source ? "更换" : "选择原图"}
                  </button>
                </div>
                {source ? (
                  <>
                    <div className="source-preview">
                      <img alt="用于人工核对的原始截图" src={source.url} />
                      {active?.sourceRect && !sourceMismatch && (
                        <div
                          className="source-region"
                          style={{
                            left:
                              (active.sourceRect.x / source.width) * 100 + "%",
                            top:
                              (active.sourceRect.y / source.height) * 100 + "%",
                            width:
                              (active.sourceRect.width / source.width) * 100 +
                              "%",
                            height:
                              (active.sourceRect.height / source.height) * 100 +
                              "%",
                          }}
                        />
                      )}
                    </div>
                    {sourceMismatch && (
                      <p className="warning">
                        这张图片与记录的原图摘要不同，区域定位已停用。
                      </p>
                    )}
                  </>
                ) : (
                  <button
                    className="source-empty"
                    onClick={() => sourceInput.current?.click()}
                  >
                    <Icon name="image" />
                    <span>选择截图，并排核对</span>
                    <small>原图不会随源文件和导出传播</small>
                  </button>
                )}
                <div className="review-list">
                  {items.length === 0 ? (
                    <div className="empty">
                      <span>✓</span>
                      <h3>没有待核对项</h3>
                      <p>
                        AI 在识别不清楚时会留下标记。
                        <br />
                        也可以选择原图自行检查。
                      </p>
                      <button
                        className="text-button"
                        onClick={() => void guard(() => openExample("review"))}
                      >
                        体验核对示例 →
                      </button>
                    </div>
                  ) : (
                    items.map((item) => (
                      <article
                        className={
                          "review-item " +
                          (activeReview === item.id ? "selected" : "")
                        }
                        key={item.id}
                      >
                        <button
                          className="review-location"
                          onClick={() => {
                            setActiveReview(item.id);
                            if (item.objectId)
                              void bridge
                                .invoke("focus", { ids: [item.objectId] })
                                .catch(showError);
                          }}
                        >
                          <span className={"status-dot " + item.status} />
                          <span>
                            {item.kind === "text"
                              ? "文字识别"
                              : item.kind === "relationship"
                                ? "连接关系"
                                : item.kind === "shape"
                                  ? "图形识别"
                                  : "截图区域"}
                          </span>
                          <small>{item.objectId || "区域"}</small>
                        </button>
                        <p>{item.message}</p>
                        <button
                          className={
                            "review-confirm " +
                            (item.status === "confirmed" ? "confirmed" : "")
                          }
                          onClick={() =>
                            void bridge
                              .invoke("review", {
                                id: item.id,
                                status:
                                  item.status === "confirmed"
                                    ? "needsReview"
                                    : "confirmed",
                              })
                              .then(applySnapshot)
                              .catch(showError)
                          }
                        >
                          <Icon name="check" />
                          {item.status === "confirmed"
                            ? "已核对 · 撤回确认"
                            : "标记为已核对"}
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="guide">
                <p className="guide-intro">
                  在你熟悉的 AI 工具里生成，在这里继续修改。
                </p>
                {[
                  [
                    "01",
                    "提供截图",
                    "在 Codex 或 Qoder 中启用 diagram-drawing Skill，附上流程图或架构图。",
                  ],
                  [
                    "02",
                    "生成与校验",
                    "默认忠实还原，也可要求重新排版。AI 使用本地工具校验文件并渲染预览。",
                  ],
                  [
                    "03",
                    "在这里编辑",
                    "打开 .drawio 文件，核对识别疑点、调整节点与连线，再下载副本。",
                  ],
                ].map(([n, t, d]) => (
                  <div className="guide-step" key={n}>
                    <span>{n}</span>
                    <div>
                      <h3>{t}</h3>
                      <p>{d}</p>
                    </div>
                  </div>
                ))}
                <div className="prompt-card">
                  <span className="eyebrow">试试这样说</span>
                  <p>
                    使用 diagram-drawing
                    Skill，把这张架构图按原布局转成可编辑文件。看不清的内容标记待核对，校验后交付
                    .drawio 和预览图。
                  </p>
                  <button
                    className="text-button"
                    onClick={() =>
                      void copyText(
                          "使用 diagram-drawing Skill，把这张架构图按原布局转成可编辑文件。看不清的内容标记待核对，校验后交付 .drawio 和预览图。",
                        )
                        .then(() => setToast("提示词已复制"))
                        .catch(showError)
                    }
                  >
                    复制提示词
                  </button>
                </div>
                <a
                  className="help-link"
                  href="/help/INSTALL.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  查看 Skill 安装与自检说明 ↗
                </a>
                <p className="fine-print">
                  先保存最新文件再交给 AI 改稿。AI
                  通过文件交换，首版不会自动读取当前画布。编辑器不额外调用模型
                  API。
                </p>
              </div>
            )}
          </aside>
        )}
      </main>
      <footer className="statusbar">
        <span className="status-indicator" />
        {status}
        <div className="spacer" />
        <span>
          {counts.nodes} 个节点 · {counts.edges} 条连线
        </span>
        <span className="footer-separator">/</span>
        <span>
          {selection.length
            ? `已选择 ${selection.length} 个对象`
            : "单画布 · .drawio"}
        </span>
        <button
          onClick={() =>
            void allDrafts()
              .then((d) => {
                setDrafts(d);
                setDraftOpen(true);
              })
              .catch(showError)
          }
        >
          恢复草稿
        </button>
      </footer>
      <input
        hidden
        ref={file}
        aria-label="打开图稿文件"
        type="file"
        accept=".drawio,.xml,.png,.svg"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f)
            void guard(async () => {
              if (f.size > 20 * 1024 * 1024) throw Error("文件超过 20 MiB");
              if(/\.(png|svg)$/i.test(f.name)){
                const encoded=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(f);});
                const imported=await(await api("import-image",{data:encoded})).json();await load(imported.xml,f.name.replace(/\.(png|svg)$/i,".drawio"));
              }else await load(await f.text(), f.name);
            });
        }}
      />
      <input
        hidden
        ref={sourceInput}
        aria-label="原始截图文件"
        type="file"
        accept="image/png,image/jpeg"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pickImage(f, true).catch(showError);
        }}
      />
      <input
        hidden
        ref={imageInput}
        aria-label="插入图片文件"
        type="file"
        accept="image/png,image/jpeg"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pickImage(f, false).catch(showError);
        }}
      />
      {saveTemplateOpen && <SaveTemplate bridge={bridge} api={api} name={name} onClose={() => setSaveTemplateOpen(false)} onSaved={() => {setSaveTemplateOpen(false);setToast("已保存到我的模板，新建图稿或选择模板时可复用");}} />}
      {templateOpen && <TemplatePicker onClose={() => setTemplateOpen(false)} onCreate={createFromTemplate} />}
      {fillTemplateOpen && <TemplatePicker mode="fill" initialName={name} onClose={() => setFillTemplateOpen(false)} onCreate={fillFromTemplate} />}
      {exportOpen && (
        <Modal
          title="导出图稿"
          onClose={() => {
            if (!job) setExportOpen(false);
          }}
        >
          <p className="modal-description">在本机生成，保留你的细节。</p>
          <div className="format-options">
            {["png", "svg", "pdf"].map((f) => (
              <button
                disabled={!!job}
                className={format === f ? "chosen" : ""}
                key={f}
                onClick={() => {
                  setFormat(f);
                  if (f === "pdf") setScope("all");
                }}
              >
                <strong>{f.toUpperCase()}</strong>
                <small>
                  {f === "png"
                    ? "用于文档与分享"
                    : f === "svg"
                      ? "可缩放的矢量图"
                      : "单页完整图稿"}
                </small>
              </button>
            ))}
          </div>
          <div className="form-grid">
            <label>
              导出范围
              <select
                disabled={!!job || format === "pdf"}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="all">整个画布</option>
                <option value="selection">
                  已选对象（{selection.length}）
                </option>
              </select>
            </label>
            {format === "png" && (
              <label>
                清晰度
                <select
                  disabled={!!job}
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value))}
                >
                  <option value={1}>1× 标准</option>
                  <option value={2}>2× 高清</option>
                  <option value={3}>3× 超清</option>
                </select>
              </label>
            )}
            <label>
              边距（px）
              <input
                disabled={!!job}
                type="number"
                min="0"
                max="200"
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              disabled={!!job || format === "pdf"}
              type="checkbox"
              checked={transparent}
              onChange={(e) => setTransparent(e.target.checked)}
            />
            透明背景
          </label>
          <label className="checkbox"><input type="checkbox" checked={embed} disabled={!!job || format==="pdf" || scope!=="all"} onChange={event=>setEmbed(event.target.checked)}/>嵌入可编辑源图稿（仅整图 PNG/SVG，分享图片也会分享源文件）</label>
          <p className="fine-print">
            导出不会替代 .drawio 源文件保存。原图和核对标记不会出现在成品里。
          </p>
          <div className="modal-actions">
            {job ? (
              <>
                <span className="spinner" />
                <span>{jobStatus}</span>
                <button
                  onClick={() =>
                    void api("jobs/" + job, undefined, "DELETE")
                      .then(() => setJob(null))
                      .catch(showError)
                  }
                >
                  取消导出
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setExportOpen(false)}>取消</button>
                <button className="primary" onClick={() => void exportFile()}>
                  <Icon name="export" />
                  生成 {format.toUpperCase()}
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
      {deleteOpen && (
        <Modal title="删除分组或容器" onClose={() => setDeleteOpen(false)}>
          <p>选区包含内部对象，请选择如何处理内容。</p>
          <div className="modal-actions">
            <button onClick={() => setDeleteOpen(false)}>取消</button>
            <button
              onClick={() =>
                void bridge
                  .invoke("deleteSelection", { mode: "ungroup" })
                  .then((s) => {
                    applySnapshot(s);
                    setDeleteOpen(false);
                  })
                  .catch(showError)
              }
            >
              解组并保留内容
            </button>
            <button
              className="primary"
              onClick={() =>
                void bridge
                  .invoke("deleteSelection", { mode: "all" })
                  .then((s) => {
                    applySnapshot(s);
                    setDeleteOpen(false);
                  })
                  .catch(showError)
              }
            >
              删除容器及内容
            </button>
          </div>
        </Modal>
      )}
      {pending && (
        <Modal title="当前图稿还有未保存修改" onClose={() => setPending(false)}>
          <p>切换前可以先下载副本，或保留恢复草稿后继续。</p>
          <div className="modal-actions">
            <button onClick={() => setPending(false)}>继续编辑</button>
            <button
              onClick={() => {
                setPending(false);
                void pendingAction.current?.().catch(showError);
              }}
            >
              放弃当前修改并继续
            </button>
            <button
              className="primary"
              onClick={() =>
                void save()
                  .then((saved) => {
                    if (!saved) return;
                    setPending(false);
                    return pendingAction.current?.();
                  })
                  .catch(showError)
              }
            >
              下载副本后继续
            </button>
          </div>
        </Modal>
      )}
      {draftOpen && (
        <Modal title="恢复浏览器草稿" onClose={() => setDraftOpen(false)}>
          <p className="modal-description">
            这些是浏览器中的恢复副本，不代表文件已保存到磁盘。
          </p>
          <div className="draft-list">
            {drafts.length ? (
              drafts.map((d) => (
                <div className="draft-item" key={d.key}>
                  <div>
                    <strong>{d.name}</strong>
                    <small>{new Date(d.time).toLocaleString("zh-CN")}</small>
                  </div>
                  <button
                    onClick={() => {
                      setDraftOpen(false);
                      void guard(async () => {
                        await load(d.xml, d.name);
                        setDirty(true);
                        savedRevision.current = -1;
                        setStatus("已恢复草稿 · 请下载副本");
                      });
                    }}
                  >
                    恢复
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      void deleteDraft(d.key)
                        .then(() =>
                          setDrafts(drafts.filter((x) => x.key !== d.key)),
                        )
                        .catch(showError)
                    }
                  >
                    删除
                  </button>
                </div>
              ))
            ) : (
              <div className="empty">暂无恢复草稿</div>
            )}
          </div>
        </Modal>
      )}
      {error && (
        <Modal title="操作未完成" onClose={() => setError("")}>
          <pre className="error-detail">{error}</pre>
          <div className="modal-actions">
            <button
              onClick={() =>
                void copyText(error)
                  .then(() => setToast("诊断已复制"))
                  .catch(() => {})
              }
            >
              复制诊断
            </button>
            <button className="primary" onClick={() => setError("")}>
              知道了
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {toast}
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<SharedRoot boot={boot}><App /></SharedRoot>);
