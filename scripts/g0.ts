import { chromium } from "playwright";
import { startEngine, editorUrl } from "../apps/local-server/engine.ts";
import { emptyDocument, validate } from "../packages/document-core/index.ts";
import { writeFile, mkdir } from "node:fs/promises";
const e = await startEngine();
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.error("CONSOLE", m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) console.log("HTTP", r.status(), r.url());
});
page.on("dialog", (d) => {
  console.error("DIALOG", d.message());
  void d.dismiss();
});
try {
  await page.goto(editorUrl(e.origin));
  await page.waitForFunction(
    () => !!(window as any).workbench,
    {},
    { timeout: 25000 },
  );
  const result = await page.evaluate(
    async (xml) => {
      await (window as any).workbench.invoke("load", { xml });
      return (window as any).workbench.invoke("snapshot");
    },
    await (
      await import("node:fs/promises")
    ).readFile("fixtures/examples/review.drawio", "utf8"),
  );
  console.log("G0 META", result.metadata, "VALID", validate(result.xml).errors);
  await page.waitForTimeout(500);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/g0.png" });
  await writeFile("artifacts/g0.drawio", result.xml);
} finally {
  await browser.close();
  e.server.close();
}
