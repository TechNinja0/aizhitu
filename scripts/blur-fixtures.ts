import { chromium } from "playwright";
import fs from "node:fs/promises";
const b = await chromium.launch({ headless: true, channel: "chromium" });
const p = await b.newPage();
for (const [base, name] of [
  ["01-flow", "11-unclear-flow"],
  ["06-architecture", "12-unclear-architecture"],
]) {
  const data = (
    await fs.readFile(`fixtures/benchmark/images/${base}.png`)
  ).toString("base64");
  await p.setContent(
    `<style>body{margin:0}img{display:block;filter:blur(5px)}</style><img src="data:image/png;base64,${data}">`,
  );
  const img = p.locator("img");
  await img.evaluate(async (e: any) => e.decode());
  const box = await img.boundingBox();
  await p.setViewportSize({
    width: Math.ceil(box!.width),
    height: Math.ceil(box!.height),
  });
  await img.screenshot({ path: `fixtures/benchmark/images/${name}.png` });
}
await b.close();
