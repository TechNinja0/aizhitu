import { extractSource } from "../../packages/document-tools/embedded.ts";
import { compareDocuments } from "../../packages/document-tools/diff.ts";
import express from "express";
import { createServer as createHttpsServer } from "node:https";
import { AIService } from "../../packages/ai-service/index.ts";
import { randomBytes, createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { WorkspaceStore, HttpError, type Actor } from "./shared/store.ts";
import {
  publicAccountRoutes,
  privateAccountRoutes,
} from "./shared/account-routes.ts";
import { sharedRoutes } from "./shared/routes.ts";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { startEngine, editorUrl } from "./engine.ts";
import { at } from "./paths.ts";
import {
  validate,
  emptyDocument,
  LIMITS,
} from "../../packages/document-core/index.ts";
import { Renderer, checkOptions } from "../../packages/render-worker/index.ts";
import { Jobs } from "./jobs.ts";
import { TemplateStore } from "./templates.ts";
export async function startServer({
  port = 4317,
  dev = false,
  aiService,
  shared = false,
  lanHost,
  enginePort = 0,
  dataDirectory = path.join(os.homedir(), ".ai-zhitu"),
  leaseMs = 30_000,
  workbenchDirectory = at("dist/workbench"),
  tlsCert,
  tlsKey,
}: {
  port?: number;
  dev?: boolean;
  aiService?: AIService;
  shared?: boolean;
  lanHost?: string;
  enginePort?: number;
  dataDirectory?: string;
  leaseMs?: number;
  workbenchDirectory?: string;
  tlsCert?: string;
  tlsKey?: string;
} = {}) {
  if (!!tlsCert !== !!tlsKey)
    throw Error("HTTPS 需要同时指定 --tls-cert 和 --tls-key");
  const tls =
    tlsCert && tlsKey
      ? { cert: await readFile(tlsCert), key: await readFile(tlsKey) }
      : undefined;
  if (tls && dev) throw Error("HTTPS 请使用构建后的工作台，不支持 --dev");
  const version = JSON.parse(
    await readFile(at("package.json"), "utf8"),
  ).version;
  if (
    lanHost &&
    (!shared || lanHost === "0.0.0.0" || !/^[a-zA-Z0-9.-]+$/.test(lanHost))
  )
    throw Error("局域网模式需要共享工作区和有效的主机名或 IPv4 地址");
  const ai = aiService || (await new AIService(dataDirectory).init());
  ai.queueEnabled = shared;
  const workspace = shared
    ? new WorkspaceStore(dataDirectory, leaseMs)
    : undefined;
  const engine = await startEngine(
    enginePort,
    lanHost ? "0.0.0.0" : "127.0.0.1",
    lanHost,
    tls,
  );
  const renderer = new Renderer(engine.origin);
  const jobs = new Jobs(renderer);
  const templates = new TemplateStore(dataDirectory);
  if (workspace) workspace.transaction(() => {
    // Old name-only sessions could be removed on logout. Keep template-only owners recoverable too.
    const owners = templates.db.prepare("SELECT DISTINCT owner FROM templates WHERE owner<>'local-admin'").all();
    for (const owner of owners) workspace.db.prepare("INSERT OR IGNORE INTO workspace_users (id,name,createdAt) VALUES (?,?,?)").run(owner.owner, "历史模板用户", Date.now());
  });
  const app = express();
  app.disable("x-powered-by");
  const token = randomBytes(32).toString("hex");
  let origin = "";
  let publicOrigin = "";
  const aiOwners = new Map<string, { owner: string; documentId?: string }>();
  const exportOwners = new Map<
    string,
    { owner: string; contentHash: string }
  >();
  const actor = (req: any): Actor => req.actor;
  const admin = (req: any) => {
    if (!actor(req).admin)
      throw new HttpError(403, "仅管理员可以配置服务器 AI 客户端");
  };
  const ownAI = (req: any) => {
    if (shared && aiOwners.get(req.params.id)?.owner !== actor(req).id)
      throw new HttpError(404, "任务不存在或不属于当前访问者");
  };
  const vite = dev
    ? await (
        await import("vite")
      ).createServer({
        configFile: at("vite.config.ts"),
        server: { middlewareMode: true },
        appType: "custom",
      })
    : null;
  app.use((req, res, next) => {
    const origins = [origin, publicOrigin].filter(Boolean);
    if (origin && !origins.some((o) => req.headers.host === new URL(o).host))
      return void res.status(403).end();
    if (req.headers.origin && !origins.includes(req.headers.origin))
      return void res.status(403).end();
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${dev ? "ws://127.0.0.1:*" : ""}; frame-src ${engine.origin} ${lanHost ? engine.origin.replace("127.0.0.1", lanHost) : ""}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    );
    next();
  });
  app.use("/api", express.json({ limit: "28mb" }));
  if (workspace) publicAccountRoutes(app, workspace);
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const supplied = req.headers.authorization?.replace(/^Bearer /, "") || "";
    const localAdmin =
      supplied === token &&
      (!lanHost ||
        ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress || "",
        ));
    (req as any).actor = localAdmin
      ? { id: "local-admin", name: "本机管理员", admin: true }
      : workspace?.actor(supplied);
    if (!(req as any).actor)
      return void res.status(401).json({ error: "会话无效，请刷新工作台" });
    next();
  });
  if (workspace) {
    sharedRoutes(app, workspace);
    privateAccountRoutes(app, workspace, templates);
  }
  const aiRoute = (fn: (req: any) => unknown) => async (req: any, res: any) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      res
        .status(e instanceof HttpError ? e.status : 400)
        .json({ error: (e as Error).message });
    }
  };
  app.get(
    "/api/templates",
    aiRoute((req) => templates.list(actor(req).id)),
  );
  app.post(
    "/api/templates",
    aiRoute(async (req) => {
      const doc =
        typeof req.body?.xml === "string" ? validate(req.body.xml) : undefined;
      if (!doc?.ok) throw new HttpError(422, "请提供有效图稿");
      const exported = exportOwners.get(req.body.previewJobId),
        job = jobs.jobs.get(req.body.previewJobId);
      if (
        exported?.owner !== actor(req).id ||
        exported.contentHash !== doc.contentHash ||
        job?.status !== "succeeded" ||
        job.options.format !== "png" ||
        !job.result ||
        job.options.selection?.length ||
        job.options.embedSource
      )
        throw new HttpError(409, "预览与图稿不匹配或已过期，请重新生成预览");
      return templates.create(
        actor(req).id,
        req.body,
        doc.xml!,
        await readFile(job.result.path),
      );
    }),
  );
  app.patch(
    "/api/templates/:id",
    aiRoute((req) => templates.update(req.params.id, actor(req).id, req.body)),
  );
  app.delete(
    "/api/templates/:id",
    aiRoute((req) => templates.remove(req.params.id, actor(req).id)),
  );
  app.post(
    "/api/templates/:id/instantiate",
    aiRoute((req) =>
      templates.instantiate(
        req.params.id,
        actor(req).id,
        req.body?.title,
        req.body?.metadata,
      ),
    ),
  );
  app.get(
    "/api/ai/settings",
    aiRoute(async (req) => {
      const status = structuredClone(await ai.status());
      if (shared && !actor(req).admin) {
        for (const v of Object.values(status.config.providers)) v.path = "";
        for (const c of status.clients) delete (c as any).path;
      }
      return status;
    }),
  );
  app.post(
    "/api/ai/settings",
    aiRoute((req) => {
      admin(req);
      return ai.save(req.body);
    }),
  );
  app.post(
    "/api/ai/detect",
    aiRoute((req) => {
      admin(req);
      return ai.detect(req.body?.provider, req.body?.path);
    }),
  );
  app.post(
    "/api/ai/test",
    aiRoute((req) => {
      admin(req);
      const job = ai.test(req.body?.provider, req.body?.model);
      aiOwners.set(job.id, { owner: actor(req).id });
      return job;
    }),
  );
  app.post(
    "/api/ai/generate",
    aiRoute((req) => {
      const documentId = req.headers["x-document-id"];
      if (workspace && documentId) {
        workspace.requireLock(
          String(documentId),
          actor(req),
          req.headers["x-lock-token"],
        );
        workspace.xml(req.body?.xml, String(documentId));
      }
      for (const id of aiOwners.keys())
        if (!ai.jobs.has(id)) aiOwners.delete(id);
      const job = ai.generate(req.body);
      aiOwners.set(job.id, { owner: actor(req).id, documentId });
      return job;
    }),
  );
  app.get(
    "/api/ai/jobs",
    aiRoute((req) =>
      ai.list(
        (j) =>
          !shared ||
          (aiOwners.get(j.id)?.owner === actor(req).id &&
            (!req.headers["x-document-id"] ||
              aiOwners.get(j.id)?.documentId === req.headers["x-document-id"])),
      ),
    ),
  );
  app.get(
    "/api/ai/jobs/:id",
    aiRoute((req) => {
      ownAI(req);
      return ai.view(req.params.id);
    }),
  );
  app.delete(
    "/api/ai/jobs/:id",
    aiRoute((req) => {
      ownAI(req);
      return { cancelled: ai.cancel(req.params.id) };
    }),
  );
  app.post("/api/hash", (req, res) =>
    res.json({
      sha256: createHash("sha256")
        .update(Buffer.from(String(req.body?.data || ""), "base64"))
        .digest("hex"),
    }),
  );
  app.get("/api/capabilities", (_req, res) =>
    res.json({
      version,
      profile: "1.0",
      kernel: "31.4.6",
      formats: ["png", "svg", "pdf"],
      limits: LIMITS,
    }),
  );
  app.post("/api/validate", (req, res) => {
    if (typeof req.body?.xml !== "string")
      return void res.status(400).json({ error: "缺少 XML" });
    const result = validate(req.body.xml);
    res.status(result.ok ? 200 : 422).json(result);
  });
  app.post("/api/import-image", (req, res) => {
    try {
      if (
        typeof req.body?.data !== "string" ||
        req.body.data.length > 28 * 1024 * 1024
      )
        throw Error("图片无效或过大");
      res.json(extractSource(Buffer.from(req.body.data, "base64")));
    } catch (e) {
      res.status(422).json({ error: (e as Error).message });
    }
  });
  app.post("/api/diff", (req, res) => {
    try {
      if (
        typeof req.body?.baseXml !== "string" ||
        typeof req.body?.candidateXml !== "string"
      )
        throw Error("缺少原稿或候选文件");
      res.json(compareDocuments(req.body.baseXml, req.body.candidateXml));
    } catch (error) {
      res.status(422).json({ error: (error as Error).message });
    }
  });
  app.post("/api/new", (req, res) =>
    res.json(validate(emptyDocument(String(req.body?.title || "未命名图稿")))),
  );
  app.get("/api/examples/:name", async (req, res) => {
    if (!["flow", "architecture", "review"].includes(req.params.name))
      return void res.status(404).end();
    try {
      const d = validate(
        await readFile(
          at("fixtures/examples", req.params.name + ".drawio"),
          "utf8",
        ),
      );
      res.status(d.ok ? 200 : 422).json(d);
    } catch {
      res.status(404).end();
    }
  });
  app.post("/api/exports", (req, res) => {
    try {
      if (typeof req.body?.xml !== "string") throw Error("缺少 XML");
      checkOptions(req.body.options);
      const doc = validate(req.body.xml);
      if (!doc.ok) return void res.status(422).json(doc);
      for (const id of exportOwners.keys())
        if (!jobs.jobs.has(id)) exportOwners.delete(id);
      const id = jobs.add(doc.xml!, req.body.options);
      exportOwners.set(id, {
        owner: actor(req).id,
        contentHash: doc.contentHash!,
      });
      res.status(202).json({ jobId: id });
    } catch (e) {
      res
        .status((e as Error).message === "QUEUE_FULL" ? 429 : 400)
        .json({ error: (e as Error).message });
    }
  });
  app.get("/api/jobs/:id", (req, res) => {
    if (
      shared &&
      exportOwners.get(String(req.params.id))?.owner !== actor(req).id
    )
      return void res.status(404).end();
    jobs.cleanup();
    const j = jobs.jobs.get(req.params.id);
    if (!j) return void res.status(404).end();
    res.json({
      id: j.id,
      status: j.status,
      error: j.error,
      width: j.result?.width,
      height: j.result?.height,
      warnings: j.result?.warnings,
    });
  });
  app.get("/api/jobs/:id/result", (req, res) => {
    if (
      shared &&
      exportOwners.get(String(req.params.id))?.owner !== actor(req).id
    )
      return void res.status(404).end();
    const j = jobs.jobs.get(req.params.id);
    if (j?.status !== "succeeded" || !j.result)
      return void res.status(409).json({ error: "结果尚不可用" });
    res.type(j.result.mime).sendFile(j.result.path);
  });
  app.delete("/api/jobs/:id", async (req, res) => {
    if (
      shared &&
      exportOwners.get(String(req.params.id))?.owner !== actor(req).id
    )
      return void res.status(404).end();
    res.status((await jobs.cancel(String(req.params.id))) ? 204 : 404).end();
  });
  app.get("/mark.svg", (_req, res) => res.sendFile(at("assets/mark.svg")));
  app.use("/fonts", express.static(at("assets/fonts")));
  app.use("/help", express.static(at("packages/ai-support")));
  if (vite) app.use(vite.middlewares);
  else app.use(express.static(workbenchDirectory, { index: false }));
  app.get(
    ["/", "/local", "/account", "/admin/users", "/documents/:id", "/new/:id"],
    async (req, res) => {
      let html = await readFile(
        dev
          ? at("apps/workbench/index.html")
          : path.join(workbenchDirectory, "index.html"),
        "utf8",
      );
      if (vite) html = await vite.transformIndexHtml(req.originalUrl, html);
      const requestedOrigin =
        req.headers.host === new URL(origin).host ? origin : publicOrigin;
      const editorOrigin =
        requestedOrigin === origin
          ? engine.origin
          : engine.origin.replace("127.0.0.1", lanHost!);
      html = html.replace(
        "<!--BOOT-->",
        `<script>window.__BOOT__=${JSON.stringify({ token: !lanHost || (req.headers.host === new URL(origin).host && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress || "")) ? token : "", publicOrigin, shared, leaseMs, editorUrl: editorUrl(editorOrigin, requestedOrigin), editorOrigin })}</script>`,
      );
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(html);
    },
  );
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({
      error: err.type === "entity.too.large" ? "文件内容过大" : "本地请求失败",
    });
  });
  const server = await new Promise<Server>((resolve, reject) => {
    const host = lanHost ? "0.0.0.0" : "127.0.0.1";
    const s = tls
      ? createHttpsServer(tls, app).listen(port, host, () => resolve(s))
      : app.listen(port, host, () => resolve(s));
    s.on("error", reject);
  }).catch(async (error) => {
    templates.close();
    await jobs.close();
    await vite?.close();
    await new Promise<void>((resolve) => engine.server.close(() => resolve()));
    throw error;
  });
  origin = `${tls ? "https" : "http"}://127.0.0.1:${(server.address() as any).port}`;
  publicOrigin = lanHost ? origin.replace("127.0.0.1", lanHost) : origin;
  return {
    origin,
    publicOrigin,
    workspace,
    token,
    engine,
    jobs,
    server,
    close: async () => {
      templates.close();
      await ai.close();
      workspace?.close();
      await jobs.close();
      await vite?.close();
      await Promise.all([
        new Promise<void>((r) => server.close(() => r())),
        new Promise<void>((r) => engine.server.close(() => r())),
      ]);
    },
  };
}
