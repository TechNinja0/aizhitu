import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Check repository-local Markdown link targets, not remote URLs or heading anchors.
const root = fileURLToPath(new URL("../", import.meta.url));
const ignored = new Set([
  "node_modules", "vendor", "dist", "artifacts", "output", "coverage",
  "playwright-report", "test-results",
]);
async function markdownFiles(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ignored.has(entry.name)) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
  return files;
}
let count = 0;
const missing = [];
for (const file of await markdownFiles(root)) {
  const content = (await fs.readFile(file, "utf8")).replace(/```[^]*?```/g, "");
  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const url = match[1].replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) continue;
    const relative = decodeURIComponent(url.split(/[?#]/)[0]);
    if (!relative) continue;
    count++;
    try { await fs.access(path.resolve(path.dirname(file), relative)); }
    catch { missing.push(`${path.relative(root, file)} -> ${relative}`); }
  }
}
if (missing.length) {
  console.error(missing.join("\n"));
  process.exitCode = 1;
} else console.log(`通过：${count} 个 Markdown 本地链接目标存在（不检查网络链接与标题锚点）。`);
