import { collaborationInterval } from "./collaboration-policy";
import { useEffect, useRef, useState } from "react";
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
  const [notice, setNotice] = useState("正在连接文档…"),
    [members, setMembers] = useState<any[]>([]);
  const [viewing, setViewing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [document, setDocument] = useState<any>();
  const [denied, setDenied] = useState(false);
  const starting = useRef<Promise<void> | null>(null);
  const operation = useRef(false);
  const flight = useRef<Promise<boolean>>(Promise.resolve(false));
  const state = useRef({
    mounted: false,
    held: false,
    terminal: false,
    active: false,
    viewing: true,
    preferredEditing: undefined as boolean | undefined,
    paused: false,
    token: "",
    client: uuid(),
    base: null as any,
    pending: null as any,
    received: null as any,
    running: false,
    failures: 0,
    retryAt: 0,
    lastPollAt: 0,
    pages: 1,
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
    setDocument(document);
    const dirty = result.dirty || name !== document.name;
    if (!dirty) opts.current.savedRevision.current = result.revision;
    updateDirty(dirty);
    return true;
  };
  const connect = async () => {
    const joined = await call("join", { client: state.current.client });
    state.current.token = joined.token;
    state.current.pages = joined.members.length;
    if (state.current.mounted) {
      workspaceContext.collaborationToken = joined.token;
      setMembers(joined.members);
    }
    return joined;
  };
  const resetBase = async (document: any, editing = !state.current.viewing) => {
    await opts.current.load(document.xml, document.name);
    await opts.current.bridge.invoke("collaborationMode", {
      value: editing,
      client: state.current.client,
    });
    Object.assign(state.current, {
      active: true,
      viewing: !editing,
      preferredEditing: editing,
      paused: false,
      base: document,
      pending: null,
      received: null,
      retryAt: 0,
      failures: 0,
      terminal: false,
    });
    setDocument(document);
    setActive(true);
    setViewing(!editing);
    setPaused(false);
    setDenied(false);
    updateDirty(false);
  };
  const start = (wantEdit?: boolean): Promise<void> => {
    if (starting.current) return starting.current;
    const task = (async () => {
      const s = state.current;
      if (wantEdit !== undefined) s.preferredEditing = wantEdit;
      let joined: any;
      try {
        await opts.current.bridge.invoke("setReadOnly", { value: true });
        const initial = await workspaceApi(`documents/${id}`);
        if (!s.mounted) return;
        setDocument(initial);
        const edit =
          wantEdit ??
          s.preferredEditing ??
          initial.owner === workspaceContext.actor?.id;
        if (edit && !initial.canEdit)
          throw Object.assign(Error("当前仅有查看权限，不能编辑"), {
            status: 403,
          });
        if (edit) joined = await connect();
        const latest = joined?.document || initial;
        if (!s.mounted) {
          if (joined) await call("leave", { token: joined.token });
          return;
        }
        await resetBase(latest, edit);
        s.pages =
          (joined?.members || initial.collaborators || []).length +
          (edit ? 0 : 1);
        setMembers(joined?.members || initial.collaborators || []);
        if (!s.mounted) {
          if (joined) await call("leave", { token: joined.token });
          return;
        }
        await opts.current.bridge.invoke("setReadOnly", { value: !edit });
        setNotice("已连接");
      } catch (e) {
        if (joined)
          await call("leave", { token: joined.token }).catch(() => {});
        if (workspaceContext.collaborationToken === s.token)
          workspaceContext.collaborationToken = undefined;
        s.token = "";
        if (!s.mounted) return;
        s.active = false;
        setActive(false);
        const status = (e as any).status;
        s.terminal = [400, 401, 403, 404, 409, 422].includes(status);
        if ([403, 404].includes(status) && !s.base) setDenied(true);
        s.retryAt = Date.now() + 3000;
        setNotice(
          `${(e as Error).message}；${s.terminal ? "请检查权限后重新连接" : "正在自动重试连接"}`,
        );
      }
    })();
    starting.current = task;
    void task.finally(() => {
      starting.current = null;
    });
    return task;
  };
  const syncOnce = async (manual = false): Promise<boolean> => {
    const s = state.current;
    if (
      !s.active ||
      s.paused ||
      s.running ||
      (!manual && (s.held || Date.now() < s.retryAt))
    )
      return false;
    s.running = true;
    s.lastPollAt = Date.now();
    try {
      if (s.viewing) {
        const info = await workspaceApi(`documents/${id}/state`);
        setMembers(info.collaborators);
        s.pages = info.collaborators.length + 1;
        setDocument((old: any) => ({ ...old, ...info }));
        if (info.revision !== s.base.revision) {
          const latest = await workspaceApi(`documents/${id}`);
          if (!(await apply(latest, s.base.xml, s.base.name))) return false;
        }
        s.retryAt = 0;
        s.failures = 0;
        setNotice("已同步");
        return true;
      }
      if (!s.token) await connect();
      // Renew presence even while the user is composing text or a response is deferred.
      const presence = await call("state", {
        token: s.token,
        revision: s.base.revision,
      });
      setMembers(presence.members);
      s.pages = presence.members.length;
      setDocument((old: any) => ({
        ...old,
        ...presence.document,
        xml: presence.document.xml || old?.xml,
      }));
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
      if (!s.pending && (manual || opts.current.state.current.dirty)) {
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
        if (workspaceContext.collaborationToken === s.token)
          workspaceContext.collaborationToken = undefined;
        s.token = "";
      }
      if (status === 403) {
        const latest = await workspaceApi(`documents/${id}`).catch(() => null);
        if (latest) setDocument(latest);
        s.preferredEditing = false;
        if (
          latest &&
          !opts.current.state.current.dirty &&
          !s.pending &&
          !s.received
        ) {
          await opts.current.bridge.invoke("setReadOnly", { value: true });
          await resetBase(latest, false);
          s.token = "";
          workspaceContext.collaborationToken = undefined;
          setNotice("编辑权限已收回 · 现在仅查看");
          return true;
        }
      }
      if (status === 404 && s.viewing && !opts.current.state.current.dirty)
        setDenied(true);
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
    if (!id || !options.ready) return;
    const s = state.current;
    s.mounted = true;
    workspaceContext.documentId = id;
    const tick = () => {
      if (!s.mounted || s.held) return;
      if (s.active) {
        const interval = collaborationInterval({
          pending: !!(
            opts.current.state.current.dirty ||
            s.pending ||
            s.received
          ),
          hidden: globalThis.document.visibilityState === "hidden",
          pages: s.pages,
        });
        if (Date.now() - s.lastPollAt >= interval) void sync();
      } else if (!s.terminal && Date.now() >= s.retryAt) void start();
    };
    tick();
    const timer = setInterval(tick, 1000);
    const leave = () => {
      if (!s.token) return;
      void fetch(`/api/documents/${id}/collaboration/leave`, {
        method: "POST",
        keepalive: true,
        headers: { ...workspaceHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ token: s.token }),
      }).catch(() => {});
    };
    const wake = () => {
      s.lastPollAt = 0;
      s.retryAt = 0;
      tick();
    };
    const visible = () => {
      if (globalThis.document.visibilityState !== "hidden") wake();
    };
    window.addEventListener("pagehide", leave);
    window.addEventListener("online", wake);
    globalThis.document.addEventListener("visibilitychange", visible);
    return () => {
      s.mounted = false;
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("online", wake);
      globalThis.document.removeEventListener("visibilitychange", visible);
      leave();
      if (workspaceContext.collaborationToken === s.token) {
        workspaceContext.collaborationToken = undefined;
        workspaceContext.documentId = undefined;
      }
    };
  }, [id, options.ready]);

  // Freeze only deliberate navigation/whole-document operations, never autosave.
  const perform = async (
    action: (document: any, token: string) => Promise<void>,
  ) => {
    if (operation.current) return false;
    const s = state.current;
    if (!s.active || s.paused || s.viewing) {
      opts.current.onError(
        Error("同步尚未就绪，请先重新连接；未同步内容可下载副本保存"),
      );
      return false;
    }
    operation.current = true;
    s.held = true;
    setBusy(true);
    try {
      await opts.current.bridge.invoke("setReadOnly", { value: true });
      if (!(await sync(true))) return false;
      await action(s.base, s.token);
      return true;
    } catch (e) {
      opts.current.onError(e);
      return false;
    } finally {
      s.held = false;
      operation.current = false;
      setBusy(false);
      if (s.mounted && s.active && !s.paused && !s.viewing)
        await opts.current.bridge.invoke("setReadOnly", { value: false });
    }
  };
  const back = async () => {
    const s = state.current;
    if (!s.active || s.paused || s.viewing) {
      if (opts.current.state.current.dirty || s.pending) {
        opts.current.onError(
          Error("当前修改尚未同步，请先下载副本，再重新连接或重试保存"),
        );
        return;
      }
      location.assign("/");
      return;
    }
    await perform(async (_document, token) => {
      await call("leave", { token });
      s.active = false;
      s.terminal = true;
      workspaceContext.collaborationToken = undefined;
      location.assign("/");
    });
  };
  const reconnect = async () => {
    if (operation.current || starting.current) return;
    if (
      (opts.current.state.current.dirty || state.current.pending) &&
      !confirm(
        "重新连接将加载服务器最新内容。请先下载副本备份未同步修改，确定继续？",
      )
    )
      return;
    operation.current = true;
    state.current.held = true;
    setBusy(true);
    try {
      await opts.current.bridge.invoke("setReadOnly", { value: true });
      await flight.current;
      state.current.active = false;
      setActive(false);
      state.current.terminal = false;
      await start();
    } catch (e) {
      opts.current.onError(e);
    } finally {
      operation.current = false;
      state.current.held = false;
      setBusy(false);
    }
  };
  const toggleEditing = async () => {
    if (
      operation.current ||
      starting.current ||
      !state.current.active ||
      state.current.paused
    )
      return;
    const s = state.current;
    if (!s.viewing) {
      await perform(async (_document, token) => {
        await call("leave", { token });
        s.token = "";
        workspaceContext.collaborationToken = undefined;
        s.viewing = true;
        s.preferredEditing = false;
        setViewing(true);
        opts.current.applySnapshot(
          await opts.current.bridge.invoke("collaborationMode", {
            value: false,
          }),
        );
        setMembers((old) => old.filter((m) => m.client !== s.client));
        s.lastPollAt = 0;
        setNotice("已同步");
      });
      return;
    }
    operation.current = true;
    s.held = true;
    setBusy(true);
    try {
      await flight.current;
      await start(true);
    } finally {
      operation.current = false;
      s.held = false;
      setBusy(false);
    }
  };
  const beforeNavigate = async (action: () => Promise<void>) => {
    if (state.current.viewing && !state.current.paused) {
      try {
        await action();
      } catch (e) {
        opts.current.onError(e);
      }
      return;
    }
    await perform(async () => {
      await action();
    });
  };
  return {
    active,
    paused,
    busy,
    viewing,
    toggleEditing,
    beforeNavigate,
    notice: /^(已同步|已连接)/.test(notice)
      ? opts.current.state.current.dirty
        ? "有修改 · 将自动保存"
        : viewing
          ? "已更新"
          : "已保存"
      : notice,
    noticeTitle: `服务器版本 ${state.current.base?.revision ?? "—"}`,
    members,
    refreshSharing: (settings: any) => {
      setDocument((old: any) =>
        old
          ? {
              ...old,
              visibility: settings.visibility,
              accessRevision: settings.accessRevision,
            }
          : old,
      );
      state.current.lastPollAt = 0;
    },
    document,
    denied,
    back,
    reconnect,
    editable: active && !viewing && !paused && !busy,
    ensureEditable: async () => {
      if (
        !state.current.active ||
        state.current.viewing ||
        state.current.paused ||
        operation.current
      )
        throw Error("正在连接或同步已暂停，请等待连接恢复后再修改");
    },
    perform,
    resetBase,
    save: () => sync(true),
    isDirty: (snapshot: any) =>
      !!state.current.base &&
      (!equivalentXml(snapshot.xml, state.current.base.xml) ||
        opts.current.state.current.name !== state.current.base.name),
  };
}
