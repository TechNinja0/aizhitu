import fs from "node:fs/promises";
import path from "node:path";
const base = "node_modules/@fontsource/noto-sans-sc";
await fs.mkdir("assets/fonts/files", { recursive: true });
let css = "";
for (const weight of [400, 700]) {
  let part = await fs.readFile(`${base}/${weight}.css`, "utf8");
  part = part
    .replace(/, url\([^)]*\.woff\) format\('woff'\)/g, "")
    .replace(/font-display: swap/g, "font-display: block");
  for (const [, file] of part.matchAll(/url\(\.\/files\/([^)]*)\)/g))
    await fs.copyFile(`${base}/files/${file}`, `assets/fonts/files/${file}`);
  css += part + "\n";
}
await fs.writeFile("assets/fonts/fonts.css", css);
await fs.copyFile(`${base}/LICENSE`, "assets/fonts/LICENSE");
