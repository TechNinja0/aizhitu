import { CandidatePreview, downloadCandidate } from "./CandidatePreview";
import { addVersion } from "./versions";
import React, { useEffect, useRef, useState } from "react";
import type { Bridge } from "./bridge";
type Provider = "codex" | "qoder";
type Config = {
  defaultProvider: Provider;
  providers: Record<Provider, { path: string; model: string }>;
};
type Props = {
  bridge: Bridge;
  api: (path: string, body?: unknown, method?: string) => Promise<Response>;
  onApply: (s: any) => void;
  onError: (e: any) => void;
  ready: boolean;
  open: boolean;
  onClose: () => void;
  settingsOpen: boolean;
  onSettings: (open: boolean) => void;
  documentId?: string;
  documentName: string;
};
const qoderModels = [
  "Auto",
  "Qwen3.8-Max",
  "Qwen3.8-Flash",
  "Qwen3.7-Max",
  "Qwen3.7-Plus",
  "Kimi-K3",
  "Kimi-K2.8-Preview",
  "GLM-5.3",
];
type ChatMessage = {
  user: string;
  assistant: string;
  pending?: boolean;
  attachment?: string;
  progress?: { at: number; text: string }[];
  elapsed?: number;
};
const names = { codex: "Codex", qoder: "Qoder" };
export function AIChat({
  bridge,
  api,
  onApply,
  onError,
  ready,
  open,
  onClose,
  settingsOpen,
  onSettings,
  documentId,
  documentName,
}: Props) {
  const [config, setConfig] = useState<Config>(),
    [clients, setClients] = useState<any[]>([]),
    [provider, setProvider] = useState<Provider>("codex"),
    [model, setModel] = useState(""),
    [mode, setMode] = useState("edit"),
    [prompt, setPrompt] = useState(""),
    [job, setJob] = useState<any>(),
    [candidate, setCandidate] = useState<any>(),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState(""),
    [image, setImage] = useState<{
      data: string;
      mime: string;
      name: string;
    }>(),
    [version, setVersion] = useState<Record<string, string>>({});
  const [alternatives, setAlternatives] = useState<
    Record<string, Array<{ path: string; version: string }>>
  >({});
  const [recentJobs, setRecentJobs] = useState<any[]>([]),
    [tasksOpen, setTasksOpen] = useState(false);
  const [previewVerified, setPreviewVerified] = useState(false);
  const [overwrite, setOverwrite] = useState<{
    baseHash: string;
    revision: number;
    changedAgain: boolean;
  }>();
  const [previewOpen, setPreviewOpen] = useState(false),
    [previewError, setPreviewError] = useState(""),
    [previewBusy, setPreviewBusy] = useState(false);
  const previewGeneration = useRef(0);
  const [clock, setClock] = useState(Date.now());
  const messagesEnd = useRef<HTMLDivElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (open) messagesEnd.current?.scrollIntoView({ block: "nearest" });
  }, [messages, job?.progress?.at(-1)?.text, open]);
  const finishMessage = (user: string, assistant: string, result: any) =>
    setMessages((m) => {
      const item: ChatMessage = {
        user,
        assistant,
        progress: result.progress,
        elapsed: Math.max(
          0,
          Math.round(
            ((result.finishedAt || Date.now()) - result.createdAt) / 1000,
          ),
        ),
      };
      return m.at(-1)?.pending
        ? [...m.slice(0, -1), { ...m.at(-1), ...item, pending: false }]
        : [...m.slice(-11), item];
    });
  const savedConfig = useRef(""),
    lastRequest = useRef<{ prompt: string; image: typeof image } | undefined>(
      undefined,
    );
  const initial = useRef(false),
    mounted = useRef(true),
    active = useRef<string | undefined>(undefined),
    url = useRef(""),
    history = useRef(messages),
    doc = useRef(documentId);
  history.current = messages;
  const resetPreview = () => {
    setOverwrite(undefined);
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = "";
    setPreview("");
    setPreviewOpen(false);
    setPreviewVerified(false);
    setPreviewError("");
    previewGeneration.current++;
  };
  async function refresh() {
    const [s, tasks] = await Promise.all([
      api("ai/settings").then((r) => r.json()),
      api("ai/jobs").then((r) => r.json()),
    ]);
    if (!mounted.current) return;
    setClients(s.clients);
    setRecentJobs(tasks);
    if (!initial.current) {
      initial.current = true;
      setConfig(s.config);
      savedConfig.current = JSON.stringify(s.config);
      setProvider(s.config.defaultProvider);
      setModel(s.config.providers[s.config.defaultProvider].model);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => setNotice("本地 AI 服务不可达"));
    const timer = setInterval(
      () =>
        void refresh().catch(() => {
          setClients([]);
          setNotice("本地 AI 服务不可达，请检查服务是否运行");
        }),
      15000,
    );
    return () => {
      mounted.current = false;
      clearInterval(timer);
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);
  useEffect(() => {
    if (settingsOpen && savedConfig.current)
      setConfig(JSON.parse(savedConfig.current));
  }, [settingsOpen]);
  useEffect(() => {
    if (doc.current === documentId) return;
    doc.current = documentId;
    if (active.current)
      void api("ai/jobs/" + active.current, undefined, "DELETE").catch(
        () => {},
      );
    active.current = undefined;
    setJob(undefined);
    setCandidate(undefined);
    setMessages([]);
    setImage(undefined);
    setPrompt("");
    lastRequest.current = undefined;
    resetPreview();
    setNotice("已切换图稿，会话已重置");
  }, [documentId]);
  useEffect(() => {
    if (!job?.id || !["queued", "running", "validating"].includes(job.status)) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await (await api("ai/jobs/" + job.id)).json();
        if (stopped || active.current !== job.id) return;
        setJob({
          ...result,
          requestPrompt: result.requestPrompt || job.requestPrompt,
          recovering: job.recovering,
        });
        if (["queued", "running", "validating"].includes(result.status)) {
          timer = setTimeout(poll, 1000);
          return;
        }
        active.current = undefined;
        void refresh().catch(() => setNotice("本地服务连接中断"));
        if (result.kind === "generate" && result.status === "succeeded") {
          let candidateRevision = result.revision;
          let stale = false;
          if (job.recovering) {
            const current = await bridge.invoke("snapshot");
            const checked = await (
              await api("diff", {
                baseXml: current.xml,
                candidateXml: result.result.candidateXml,
              })
            ).json();
            if (stopped || doc.current !== result.documentId) return;
            if (current.metadata.documentId !== result.documentId) return;
            stale = checked.baseHash !== result.result.baseHash;
            candidateRevision = current.revision;
          }
          setCandidate({ ...result.result, revision: candidateRevision });
          finishMessage(
            result.requestPrompt || job.requestPrompt,
            result.message,
            result,
          );
          setNotice(stale ? "原稿已变化，候选已保留；预览后可选择强制覆盖" : result.message);
        } else if (result.status === "failed") {
          setNotice(result.error);
          if (result.kind === "generate")
            finishMessage(
              result.requestPrompt || job.requestPrompt,
              "失败：" + result.error,
              result,
            );
        } else {
          setNotice(result.message || "任务已取消");
          if (result.kind === "generate" && result.status === "cancelled")
            finishMessage(
              result.requestPrompt || job.requestPrompt,
              "任务已取消，画布未改变",
              result,
            );
        }
        if (
          result.kind === "generate" &&
          ["failed", "cancelled"].includes(result.status)
        ) {
          setPrompt(result.requestPrompt || job.requestPrompt || "");
          if (lastRequest.current) setImage(lastRequest.current.image);
        }
      } catch (e) {
        if (!stopped) {
          if (/过期或不存在|会话无效/.test((e as Error).message)) {
            active.current = undefined;
            setJob({ ...job, status: "unknown" });
            setPrompt(job.requestPrompt || "");
            setNotice("任务状态已失效，原要求已保留；请刷新工作台后重试");
            return;
          }
          setNotice("无法查询任务状态，可取消后重试");
          timer = setTimeout(poll, 3000);
        }
      }
    };
    timer = setTimeout(poll, 500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [job?.id]);
  const running =
      !!active.current ||
      (!!job && ["queued", "running", "validating"].includes(job.status)),
    client = clients.find((c) => c.id === provider);
  const status = job?.status === "queued" ? "等待服务器 AI 队列" : running
    ? job?.kind === "test"
      ? "正在测试连接"
      : job?.status === "validating"
        ? "校验候选中"
        : "AI 生成中"
    : !client
      ? "本地服务未连接"
      : !client.installed
        ? "CLI 未安装"
        : client.state === "error"
          ? "AI 连接异常"
          : client.state === "online" &&
              client.model === (provider === "codex" ? "" : model || "Auto") &&
              Date.now() - client.checkedAt < 15 * 60 * 1000
            ? "AI 已连接"
            : client.state === "online"
              ? "连接待验证"
              : "CLI 可用 · AI 未验证";
  async function saveConfig() {
    if (!config) return;
    await api("ai/settings", config);
    savedConfig.current = JSON.stringify(config);
    await refresh();
    setModel(config.providers[provider].model);
    setNotice("设置已保存，仅影响本工作台");
  }
  async function detect(p: Provider) {
    setBusy(true);
    try {
      const r = await (
        await api("ai/detect", {
          provider: p,
          path: config?.providers[p].path || "",
        })
      ).json();
      setVersion((v) => ({ ...v, [p]: r.version }));
      setAlternatives((v) => ({ ...v, [p]: r.alternatives || [] }));
      setNotice(`${names[p]} 已检测到：${r.path}`);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    try {
      if (JSON.stringify(config) !== savedConfig.current)
        throw Error("请先保存设置，再测试 AI 连接");
      setModel(config?.providers[provider].model || "");
      const j = await (
        await api("ai/test", {
          provider,
          model: config?.providers[provider].model || "",
        })
      ).json();
      active.current = j.id;
      setJob(j);
      setNotice("正在调用 AI 测试连接…");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (busy || running || !prompt.trim()) return;
    const previous = history.current
      .filter((m) => !m.pending)
      .map(({ user, assistant }) => ({ user, assistant }));
    setMessages((m) => [
      ...m.slice(-11),
      { user: prompt, assistant: "", pending: true, attachment: image?.name },
    ]);
    setJob(undefined);
    setBusy(true);
    try {
      const s = await bridge.invoke("snapshot");
      lastRequest.current = { prompt, image };
      const sentDoc = doc.current;
      const j = await (
        await api("ai/generate", {
          provider,
          model,
          prompt,
          mode,
          xml: s.xml,
          revision: s.revision,
          selection: s.selection,
          history: previous,
          image: image ? { data: image.data, mime: image.mime } : undefined,
        })
      ).json();
      if (sentDoc !== doc.current) {
        await api("ai/jobs/" + j.id, undefined, "DELETE");
        return;
      }
      active.current = j.id;
      setJob({ ...j, requestPrompt: prompt });
      setCandidate(undefined);
      resetPreview();
      setNotice("请求已发送，当前画布尚未改变");
      setPrompt("");
      setImage(undefined);
    } catch (e) {
      finishMessage(prompt, "发送失败：" + (e as Error).message, {
        createdAt: Date.now(),
      });
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function renderCandidate(force = false) {
    setPreviewOpen(true);
    setPreviewError("");
    if (preview && !force) return;
    setPreviewVerified(false);
    setBusy(true);
    setPreviewBusy(true);
    const chosen = candidate,
      generation = ++previewGeneration.current;
    try {
      const j = await (
        await api("exports", {
          xml: chosen.candidateXml,
          options: { format: "png", scale: 1 },
        })
      ).json();
      for (let i = 0; i < 210; i++) {
        const r = await (await api("jobs/" + j.jobId)).json();
        if (generation !== previewGeneration.current) return;
        if (r.status === "failed" || r.status === "cancelled")
          throw Error(r.error || "预览已取消");
        if (r.status === "succeeded") {
          const blob = await (await api("jobs/" + j.jobId + "/result")).blob();
          if (
            doc.current !== chosen.documentId ||
            generation !== previewGeneration.current
          )
            return;
          if (url.current) URL.revokeObjectURL(url.current);
          url.current = URL.createObjectURL(blob);
          setPreview(url.current);
          return;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      throw Error("预览等待超时，候选仍保留，可重试或下载图稿");
    } catch (e) {
      if (generation === previewGeneration.current)
        setPreviewError((e as Error).message);
    } finally {
      setBusy(false);
      setPreviewBusy(false);
    }
  }
  async function apply(force = false) {
    if (busy || !ready || !candidate) return;
    const chosen = candidate;
    setBusy(true);
    try {
      if (!previewVerified) throw Error("请先完成候选预览");
      const now = await bridge.invoke("snapshot");
      if (
        now.metadata.documentId !== chosen.documentId ||
        doc.current !== chosen.documentId
      )
        throw Error("候选属于另一个图稿，不能覆盖当前画布");
      const diff = await (
        await api("diff", {
          baseXml: now.xml,
          candidateXml: chosen.candidateXml,
        })
      ).json();
      if (doc.current !== chosen.documentId) return;
      if (
        force
          ? !overwrite ||
            overwrite.baseHash !== diff.baseHash ||
            overwrite.revision !== now.revision
          : diff.baseHash !== chosen.baseHash
      ) {
        setOverwrite({ baseHash: diff.baseHash, revision: now.revision, changedAgain: force });
        setNotice(force ? "确认期间图稿再次变化，请重新确认覆盖" : "当前图稿已变化，可选择强制覆盖或保留当前图稿");
        return;
      }
      await addVersion({
        documentId: now.metadata.documentId,
        name: documentName,
        label: force ? "AI 强制覆盖前自动备份" : "AI 应用前自动备份",
        xml: now.xml,
      });
      if (doc.current !== chosen.documentId) return;
      onApply(
        await bridge.invoke("applyCandidate", {
          xml: chosen.candidateXml,
          expectedRevision: now.revision,
          documentId: chosen.documentId,
        }),
      );
      setCandidate(undefined);
      resetPreview();
      setMessages((m) =>
        m.map((v, i) =>
          i === m.length - 1
            ? { ...v, assistant: v.assistant.replace("尚未应用", "用户已应用") }
            : v,
        ),
      );
      setNotice(force ? "候选已强制覆盖，原稿已自动备份，可一步撤销" : "候选已应用，可一步撤销");
    } catch (e) {
      setOverwrite(undefined);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function recover(id: string) {
    setBusy(true);
    try {
      const r = await (await api("ai/jobs/" + id)).json();
      if (r.kind === "generate" && r.documentId !== doc.current)
        throw Error("请先打开此任务对应的图稿");
      if (running) throw Error("先等待或取消当前任务");
      setProvider(r.provider);
      setModel(
        r.model ?? config?.providers[r.provider as Provider].model ?? "",
      );
      if (["queued", "running", "validating"].includes(r.status)) {
        setCandidate(undefined);
        resetPreview();
        setMessages((m) => [
          ...m.slice(-11),
          { user: r.requestPrompt, assistant: "", pending: true },
        ]);
        active.current = r.id;
        setJob({ ...r, recovering: true });
        setNotice("已接回任务，继续等待结果");
      } else if (r.result) {
        const now = await bridge.invoke("snapshot");
        const d = await (
          await api("diff", {
            baseXml: now.xml,
            candidateXml: r.result.candidateXml,
          })
        ).json();
        // A stale candidate remains reviewable; applying it requires explicit overwrite confirmation.
        if (
          now.metadata.documentId !== r.documentId ||
          doc.current !== r.documentId
        )
          throw Error(
            "此任务的原稿与当前画布不同；请先恢复原稿，或重新发送要求",
          );
        setCandidate({ ...r.result, revision: now.revision });
        resetPreview();
        setMessages((m) => [
          ...m.slice(-11),
          { user: r.requestPrompt, assistant: r.message },
        ]);
        setJob(r);
        setNotice(d.baseHash !== r.result.baseHash
          ? "原稿已变化，候选已接回；预览后可选择强制覆盖"
          : "候选已接回，请预览后应用");
      } else {
        setPrompt(r.requestPrompt || "");
        setNotice("已取回原要求，可修改后重新发送");
      }
      setTasksOpen(false);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function attach(f: File) {
    if (
      f.size > 8 * 1024 * 1024 ||
      !["image/png", "image/jpeg"].includes(f.type)
    )
      throw Error("请选择不超过 8 MiB 的 PNG/JPEG");
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(f);
    });
    setImage({ data, mime: f.type, name: f.name });
  }
  const settingsDirty =
    !!config && JSON.stringify(config) !== savedConfig.current;
  return (
    <>
      {overwrite && candidate && (
        <div className="scrim">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="图稿已变化"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setOverwrite(undefined);
              if (e.key !== "Tab") return;
              const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
              const first = buttons[0], last = buttons[buttons.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="modal-heading">
              <h2>图稿已变化</h2>
              <button disabled={busy} onClick={() => setOverwrite(undefined)} aria-label="关闭覆盖确认">×</button>
            </div>
            <p className="warning">AI 候选基于较早的原稿生成。强制覆盖会用候选替换当前整张图稿，等待期间的修改不会合并。</p>
            {overwrite.changedAgain && <p role="status">确认期间图稿再次变化，请核对后再次点击强制覆盖。</p>}
            <p>覆盖前将自动保存当前版本，覆盖后可一步撤销，也可从版本记录恢复。</p>
            <div className="modal-actions">
              <button disabled={busy} onClick={() => downloadCandidate(candidate.candidateXml)}>下载候选</button>
              <button autoFocus disabled={busy} onClick={() => setOverwrite(undefined)}>保留当前图稿</button>
              <button className="primary" disabled={busy || !ready} onClick={() => void apply(true)}>强制覆盖</button>
            </div>
          </section>
        </div>
      )}
      <aside className="ai-panel" hidden={!open} aria-label="AI 会话">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">LOCAL AI</span>
            <h2>一起画清楚</h2>
          </div>
          <button onClick={onClose} aria-label="关闭 AI 会话">
            ×
          </button>
        </div>
        <div className="ai-status" role="status">
          <i
            className={
              status === "AI 已连接" ? "online" : running ? "working" : ""
            }
          />
          {status}
        </div>
        {client?.checkedAt && (
          <small className="ai-time">
            上次验证 {new Date(client.checkedAt).toLocaleTimeString()} ·
            不代表持续联网
          </small>
        )}
        <div className="ai-row">
          <button onClick={() => onSettings(true)}>客户端设置</button>
          <button
            disabled={running || busy}
            onClick={() => {
              setMessages([]);
              setCandidate(undefined);
              resetPreview();
              setNotice("已清空会话，画布保持不变");
            }}
          >
            清空会话
          </button>
        </div>
        <div className="ai-row ai-task-toggle">
          <button
            disabled={busy}
            onClick={() => {
              setTasksOpen(!tasksOpen);
              void refresh().catch(onError);
            }}
          >
            最近 AI 任务
          </button>
          <small>刷新后可接回 · 服务内保留 1 小时</small>
        </div>
        {tasksOpen && (
          <section className="ai-task-list" aria-label="最近 AI 任务">
            {recentJobs.map((t) => (
              <article key={t.id}>
                <strong>
                  {names[t.provider as Provider]} ·{" "}
                  {
                    (
                      {
                        queued: "排队中",
                        running: "执行中",
                        validating: "校验中",
                        succeeded: "已完成",
                        failed: "失败",
                        cancelled: "已取消",
                      } as Record<string, string>
                    )[t.status]
                  }
                </strong>
                <p>{t.requestPrompt || "连接测试"}</p>
                <small>
                  {new Date(t.createdAt).toLocaleTimeString()}
                  {t.documentId && t.documentId !== documentId
                    ? " · 其他图稿"
                    : ""}
                </small>
                <div className="ai-row">
                  <button
                    disabled={
                      busy ||
                      running ||
                      t.kind === "test" ||
                      t.documentId !== documentId
                    }
                    onClick={() => void recover(t.id)}
                  >
                    接回任务
                  </button>
                  {["queued", "running", "validating"].includes(t.status) && (
                    <button
                      onClick={() =>
                        void api("ai/jobs/" + t.id, undefined, "DELETE")
                          .then(refresh)
                          .catch(onError)
                      }
                    >
                      取消此任务
                    </button>
                  )}
                </div>
              </article>
            ))}
            {!recentJobs.length && <p>暂无任务；服务重启后记录会清空。</p>}
          </section>
        )}
        <div className="ai-messages" aria-live="polite">
          {!messages.length && (
            <div className="ai-welcome">
              <strong>从一句话或一张截图开始</strong>
              <p>例如：把订单服务拆成下单与查询两个模块，保留其他布局。</p>
              <p>发送当前图稿和附件给所选 CLI；生成结果经预览后再应用。</p>
            </div>
          )}
          {messages.map((m, i) => (
            <article key={i} className="ai-turn">
              <div className="ai-user">
                <p>{m.user}</p>
                {m.attachment && <small>▧ {m.attachment}</small>}
              </div>
              <div className="ai-assistant">
                {(m.pending || m.progress?.length) && (
                  <details className="ai-progress" open={m.pending}>
                    <summary>
                      <span className={m.pending ? "ai-spinner" : "ai-done"}>
                        {m.pending ? "◌" : "✓"}
                      </span>{" "}
                      {m.pending
                        ? job?.progress?.at(-1)?.text || "正在发送要求"
                        : "执行过程"}{" "}
                      ·{" "}
                      {m.pending
                        ? Math.max(
                            0,
                            Math.floor(
                              (clock - (job?.createdAt || clock)) / 1000,
                            ),
                          )
                        : m.elapsed}{" "}
                      秒
                    </summary>
                    <ol>
                      {(m.pending ? job?.progress : m.progress)?.map(
                        (p: any, n: number) => (
                          <li key={n}>{p.text}</li>
                        ),
                      )}
                    </ol>
                  </details>
                )}
                {m.assistant && <p>{m.assistant}</p>}
              </div>
            </article>
          ))}
          {candidate && (
            <section className="ai-candidate">
              <strong>{candidate.changes.length} 项变化 · 待应用</strong>
              <div className="ai-diff">
                {candidate.changes.map((c: any, i: number) => (
                  <p key={i}>
                    {c.kind} · {c.label || c.id}
                    {c.kind === "文字" && (
                      <span>
                        （{c.before} → {c.after}）
                      </span>
                    )}
                  </p>
                ))}
              </div>
              <div className="ai-row">
                <button disabled={busy} onClick={() => void renderCandidate()}>
                  预览候选
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !previewVerified ||
                    !candidate.changes.length ||
                    !ready
                  }
                  title={!preview ? "先预览再应用" : ""}
                  onClick={() => void apply()}
                >
                  应用到画布
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setCandidate(undefined);
                    resetPreview();
                    setNotice("已丢弃候选");
                  }}
                >
                  丢弃
                </button>
              </div>
              <button onClick={() => downloadCandidate(candidate.candidateXml)}>
                下载候选 .drawio
              </button>
              {preview && (
                <button
                  className="preview-thumbnail"
                  onClick={() => setPreviewOpen(true)}
                >
                  <img src={preview} alt="候选缩略图" />
                  <span>点击查看大图</span>
                </button>
              )}
            </section>
          )}
          <div ref={messagesEnd} />
        </div>
        <p className="ai-notice" role="status">
          {notice}
        </p>
        <div
          className="ai-compose"
          onDragOver={(e) => {
            if (!running && !busy) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f && !running && !busy) void attach(f).catch(onError);
          }}
        >
          <textarea
            aria-label="AI 绘图要求"
            placeholder="描述你想生成或修改的图…"
            value={prompt}
            maxLength={12000}
            disabled={running || busy}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (!running && !busy && ready && client?.installed)
                  void send();
              }
            }}
            onPaste={(e) => {
              const f = Array.from(e.clipboardData.items)
                .find((i) => i.kind === "file" && i.type.startsWith("image/"))
                ?.getAsFile();
              if (f) {
                e.preventDefault();
                void attach(f).catch(onError);
              }
            }}
          />
          <input
            ref={attachmentInput}
            hidden
            aria-label="AI 截图附件"
            type="file"
            accept="image/png,image/jpeg"
            disabled={running || busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void attach(f).catch(onError);
            }}
          />
          {image && (
            <button
              disabled={running || busy}
              onClick={() => setImage(undefined)}
            >
              {image.name} ×
            </button>
          )}
          <div className="ai-compose-options">
            {" "}
            <select
              aria-label="AI 修改范围"
              value={mode}
              disabled={running || busy}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="edit">修改当前图</option>
              <option value="selection">仅修改选区</option>
              <option value="generate">重新生成整张图</option>
            </select>
          </div>
          <div className="ai-compose-bottom">
            <select
              aria-label="会话 AI 客户端"
              value={provider}
              disabled={running || busy}
              onChange={(e) => {
                const p = e.target.value as Provider;
                setProvider(p);
                setModel(config?.providers[p].model || "");
              }}
            >
              {Object.entries(names).map(([p, n]) => (
                <option key={p} value={p}>
                  {n}
                </option>
              ))}
            </select>

            {provider === "qoder" ? (
              <select
                aria-label="会话模型"
                value={model || "Auto"}
                disabled={running || busy}
                onChange={(e) => setModel(e.target.value)}
              >
                {qoderModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <small className="ai-cli-default">沿用 CLI 配置</small>
            )}
            <button
              className="ai-attach-button"
              title="上传截图，也可粘贴或拖入"
              aria-label="上传截图"
              disabled={running || busy}
              onClick={() => attachmentInput.current?.click()}
            >
              <svg
                viewBox="0 0 24 24"
                width="19"
                height="19"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="M8 12v5a4 4 0 0 0 8 0V6a3 3 0 0 0-6 0v10a1 1 0 0 0 2 0V8" />
              </svg>
            </button>
            {running ? (
              <button
                className="ai-send"
                aria-label="取消任务"
                title="停止生成"
                onClick={async () => {
                  try {
                    await api("ai/jobs/" + job.id, undefined, "DELETE");
                    setNotice("正在取消…");
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                ■
              </button>
            ) : (
              <button
                className="ai-send"
                aria-label="发送给 AI"
                title="发送（Enter），换行（Shift+Enter）"
                disabled={
                  busy || !ready || !prompt.trim() || !client?.installed
                }
                onClick={() => void send()}
              >
                ↑
              </button>
            )}
          </div>
          <small className="ai-compose-hint">
            Enter 发送 · Shift+Enter 换行 · 结果预览后应用
          </small>
        </div>
        {previewOpen && candidate && (
          <CandidatePreview
            url={preview}
            busy={previewBusy}
            error={previewError}
            alt="AI 生成候选预览"
            onClose={() => setPreviewOpen(false)}
            onLoaded={() => setPreviewVerified(true)}
            onRetry={() => void renderCandidate(true)}
            onApply={() => {
              setPreviewOpen(false);
              void apply();
            }}
          />
        )}
      </aside>
      {settingsOpen && (
        <div className="scrim">
          <section
            className="modal ai-settings"
            role="dialog"
            aria-modal="true"
            aria-label="AI 客户端设置"
          >
            <div className="modal-heading">
              <h2>设置 · AI 客户端</h2>
              <button disabled={busy} onClick={() => onSettings(false)}>
                关闭
              </button>
            </div>
            <div className="ai-settings-body">
              <p>
                本机运行，复用已有 CLI 登录和配置。不保存 API
                Key，不修改客户端全局配置。
              </p>
              {config && (
                <>
                  <label className="ai-field">
                    默认客户端
                    <select
                      aria-label="默认 AI 客户端"
                      value={config.defaultProvider}
                      disabled={busy || running}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          defaultProvider: e.target.value as Provider,
                        })
                      }
                    >
                      {Object.entries(names).map(([p, n]) => (
                        <option key={p} value={p}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(["codex", "qoder"] as const).map((p) => (
                    <fieldset key={p} disabled={busy || running}>
                      <legend>{names[p]}</legend>
                      <label className="ai-field">
                        执行文件绝对路径（留空自动检测）
                        <input
                          aria-label={names[p] + " 执行路径"}
                          value={config.providers[p].path}
                          placeholder={
                            clients.find((c) => c.id === p)?.path || "自动查找"
                          }
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              providers: {
                                ...config.providers,
                                [p]: {
                                  ...config.providers[p],
                                  path: e.target.value,
                                },
                              },
                            })
                          }
                        />
                      </label>
                      {p === "qoder" ? (
                        <label className="ai-field">
                          默认模型
                          <select
                            aria-label="Qoder 默认模型"
                            value={config.providers.qoder.model || "Auto"}
                            onChange={(e) =>
                              setConfig({
                                ...config,
                                providers: {
                                  ...config.providers,
                                  qoder: {
                                    ...config.providers.qoder,
                                    model: e.target.value,
                                  },
                                },
                              })
                            }
                          >
                            {qoderModels.map((m) => (
                              <option key={m}>{m}</option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <p>模型沿用本机 Codex 配置</p>
                      )}
                      <button onClick={() => void detect(p)}>
                        检测 {names[p]}（不调用模型）
                      </button>
                      <small>{version[p]}</small>
                      {(alternatives[p] || []).map((a) => (
                        <div className="ai-detected" key={a.path}>
                          <small>
                            {a.version} · {a.path}
                          </small>
                          <button
                            onClick={() => {
                              setConfig({
                                ...config,
                                providers: {
                                  ...config.providers,
                                  [p]: { ...config.providers[p], path: a.path },
                                },
                              });
                              setNotice("已选择该路径，保存或测试后生效");
                            }}
                          >
                            选择此客户端
                          </button>
                        </div>
                      ))}
                    </fieldset>
                  ))}
                  <p>未登录时请在终端执行 codex login 或 qodercli login。</p>
                  <div className="ai-settings-test">
                    <strong>连接验证</strong>
                    <small>保存设置后，可使用少量模型额度验证连接。</small>
                    <div className="ai-row">
                      <select
                        aria-label="测试 AI 客户端"
                        value={provider}
                        disabled={busy || running}
                        onChange={(e) => {
                          const p = e.target.value as Provider;
                          setProvider(p);
                          setModel(config.providers[p].model);
                        }}
                      >
                        {Object.entries(names).map(([p, n]) => (
                          <option key={p} value={p}>
                            {n}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={busy || running || settingsDirty}
                        title={settingsDirty ? "请先保存设置" : ""}
                        onClick={() => void test()}
                      >
                        测试 AI 连接（消耗少量额度）
                      </button>
                    </div>
                  </div>
                  <p role="status">
                    {status} · {notice}
                  </p>
                  {running && (
                    <button
                      onClick={() =>
                        void api(
                          "ai/jobs/" + job.id,
                          undefined,
                          "DELETE",
                        ).catch(onError)
                      }
                    >
                      取消连接测试或任务
                    </button>
                  )}
                </>
              )}
            </div>
            {config && (
              <footer className="ai-settings-footer">
                <div className="ai-settings-save-state" role="status">
                  <strong className={settingsDirty ? "is-dirty" : ""}>
                    <span aria-hidden="true">{settingsDirty ? "●" : "✓"}</span>
                    {settingsDirty ? "有未保存的更改" : "设置已保存"}
                  </strong>
                  <small>
                    {running
                      ? "任务运行中，结束后可保存设置"
                      : "仅保存在本机工作台，检测不会自动保存"}
                  </small>
                </div>
                <button
                  className="primary ai-settings-save"
                  disabled={busy || running}
                  onClick={() =>
                    void saveConfig()
                      .then(() => setNotice("设置已保存"))
                      .catch(onError)
                  }
                >
                  <svg
                    aria-hidden="true"
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z" />
                    <path d="M7 3v6h10V3M7 21v-8h10v8" />
                  </svg>
                  保存设置
                </button>
              </footer>
            )}
          </section>
        </div>
      )}
    </>
  );
}
