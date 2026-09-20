import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const manifest = JSON.parse(
  await fs.readFile("vendor/drawio/manifest.json", "utf8"),
);
for (const f of manifest.files) {
  const bytes = await fs.readFile(path.join("vendor/drawio", f.path));
  if (createHash("sha256").update(bytes).digest("hex") !== f.sha256)
    throw Error("内核资源校验失败：" + f.path);
}
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 22))
  throw Error("需要 Node.js 22.22+，推荐 Node.js 24 LTS");
console.log(`draw.io ${manifest.version} 本地资源完整性检查通过`);
await fs.access("assets/fonts/fonts.css");
const result = spawnSync(
  process.execPath,
  ["node_modules/playwright/cli.js", "install", "--no-shell", "chromium"],
  { stdio: "inherit" },
);
if (result.status) process.exit(result.status);
const doctor = spawnSync(
  process.execPath,
  ["bin/diagram.mjs", "doctor", "--json"],
  { stdio: "inherit" },
);
process.exitCode = doctor.status || 0;
