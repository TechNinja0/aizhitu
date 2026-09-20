#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "AI智图 · 本地启动\nnode bin/zhitu.mjs [--port 4317] [--lan-host 192.168.1.10] [--editor-port 4318] [--data-dir PATH] [--tls-cert CERT.pem --tls-key KEY.pem] [--no-open]\n首次运行自动安装项目依赖和 Chromium，需要联网。复用本机已登录 CLI。",
  );
  process.exit(0);
}
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 22)) {
  console.error("需要 Node.js 22.22 或更高版本");
  process.exit(1);
}
let port = "4317";
const extra = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") {
    port = args[++i];
    if (!/^\d+$/.test(port) || Number(port) < 0 || Number(port) > 65535)
      throw Error("端口必须为 0–65535");
  } else if (["--lan-host", "--editor-port", "--data-dir", "--tls-cert", "--tls-key"].includes(args[i])) {
    const key = args[i], value = args[++i];
    if (!value || value.startsWith("--")) throw Error(key + " 缺少参数");
    extra.push(key, value);
  } else if (args[i] !== "--no-open") throw Error("未知参数：" + args[i]);
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(file, argv) {
  const r = spawnSync(file, argv, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (r.error || r.status !== 0) {
    console.error(r.error?.message || "初始化失败");
    process.exit(r.status || 1);
  }
}
if (!existsSync(path.join(root, "node_modules/tsx/dist/loader.mjs"))) {
  console.log("首次启动：安装项目依赖…");
  run(npm, ["ci"]);
}
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
if (!existsSync(chromium.executablePath()))
  run(process.execPath, [path.join(root, "scripts/setup.mjs")]);
if (!existsSync(path.join(root, "dist/workbench/index.html")))
  run(npm, ["run", "build"]);
const child = spawn(
  process.execPath,
  [
    "--import",
    path.join(root, "node_modules/tsx/dist/loader.mjs"),
    path.join(root, "apps/local-server/main.ts"),
    "--port",
    port,
    ...extra,
    ...(args.includes("--no-open") ? [] : ["--open"]),
  ],
  { cwd: root, stdio: "inherit", shell: false },
);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
