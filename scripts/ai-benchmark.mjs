import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
const root = process.cwd(),
  client = process.argv[2] || "codex";
const dir = await fs.mkdtemp(
  path.join(os.tmpdir(), "diagram-benchmark-" + client + "-"),
);
const skill = path.join(root, "packages/ai-support/diagram-drawing");
await fs.mkdir(path.join(dir, "images"));
for (const f of await fs.readdir("fixtures/benchmark/images"))
  await fs.copyFile(
    path.join("fixtures/benchmark/images", f),
    path.join(dir, "images", f),
  );
await fs.mkdir(path.join(dir, "output"));
await fs.mkdir(
  path.join(dir, client === "codex" ? ".agents/skills" : ".qoder/skills"),
  { recursive: true },
);
await fs.symlink(
  skill,
  path.join(
    dir,
    client === "codex"
      ? ".agents/skills/diagram-drawing"
      : ".qoder/skills/diagram-drawing",
  ),
);
const prompt = `使用 diagram-drawing Skill（${skill}/SKILL.md）完成截图转可编辑图稿能力测试。images/ 中有 12 张独立截图（10 张清晰图、2 张局部模糊图）。必须实际查看每张图片，逐张按 faithful、relayout 两种模式生成 output/<图片不含扩展名>-faithful.drawio 和 output/<图片不含扩展名>-relayout.drawio，共 24 份。faithful 保留原布局，relayout 合理改善布局但不能改变文字、连接方向和关系；不要把原图作为单张图片冒充转换。模糊处明确保留待核对项，不根据其他图猜出看不清的文字。只读取本测试目录中的输入图片、Skill 和 CLI 所需资源；禁止读取工作台 fixtures、tests、其他目录的图稿或基准答案。可用一个小脚本批量输出你从图片识别的结构以提高效率，但所有内容必须来自图片。每个输出均调用实际 validate；最多三轮修复；调用 render 生成同名 PNG 并查看代表性预览；保持原图的真实端点绑定。所有生成内容仅写当前目录；不要修改软件源码、全局设置，不上传第三方网站。最后写 output/report.json（逐文件校验、修复轮次、待核对项、实际查看过的预览），明确未通过项。完成全部 24 文件后结束。`;
await fs.writeFile(path.join(dir, "request.txt"), prompt);
const args =
  client === "codex"
    ? [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "-s",
        "danger-full-access",
        "-C",
        dir,
        "--json",
        "-o",
        path.join(dir, "result.txt"),
        prompt,
      ]
    : [
        "-w",
        dir,
        "--permission-mode",
        "auto",
        "--no-session-persistence",
        "--max-model-request-retries",
        "1",
        "-p",
        prompt,
        "-o",
        "stream-json",
      ];
const binary =
  client === "codex"
    ? "/Applications/ChatGPT.app/Contents/Resources/codex"
    : client;
const info = {
  client,
  binary,
  dir,
  started: new Date().toISOString(),
  executionMode: client === "codex" ? "trusted local fixture test" : "auto",
  status: "running",
};
await fs.mkdir("artifacts/ai", { recursive: true });
await fs.writeFile(
  `artifacts/ai/${client}-benchmark.json`,
  JSON.stringify(info, null, 2),
);
console.log(JSON.stringify(info));
const log = await fs.open(path.join(dir, "events.jsonl"), "w");
const p = spawn(binary, args, { cwd: dir, stdio: ["ignore", log.fd, log.fd] });
p.on("exit", async (code) => {
  await log.close();
  info.exitCode = code;
  info.finished = new Date().toISOString();
  info.status = "finished";
  await fs.writeFile(
    path.join(root, `artifacts/ai/${client}-benchmark.json`),
    JSON.stringify(info, null, 2),
  );
  console.log(client, "exit", code, "directory", dir);
  process.exitCode = code || 0;
});
