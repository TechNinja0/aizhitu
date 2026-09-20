import { uuid } from "./uuid";
export class Bridge {
  pending = new Map<
    string,
    {
      resolve: (x: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    public frame: () => HTMLIFrameElement | null,
    public origin: string,
  ) {}
  receive(event: MessageEvent) {
    if (
      event.origin !== this.origin ||
      event.source !== this.frame()?.contentWindow ||
      event.data?.channel !== "diagram-workbench"
    )
      return null;
    const data = event.data;
    if (data.id) {
      const p = this.pending.get(data.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(data.id);
        data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
      }
    }
    return data;
  }
  invoke(method: string, args: unknown = {}) {
    const id = uuid();
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("画布响应超时，请保存草稿后刷新"));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.frame()?.contentWindow?.postMessage(
        { channel: "diagram-workbench", id, method, args },
        this.origin,
      );
    });
  }
  close() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("画布已关闭"));
    }
    this.pending.clear();
  }
}
