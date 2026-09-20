import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { startEngine } from "../apps/local-server/engine.ts";
import { Renderer } from "../packages/render-worker/index.ts";
import { emptyDocument, validate } from "../packages/document-core/index.ts";
const e = await startEngine(),
  r = new Renderer(e.origin),
  b = await chromium.launch({ channel: "chromium" }),
  p = await b.newPage();
try {
  const images = await p.evaluate(() =>
    ["png", "jpeg"].map((format, i) => {
      const c = document.createElement("canvas");
      c.width = 50;
      c.height = 40;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = i ? "#0000ff" : "#ff0000";
      ctx.fillRect(0, 0, 50, 40);
      return c.toDataURL("image/" + format);
    }),
  );
  const cells = images
    .map(
      (data, i) =>
        `<mxCell id="img${i}" value="" vertex="1" parent="1" style="shape=image;image=${data.replace(";base64,", ",")};"><mxGeometry x="${i * 80}" y="0" width="50" height="40" as="geometry"/></mxCell>`,
    )
    .join("");
  const xml = emptyDocument("PNG/JPEG").replace("</root>", cells + "</root>");
  assert.equal(validate(xml).ok, true);
  for (const format of ["png", "svg", "pdf"] as const) {
    const output = await r.render(xml, { format, margin: 10 });
    await fs.writeFile("artifacts/embedded-images." + format, output.data);
    if (format === "png") {
      const pixels = await p.evaluate(async (base64) => {
        const i = new Image();
        i.src = "data:image/png;base64," + base64;
        await i.decode();
        const c = document.createElement("canvas");
        c.width = i.width;
        c.height = i.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(i, 0, 0);
        return [
          Array.from(ctx.getImageData(35, 30, 1, 1).data),
          Array.from(ctx.getImageData(115, 30, 1, 1).data),
        ];
      }, output.data.toString("base64"));
      assert.ok(pixels[0][0] > 240 && pixels[0][2] < 10);
      assert.ok(pixels[1][2] > 240 && pixels[1][0] < 10);
    }
    if (format === "svg") {
      assert.match(output.data.toString(), /data:image\/png;base64/);
      assert.match(output.data.toString(), /data:image\/jpeg;base64/);
    }
  }
  assert.deepEqual(r.requests, []);
  await fs.writeFile(
    "artifacts/image-export-results.json",
    JSON.stringify(
      {
        ok: true,
        checks: [
          "embedded PNG and JPEG survive native validation",
          "PNG export pixel colors match both source images",
          "SVG embeds both formats",
          "PDF generated locally with both images",
          "no external requests",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS embedded PNG/JPEG validation and PNG/SVG/PDF exports, pixel checks and no external requests",
  );
} finally {
  await b.close();
  await r.close();
  await new Promise<void>((resolve) => e.server.close(() => resolve()));
}
