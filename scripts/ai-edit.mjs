import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
const root = process.cwd(),
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "diagram-ai-edit-"));
await fs.copyFile(
  "fixtures/examples/flow.drawio",
  path.join(dir, "original.drawio"),
);
const skill = path.join(root, "packages/ai-support/diagram-drawing");
const cases = [
  ["rename", "仅把 check 的文字改成“完整性校验”"],
  ["style", "仅将 fix 的 fillColor 改为 #fff0cc"],
  ["reverse", "仅把 f5 的 source 改为 check、target 改为 fix，保留标签和折点"],
  ["move", "仅把 fix 的 x 改为 500、y 改为 320"],
  [
    "add",
    "新增节点 audit，文字“人工复核”，x=450,y=445,width=150,height=60；新增绑定边 audit-edge 从 approved 指向 audit；原有对象不变",
  ],
];
const prompt = `按 ${skill}/SKILL.md 使用图稿 Skill 对 original.drawio 做五个独立局部改稿，每个都从 original 开始：${JSON.stringify(cases)}。输出 <案例名>.drawio 与同名 PNG，通过实际 CLI validate 和 render，并查看至少一个预览。保持全部未涉及对象的 ID、文字、样式、几何及折点不变，原文件不覆盖。每个变更输出包含输入 SHA-256 的摘要，汇总 summary.json。只读当前目录和 Skill/CLI 必要资源，不读其他测试或基准，不修改源码和全局配置。`;
await fs.writeFile(path.join(dir, "request.txt"), prompt);
const meta = { dir, started: new Date().toISOString(), status: "running" };
await fs.writeFile("artifacts/ai/edit.json", JSON.stringify(meta, null, 2));
console.log(meta);
const log = await fs.open(path.join(dir, "events.jsonl"), "w");
const child = spawn(
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  [
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
  ],
  { cwd: dir, stdio: ["ignore", log.fd, log.fd] },
);
child.on("exit", async (code) => {
  await log.close();
  await fs.writeFile(
    path.join(root, "artifacts/ai/edit.json"),
    JSON.stringify(
      {
        ...meta,
        status: "finished",
        exitCode: code,
        finished: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log("exit", code);
  process.exitCode = code || 0;
});
