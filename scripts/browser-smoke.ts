import { chromium } from "playwright";
const b = await chromium.launch({ headless: true, channel: "chromium" }),
  p = await b.newPage({ viewport: { width: 1512, height: 982 } });
p.on("console", (m) => {
  if (["error", "warning"].includes(m.type())) console.log("CONSOLE", m.text());
});
p.on("pageerror", (e) => console.log("ERROR", e.message));
p.on("response", (r) => {
  if (r.status() >= 400) console.log("HTTP", r.status(), r.url());
});
try {
  await p.goto("http://127.0.0.1:4317");
  await p.waitForTimeout(3000);
  console.log((await p.locator("body").innerText()).slice(0, 2200));
  console.log(
    "FRAMES",
    p.frames().map((f) => f.url()),
  );
  await p.screenshot({ path: "artifacts/workbench.png", fullPage: true });
} finally {
  await b.close();
}
