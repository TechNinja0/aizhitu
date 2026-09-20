import type { Express, Request, Response } from "express";
import { HttpError, type WorkspaceStore, type Actor } from "./store.ts";
import type { TemplateStore } from "../templates.ts";
const actor = (r: Request) => (r as any).actor as Actor;
const route =
  (fn: (r: Request) => unknown) => async (r: Request, res: Response) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await fn(r));
    } catch (e) {
      res.status(e instanceof HttpError ? e.status : 500).json({
        error: e instanceof HttpError ? e.message : "账号操作失败，请稍后重试",
      });
    }
  };
function credentialLimiter() {
  const attempts = new Map<string, { count: number; until: number }>();
  const limit = (req: Request, res: Response, next: () => void) => {
    const now = Date.now(),
      ip = req.socket.remoteAddress || "unknown";
    for (const [key, entry] of attempts)
      if (entry.until <= now) attempts.delete(key);
    const key = ip + ":" + req.path;
    const entry = attempts.get(key) || { count: 0, until: now + 60000 };
    if (++entry.count > 10) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "尝试次数过多，请一分钟后重试" });
      return;
    }
    attempts.set(key, entry);
    next();
  };
  return limit;
}
export function publicAccountRoutes(app: Express, store: WorkspaceStore) {
  const limit = credentialLimiter();
  // Retain the old login URL for clients, but name alone can no longer create identities.
  app.post(
    ["/api/session", "/api/auth/login"],
    limit,
    route((r) => store.accounts.login(r.body)),
  );
  app.post(
    "/api/auth/register",
    limit,
    route((r) => store.accounts.register(r.body)),
  );
  app.post(
    "/api/auth/reset",
    limit,
    route((r) => store.accounts.redeem(r.body)),
  );
}
export function privateAccountRoutes(
  app: Express,
  store: WorkspaceStore,
  templates: TemplateStore,
) {
  const limit = credentialLimiter();
  app.post(
    "/api/account/setup",
    limit,
    route((r) => store.accounts.setup(actor(r), r.body)),
  );
  app.post(
    "/api/account/password",
    limit,
    route((r) => store.accounts.changePassword(actor(r), r.body)),
  );
  app.get(
    "/api/admin/users",
    route((r) =>
      store.accounts.list(actor(r)).map((u) => ({
        ...u,
        templates: Number(
          templates.db
            .prepare("SELECT count(*) count FROM templates WHERE owner=?")
            .get(u.id)!.count,
        ),
      })),
    ),
  );
  app.post(
    "/api/admin/users",
    route((r) => store.accounts.create(actor(r), r.body)),
  );
  app.post(
    "/api/admin/users/:id/reset",
    route((r) => store.accounts.reset(actor(r), String(r.params.id), r.body)),
  );
  app.patch(
    "/api/admin/users/:id",
    route((r) => store.accounts.status(actor(r), String(r.params.id), r.body)),
  );
  app.post(
    "/api/admin/users/:id/transfer",
    route((r) =>
      store.accounts.transfer(actor(r), String(r.params.id), r.body),
    ),
  );
  app.delete(
    "/api/admin/users/:id",
    route((r) =>
      store.accounts.remove(
        actor(r),
        String(r.params.id),
        r.body,
        Number(
          templates.db
            .prepare("SELECT count(*) count FROM templates WHERE owner=?")
            .get(String(r.params.id))!.count,
        ),
      ),
    ),
  );
}
