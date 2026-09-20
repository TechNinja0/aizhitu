import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
const root = process.cwd(),
  client = process.argv[2] || "codex";
const dir = await fs.mkdtemp(
  path.join(os.tmpdir(), "diagram-ai-" + client + "-"),
);
const skill = path.join(root, "packages/ai-support/diagram-drawing");
await fs.copyFile(
  "fixtures/benchmark/images/01-flow.png",
  path.join(dir, "input.png"),
);
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
const prompt = `这是图稿工作台的真实能力测试。使用 diagram-drawing Skill（${skill}/SKILL.md），只根据提供的 input.png 识别并生成两个独立可编辑文件：faithful.drawio 忠实还原，relayout.drawio 改善排版但保持业务语义。只读取本测试目录中的图片和 Skill/CLI 所需文件；不要读取工作台 fixtures、源图稿、tests 或其他工作区资料（避免答案泄露）。必须调用实际 validate 和 render 工具，查看渲染 PNG；最多三轮修复。不要通过上传第三方服务识别。所有结果仅写入当前测试目录，输出 faithful.png 和 relayout.png。返回简短测试结论，不要修改软件代码或全局配置。`;
await fs.writeFile(path.join(dir, "request.txt"), prompt);
const args =
  client === "codex"
    ? [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "-s",
        "workspace-write",
        "-C",
        dir,
        "-i",
        path.join(dir, "input.png"),
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
        "--attachment",
        path.join(dir, "input.png"),
        "--no-session-persistence",
        "--max-model-request-retries",
        "1",
        "-p",
        prompt,
        "-o",
        "stream-json",
      ];
const info = {
  client,
  dir,
  started: new Date().toISOString(),
  args: args.filter((a) => a !== prompt),
};
await fs.mkdir("artifacts/ai", { recursive: true });
await fs.writeFile(
  `artifacts/ai/${client}-smoke.json`,
  JSON.stringify(info, null, 2),
);
console.log(JSON.stringify(info));
const log = await fs.open(path.join(dir, "events.jsonl"), "w");
const binary =
  client === "codex"
    ? "/Applications/ChatGPT.app/Contents/Resources/codex"
    : client;
const p = spawn(binary, args, { cwd: dir, stdio: ["ignore", log.fd, log.fd] });
p.on("exit", async (code) => {
  await log.close();
  info.exitCode = code;
  info.finished = new Date().toISOString();
  await fs.writeFile(
    path.join(root, `artifacts/ai/${client}-smoke.json`),
    JSON.stringify(info, null, 2),
  );
  console.log(client, "exit", code, "directory", dir);
  process.exitCode = code || 0;
});
