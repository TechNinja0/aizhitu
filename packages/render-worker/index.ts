import {embedSource} from "../document-tools/embedded.ts";
import { chromium, type Browser, type Page } from "playwright";
import fs from "node:fs/promises";
import { validate, LIMITS } from "../document-core/index.ts";
import { editorUrl } from "../../apps/local-server/engine.ts";
import { at } from "../../apps/local-server/paths.ts";
export type ExportOptions = {
  format: "png" | "svg" | "pdf";
  scale?: number;
  background?: string;
  margin?: number;
  selection?: string[];
  embedSource?: boolean;
};
export class RenderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fontCache = new Map<string, string>();
let fontCss = "";
async function embeddedFonts(text: string) {
  if (!fontCss)
    fontCss = await fs.readFile(at("assets/fonts/fonts.css"), "utf8");
  const points = new Set(Array.from(text).map((c) => c.codePointAt(0)!));
  const blocks = fontCss.match(/@font-face\s*\{[^}]+\}/g) || [];
  const used = blocks.filter((b) => {
    const ranges = (b.match(/unicode-range:\s*([^;]+)/) || [])[1];
    if (!ranges) return true;
    return ranges.split(",").some((r) => {
      const [a, z] = r
        .trim()
        .replace(/^U\+/i, "")
        .split("-")
        .map((s) => parseInt(s, 16));
      return [...points].some((p) => p >= a && p <= (z || a));
    });
  });
  return (
    await Promise.all(
      used.map(async (b) => {
        const file = (b.match(/url\(\.\/files\/([^)]*)\)/) || [])[1];
        if (!file) return b;
        if (!fontCache.has(file))
          fontCache.set(
            file,
            (await fs.readFile(at("assets/fonts/files", file))).toString(
              "base64",
            ),
          );
        return b.replace(
          /url\([^)]*\)/,
          `url(data:font/woff2;base64,${fontCache.get(file)})`,
        );
      }),
    )
  ).join("\n");
}
export function checkOptions(options: ExportOptions) {
  if(options.embedSource && (options.format==="pdf" || options.selection?.length))throw new RenderError("EMBED_SCOPE_INVALID", "源图稿嵌入仅支持整图 PNG/SVG，避免选区导出泄露未选内容");
  if (!["png", "svg", "pdf"].includes(options.format))
    throw new RenderError("FORMAT_INVALID", "不支持导出格式");
  if (options.scale !== undefined && ![1, 2, 3].includes(options.scale))
    throw new RenderError("SCALE_INVALID", "倍率必须为 1、2 或 3");
  if (
    options.margin !== undefined &&
    (!Number.isFinite(options.margin) ||
      options.margin < 0 ||
      options.margin > 200)
  )
    throw new RenderError("MARGIN_INVALID", "边距应在 0～200 之间");
  if (
    options.background !== undefined &&
    options.background !== "transparent" &&
    !/^#[0-9a-f]{6}$/i.test(options.background)
  )
    throw new RenderError(
      "BACKGROUND_INVALID",
      "背景需为十六进制颜色或 transparent",
    );
  if (
    options.selection !== undefined &&
    (!Array.isArray(options.selection) ||
      options.selection.length > LIMITS.objects ||
      !options.selection.every((x) => typeof x === "string"))
  )
    throw new RenderError("SELECTION_INVALID", "选区无效");
  if (options.format === "pdf" && options.selection?.length)
    throw new RenderError("SELECTION_INVALID", "首版 PDF 导出整图");
}
export class Renderer {
  epoch = 0;
  browser?: Browser;
  page?: Page;
  outputPage?: Page;
  requests: string[] = [];
  constructor(public origin: string) {}
  async ready() {
    if (this.page && !this.page.isClosed()) return;
    const epoch = this.epoch;
    if (!this.browser) {
      const browser = await chromium.launch({
        headless: true,
        channel: "chromium",
      });
      if (epoch !== this.epoch) {
        await browser.close();
        throw new RenderError("CANCELLED", "渲染已取消");
      }
      this.browser = browser;
    }
    const context = await this.browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (
        url.startsWith(this.origin + "/") ||
        url.startsWith("data:") ||
        url.startsWith("blob:")
      )
        return route.continue();
      this.requests.push(url);
      return route.abort();
    });
    this.page = await context.newPage();
    this.page.on("dialog", (d) => void d.dismiss());
    await this.page.goto(editorUrl(this.origin), { timeout: 25000 });
    await this.page.waitForFunction(
      () => !!(window as any).workbench,
      {},
      { timeout: 25000 },
    );
    this.outputPage = await context.newPage();
    await this.outputPage.goto(this.origin + "/render.html");
  }
  async render(
    xml: string,
    options: ExportOptions,
  ): Promise<{
    data: Buffer;
    width: number;
    height: number;
    mime: string;
    warnings: unknown[];
  }> {
    checkOptions(options);
    const doc = validate(xml);
    if (!doc.ok)
      throw new RenderError("DOCUMENT_INVALID", JSON.stringify(doc.errors));
    if (
      options.selection?.some(
        (id) =>
          !doc.cells!.some(
            (c) => c.id === id && (c.kind === "node" || c.kind === "edge"),
          ),
      )
    )
      throw new RenderError("SELECTION_INVALID", "选中对象不存在");
    await this.ready();
    const page = this.page!;
    const result = await page.evaluate(
      async ({ xml, options }) => {
        const api = (window as any).workbench;
        await api.invoke("load", { xml });
        await document.fonts.ready;
        await Promise.all(
          Array.from(document.images).map((i) => i.decode().catch(() => {})),
        );
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        return api.invoke("svg", options);
      },
      { xml: doc.xml!, options },
    );
    const { width, height } = result;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      throw new RenderError("RENDER_INVALID", "导出边界无效");
    const scale = options.format === "png" ? options.scale || 1 : 1;
    if (
      (options.format === "png" &&
        (width * scale > LIMITS.pngSide ||
          height * scale > LIMITS.pngSide ||
          width * height * scale * scale > LIMITS.pngPixels)) ||
      (options.format === "pdf" &&
        (width > LIMITS.pdfSide || height > LIMITS.pdfSide))
    )
      throw new RenderError(
        "EXPORT_TOO_LARGE",
        "导出尺寸超限，请缩小选区、边距或倍率",
      );
    const css = await embeddedFonts(doc.cells!.map((c) => c.label).join(""));
    let svg: string = result.svg;
    svg = svg.replace(/<a\b[^>]*>/g, "<g>").replace(/<\/a>/g, "</g>");
    svg = svg.replace(
      /<svg\b([^>]*)>/,
      `<svg$1><defs><style type="text/css"><![CDATA[${css}]]></style></defs>`,
    );
    if (options.format === "svg")
      return {
        data: options.embedSource ? embedSource(Buffer.from(svg), "svg", doc.xml!) : Buffer.from(svg),
        width,
        height,
        mime: "image/svg+xml",
        warnings: doc.warnings,
      };
    const out = this.outputPage!;
    await out.setViewportSize({
      width: Math.ceil(width * scale),
      height: Math.ceil(height * scale),
    });
    await out.setContent(
      `<!doctype html><html><head><style>${css}html,body{margin:0;padding:0;background:transparent;-webkit-print-color-adjust:exact;print-color-adjust:exact}body>svg{display:block;width:${width * scale}px;height:${height * scale}px}@page{size:${width}px ${height}px;margin:0}</style></head><body>${svg}</body></html>`,
    );
    await out.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((i) => i.decode()));
    });
    const data =
      options.format === "png"
        ? await out.screenshot({
            type: "png",
            omitBackground: options.background === "transparent",
          })
        : await out.pdf({
            width: `${width}px`,
            height: `${height}px`,
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
          });
    return {
      data: options.embedSource ? embedSource(data,"png",doc.xml!) : data,
      width: width * scale,
      height: height * scale,
      mime: options.format === "png" ? "image/png" : "application/pdf",
      warnings: doc.warnings,
    };
  }
  async reset() {
    this.epoch++;
    const browser = this.browser;
    this.browser = undefined;
    this.page = undefined;
    this.outputPage = undefined;
    await browser?.close();
  }
  async close() {
    await this.reset();
  }
}
