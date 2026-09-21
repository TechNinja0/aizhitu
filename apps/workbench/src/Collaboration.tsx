import React, { useEffect, useRef, useState } from "react";
import type { Options } from "./SharedWorkspace";
import {
  workspaceApi,
  workspaceContext,
  workspaceHeaders,
} from "./SharedWorkspace";
import { uuid } from "./uuid";
import { equivalentXml } from "../../../packages/editor-adapter/collaboration.js";

export function useCollaboration(id: string | undefined, options: Options) {
  const opts = useRef(options);
  opts.current = options;
  const [active, setActive] = useState(false),
    [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState(""),
    [members, setMembers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const flight = useRef<Promise<boolean>>(Promise.resolve(false));
  const state = useRef({
    active: false,
    paused: false,
    token: "",
    client: uuid(),
    base: null as any,
    pending: null as any,
    received: null as any,
    running: false,
    failures: 0,
    retryAt: 0,
  });
  const call = (method: string, body: any) =>
    workspaceApi(`documents/${id}/collaboration/${method}`, body);
  const updateDirty = (dirty: boolean) => {
    opts.current.state.current.dirty = dirty;
    opts.current.setDirty(dirty);
    opts.current.setStatus(
      dirty ? "有未同步修改 · 恢复草稿可用" : "已同步到服务器",
    );
  };
  const apply = async (document: any, baseXml: string, baseName: string) => {
    const result = await opts.current.bridge.invoke("collaborationApply", {
      base: baseXml,
      xml: document.xml,
    });
    if (result.deferred) return false;
    const name =
      opts.current.state.current.name === baseName
        ? document.name
        : opts.current.state.current.name;
    opts.current.state.current.name = name;
    opts.current.setName(name);
    opts.current.applySnapshot(result);
    state.current.base = document;
    const dirty = result.dirty || name !== document.name;
    if (!dirty) opts.current.savedRevision.current = result.revision;
    updateDirty(dirty);
    return true;
  };
  const connect = async () => {
    const joined = await call("join", { client: state.current.client });
    state.current.token = joined.token;
    workspaceContext.collaborationToken = joined.token;
    setMembers(joined.members);
    return joined;
  };
  const start = async () => {
    const joined = await connect();
    try {
      await opts.current.load(joined.document.xml, joined.document.name);
      await opts.current.bridge.invoke("collaborationMode", {
        value: true,
        client: state.current.client,
      });
      await opts.current.bridge.invoke("setReadOnly", { value: false });
      Object.assign(state.current, {
        active: true,
        paused: false,
        base: joined.document,
        pending: null,
        received: null,
        retryAt: 0,
        failures: 0,
      });
      setActive(true);
      setPaused(false);
      setNotice("协同已连接 · 每秒自动同步");
    } catch (e) {
      await call("leave", { token: joined.token }).catch(() => {});
      workspaceContext.collaborationToken = undefined;
      throw e;
    }
  };
  const syncOnce = async (manual = false): Promise<boolean> => {
    const s = state.current;
    if (
      !s.active ||
      s.paused ||
      s.running ||
      (!manual && Date.now() < s.retryAt)
    )
      return false;
    s.running = true;
    try {
      if (!s.token) await connect();
      // Renew presence even while the user is composing text or a response is deferred.
      const presence = await call("state", {
        token: s.token,
        revision: s.base.revision,
      });
      setMembers(presence.members);
      if (s.received) {
        const { document, xml, name, conflicts } = s.received;
        if (!(await apply(document, xml, name))) return false;
        s.received = null;
        s.pending = null;
        setNotice(
          conflicts.length
            ? `已合并 · ${conflicts.length} 处并发冲突按后提交或删除优先处理`
            : `已同步 · 版本 ${document.revision}`,
        );
      }
      if (!s.pending) {
        const editing = await opts.current.bridge.invoke("editing");
        if (editing.editing && !manual) return false;
        const snapshot = await opts.current.bridge.invoke("snapshot");
        const name = opts.current.state.current.name;
        if (!equivalentXml(snapshot.xml, s.base.xml) || name !== s.base.name) {
          s.pending = {
            requestId: uuid(),
            revision: s.base.revision,
            xml: snapshot.xml,
            name,
          };
          updateDirty(true);
        }
      }
      if (s.pending) {
        const response = await call("sync", { ...s.pending, token: s.token });
        s.received = {
          document: response.document,
          xml: s.pending.xml,
          name: s.pending.name,
          conflicts: response.conflicts,
        };
        if (!(await apply(response.document, s.pending.xml, s.pending.name)))
          return false;
        s.received = null;
        s.pending = null;
        setNotice(
          response.conflicts.length
            ? `已合并 · ${response.conflicts.length} 处并发冲突按后提交或删除优先处理`
            : `已同步 · 版本 ${response.document.revision}`,
        );
      }
      if (presence.document.revision > s.base.revision) {
        if (!(await apply(presence.document, s.base.xml, s.base.name)))
          return false;
        setNotice(`已同步 · 版本 ${presence.document.revision}`);
      }
      s.failures = 0;
      s.retryAt = 0;
      if (!opts.current.state.current.dirty)
        setNotice((old) =>
          old.includes("冲突") ? old : `已同步 · 版本 ${s.base.revision}`,
        );
      return !opts.current.state.current.dirty;
    } catch (e) {
      const status = (e as any).status;
      if (status === 423) {
        s.token = "";
        workspaceContext.collaborationToken = undefined;
      }
      if ([400, 401, 403, 404, 409, 422].includes(status)) {
        s.paused = true;
        setPaused(true);
        await opts.current.bridge
          .invoke("setReadOnly", { value: true })
          .catch(() => {});
        setNotice(
          `${(e as Error).message}；同步已暂停，当前内容可用“下载副本”下载`,
        );
      } else {
        s.failures++;
        s.retryAt =
          Date.now() +
          Math.min(15_000, 1000 * 2 ** Math.min(s.failures - 1, 4));
        setNotice(
          "连接中断 · 修改保留在当前页面，恢复网络后自动重试，请勿关闭页面",
        );
      }
      return false;
    } finally {
      s.running = false;
    }
  };
  const sync = (manual = false): Promise<boolean> => {
    if (state.current.running)
      return manual
        ? flight.current.then(() => sync(true))
        : Promise.resolve(false);
    const task = syncOnce(manual);
    flight.current = task;
    return task;
  };
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void sync(), 1000);
    const leave = () => {
      void fetch(`/api/documents/${id}/collaboration/leave`, {
        method: "POST",
        keepalive: true,
        headers: { ...workspaceHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ token: state.current.token }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [active, id]);
  const exit = async (discard = false) => {
    if (busy) return;
    setBusy(true);
    setPaused(true);
    try {
      await opts.current.bridge.invoke("setReadOnly", { value: true });
      if (!discard && !(await sync(true))) return;
      if (
        discard &&
        !confirm(
          "请先用“下载副本”下载备份。确定放弃未同步修改并加载服务器最新版本？",
        )
      )
        return;
      state.current.active = false;
      await call("leave", { token: state.current.token });
      const document = await workspaceApi(`documents/${id}`);
      state.current.active = false;
      await opts.current.bridge.invoke("collaborationMode", { value: false });
      await opts.current.bridge.invoke("setReadOnly", { value: true });
      await opts.current.load(document.xml, document.name);
      workspaceContext.collaborationToken = undefined;
      setActive(false);
    } catch (e) {
      state.current.active = true;
      opts.current.onError(e);
    } finally {
      if (state.current.active && !state.current.paused) {
        await opts.current.bridge.invoke("setReadOnly", { value: false });
        setPaused(false);
      }
      setBusy(false);
    }
  };
  const panel = active ? (
    <div className="shared-document-bar collaboration-bar">
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          if (state.current.paused) {
            if (
              !opts.current.state.current.dirty ||
              confirm("当前有未同步修改，请先下载副本。仍返回文件库？")
            )
              location.assign("/");
            return;
          }
          void (async () => {
            await exit();
            if (!state.current.active) location.assign("/");
          })();
        }}
      >
        ← 文件库
      </a>
      <strong>{workspaceContext.actor?.name}</strong>
      <span className={paused ? "shared-readonly" : "shared-editing"}>
        {paused ? "协同已暂停" : "多人协同编辑"}
      </span>
      <span
        aria-label="在线协同成员"
        title={members.map((m) => m.name).join("、")}
      >
        在线 {members.length} 个页面：{members.map((m) => m.name).join("、")}
      </span>
      <span className="shared-notice" role="status">
        {notice}
      </span>
      <button disabled={busy || paused} onClick={() => void sync(true)}>
        立即同步
      </button>
      <button disabled={busy || paused} onClick={() => void exit()}>
        退出协同
      </button>
      <button disabled={busy} onClick={() => void exit(true)}>
        放弃修改并重新加载
      </button>
    </div>
  ) : null;
  return {
    active,
    paused,
    panel,
    start,
    save: () => sync(true),
    isDirty: (snapshot: any) =>
      !!state.current.base &&
      (!equivalentXml(snapshot.xml, state.current.base.xml) ||
        opts.current.state.current.name !== state.current.base.name),
  };
}
