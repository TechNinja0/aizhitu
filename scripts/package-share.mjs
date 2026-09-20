import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const stage = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-share-"));
const name = "ai-zhitu-local";
try {
  await fs.mkdir(path.join(stage, name));
  // Explicit allowlist: never package user settings, credentials, task data or artifacts.
  for (const item of [
    "apps",
    "packages",
    "assets",
    "vendor",
    "dist/workbench",
    "fixtures",
    "tests",
    "licenses",
    "bin",
    "scripts",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    ".nvmrc",
    ".gitignore",
    "README.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "SECURITY.md",
    "start.command",
    "docs",
    "CHANGELOG.md",
    ".github",
  ]) {
    const target = path.join(stage, name, item);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(path.join(root, item), target, { recursive: true, filter: source => !(/\.sqlite(?:-wal|-shm)?$/.test(source) || path.basename(source) === "clients.json") });
  }
  await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
  const dest = path.join(root, "artifacts", name + ".tar.gz");
  const result = spawnSync("tar", ["-czf", dest, "-C", stage, name], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw Error("打包失败");
  const hash = createHash("sha256")
    .update(await fs.readFile(dest))
    .digest("hex");
  await fs.writeFile(
    dest + ".sha256",
    hash + "  " + path.basename(dest) + "\n",
  );
  console.log(dest + "\nSHA-256 " + hash);
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
