import express from "express";
import { createServer as createHttpsServer } from "node:https";
import type { Server } from "node:http";
import { at } from "./paths.ts";
export async function startEngine(
  port = 0,
  host = "127.0.0.1",
  publicHost = "127.0.0.1",
  tls?: { cert: Buffer; key: Buffer },
): Promise<{ server: Server; origin: string }> {
  const app = express();
  let origin = "";
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (
      origin &&
      ![new URL(origin).host, `${publicHost}:${new URL(origin).port}`].includes(
        req.headers.host || "",
      )
    )
      return void res.status(403).end();
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'",
    );
    next();
  });
  app.get("/render.html", (_req, res) =>
    res
      .type("html")
      .send(
        '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
      ),
  );
  app.get("/", (_req, res) =>
    res.sendFile(at("packages/editor-adapter/index.html")),
  );
  app.get("/js/PreConfig.js", (_req, res) =>
    res.sendFile(at("packages/editor-adapter/PreConfig.js")),
  );
  app.get("/js/PostConfig.js", (_req, res) =>
    res.type("js").send("/* no remote plugins */"),
  );
  app.get("/themes.js", (_req, res) =>
    res.sendFile(at("packages/editor-adapter/themes.js")),
  );
  app.get("/beautify.js", (_req, res) =>
    res.sendFile(at("packages/editor-adapter/beautify.js")),
  );
  app.get("/adapter.js", (_req, res) =>
    res.sendFile(at("packages/editor-adapter/adapter.js")),
  );
  app.get("/adapter.css", (_req, res) =>
    res.sendFile(at("packages/editor-adapter/adapter.css")),
  );
  app.get("/mark.svg", (_req, res) => res.sendFile(at("assets/mark.svg")));
  app.use("/fonts", express.static(at("assets/fonts")));
  app.use(
    express.static(at("vendor/drawio"), { index: false, dotfiles: "deny" }),
  );
  app.use((_req, res) => res.status(404).end());
  const server = await new Promise<Server>((resolve, reject) => {
    const s = tls
      ? createHttpsServer(tls, app).listen(port, host, () => resolve(s))
      : app.listen(port, host, () => resolve(s));
    s.on("error", reject);
  });
  origin = `${tls ? "https" : "http"}://127.0.0.1:${(server.address() as any).port}`;
  return { server, origin };
}
export const editorUrl = (origin: string, parentOrigin = origin) =>
  `${origin}/?embed=1&proto=json&lang=zh&ui=kennedy&offline=1&stealth=1&local=1&noSaveBtn=1&saveAndExit=0&noExitBtn=1&spin=1&libraries=0&gapi=0&db=0&od=0&tr=0&gh=0&gl=0&browser=0&plugins=0&pages=0&parentOrigin=${encodeURIComponent(parentOrigin)}`;
