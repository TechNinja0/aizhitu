#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const child = spawn(
  process.execPath,
  [
    "--import",
    fileURLToPath(new URL("node_modules/tsx/dist/loader.mjs", root)),
    fileURLToPath(new URL("packages/cli/main.ts", root)),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
