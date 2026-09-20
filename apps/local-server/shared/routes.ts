import type { Express, Request } from "express";
import { HttpError, WorkspaceStore, type Actor } from "./store.ts";

export function sharedRoutes(app: Express, store: WorkspaceStore) {
  const actor = (r: Request) => (r as any).actor as Actor;
  const route = (fn: (r: Request) => unknown) => (req: Request, res: any) => {
    try {
      res.json(fn(req));
    } catch (e) {
      res.status(e instanceof HttpError ? e.status : 500).json({
        error:
          e instanceof HttpError
            ? e.message
            : "文档操作失败，请检查服务器磁盘空间和日志",
      });
    }
  };
  app.get(
    "/api/session",
    route((r) => actor(r)),
  );
  app.patch(
    "/api/session",
    route((r) => store.rename(actor(r), r.body?.name)),
  );
  app.delete(
    "/api/session",
    route((r) => {
      store.logout(r.headers.authorization!.slice(7), actor(r));
      return { ok: true };
    }),
  );
  app.get(
    "/api/documents",
    route((r) => store.list(r.query.deleted === "1")),
  );
  app.post(
    "/api/documents",
    route((r) => store.create(r.body?.name, r.body?.xml, actor(r))),
  );
  app.get(
    "/api/documents/:id/state",
    route((r) => {
      const { xml, ...state } = store.get(String(r.params.id));
      return state;
    }),
  );
  app.get(
    "/api/documents/:id",
    route((r) => store.get(String(r.params.id))),
  );
  app.post(
    "/api/documents/:id/lock",
    route((r) => store.acquire(String(r.params.id), actor(r), r.body?.client)),
  );
  app.post(
    "/api/documents/:id/heartbeat",
    route((r) =>
      store.heartbeat(String(r.params.id), actor(r), r.body?.lockToken),
    ),
  );
  app.post(
    "/api/documents/:id/release",
    route((r) =>
      store.release(String(r.params.id), actor(r), r.body?.lockToken),
    ),
  );
  app.put(
    "/api/documents/:id",
    route((r) => store.save(String(r.params.id), r.body, actor(r))),
  );
  app.get(
    "/api/documents/:id/versions",
    route((r) => store.versions(String(r.params.id))),
  );
  app.get(
    "/api/documents/:id/versions/:revision",
    route((r) => store.version(String(r.params.id), Number(r.params.revision))),
  );
  app.post(
    "/api/documents/:id/versions/:revision/restore",
    route((r) =>
      store.restore(
        String(r.params.id),
        Number(r.params.revision),
        r.body,
        actor(r),
      ),
    ),
  );
  app.post(
    "/api/documents/:id/trash",
    route((r) => store.trash(String(r.params.id), r.body, actor(r), true)),
  );
  app.post(
    "/api/documents/:id/untrash",
    route((r) => store.trash(String(r.params.id), r.body, actor(r), false)),
  );
}
