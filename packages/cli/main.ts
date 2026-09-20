import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { validate } from "../document-core/index.ts";
import { Renderer, type ExportOptions } from "../render-worker/index.ts";
import { startEngine } from "../../apps/local-server/engine.ts";
import { at } from "../../apps/local-server/paths.ts";
const args = process.argv.slice(2),
  command = args[0];
const value = (key: string) => {
  const i = args.indexOf("--" + key);
  return i < 0 ? undefined : args[i + 1];
};
const emit = (data: unknown) => console.log(JSON.stringify(data, null, 2));
async function main() {
  if (command === "doctor") {
    const checks = {
      node: Number(process.versions.node.split(".")[0]) >= 22,
      editor: existsSync(at("vendor/drawio/js/app.min.js")),
      fonts: existsSync(at("assets/fonts/fonts.css")),
      chromium: existsSync(chromium.executablePath()),
    };
    try {
      const probe = await startEngine();
      await new Promise<void>((r) => probe.server.close(() => r()));
      (checks as any).loopback = true;
    } catch {
      (checks as any).loopback = false;
    }
    emit({
      ok: Object.values(checks).every(Boolean),
      version: JSON.parse(await fs.readFile(at("package.json"), "utf8")).version,
      profileVersion: "1.0",
      kernel: "31.4.6",
      node: process.version,
      chromium: chromium.executablePath(),
      checks,
      clientRequirements: [
        "模型支持图片输入",
        "客户端可读写指定目录",
        "客户端允许执行 diagram CLI",
      ],
      note: "工具自检不代替客户端视觉与 Skill 发现能力测试",
    });
    if (!Object.values(checks).every(Boolean)) process.exitCode = 3;
    return;
  }
  if (args.includes("--help") || !["validate", "render"].includes(command)) {
    console.log(
      "diagram doctor --json\ndiagram validate --input file.drawio --json\ndiagram render --input file.drawio --format png|svg|pdf --output result.png [--scale 1|2|3] [--margin 20] [--background transparent|#ffffff] [--selection id1,id2]",
    );
    process.exitCode =
      command && command !== "--help" && !args.includes("--help") ? 2 : 0;
    return;
  }
  const input = value("input");
  if (!input) throw Object.assign(Error("缺少 --input"), { exitCode: 2 });
  const stat = await fs.stat(input);
  if (stat.size > 20 * 1024 * 1024)
    throw Object.assign(Error("文件超过 20 MiB"), { exitCode: 2 });
  const xml = await fs.readFile(input, "utf8"),
    diagnostic = validate(xml);
  if (command === "validate") {
    const { xml: _, cells: __, ...report } = diagnostic;
    emit(report);
    if (!diagnostic.ok) process.exitCode = 2;
    return;
  }
  if (!diagnostic.ok) {
    emit(diagnostic);
    process.exitCode = 2;
    return;
  }
  const output = value("output");
  if (!output) throw Object.assign(Error("缺少 --output"), { exitCode: 2 });
  if (path.resolve(input) === path.resolve(output))
    throw Object.assign(Error("导出路径不能等于源文件路径"), { exitCode: 5 });
  // Existence is checked both here and atomically during publication; no overwrite race.
  if (existsSync(output))
    throw Object.assign(Error("输出文件已存在，请选择新文件名"), {
      exitCode: 5,
    });
  const options: ExportOptions = {
    format: value("format") as ExportOptions["format"],
    scale: Number(value("scale") || 1),
    margin: Number(value("margin") || 20),
    background: value("background") || "#ffffff",
    selection: value("selection")?.split(","),
  };
  const engine = await startEngine(),
    renderer = new Renderer(engine.origin);
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      renderer.render(diagnostic.xml!, options),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(Error("渲染超过 30 秒"), { exitCode: 4 })),
          30000,
        );
      }),
    ]);
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    const temp = path.resolve(
      path.dirname(output),
      ".diagram-" + randomUUID() + ".tmp",
    );
    try {
      await fs.writeFile(temp, result.data, { flag: "wx" });
      await fs.link(temp, output);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
    emit({
      ok: true,
      output: path.resolve(output),
      format: options.format,
      width: result.width,
      height: result.height,
      warnings: result.warnings,
    });
  } catch (e) {
    throw Object.assign(e as Error, {
      exitCode: (e as any).exitCode || ((e as any).code === "EEXIST" ? 5 : 4),
    });
  } finally {
    clearTimeout(timer);
    await renderer.close();
    await new Promise<void>((r) => engine.server.close(() => r()));
  }
}
main().catch((e) => {
  emit({ ok: false, error: e.message, code: e.code || "CLI_ERROR" });
  process.exitCode =
    e.exitCode || (["EPERM", "EACCES", "EADDRINUSE"].includes(e.code) ? 3 : 5);
});
