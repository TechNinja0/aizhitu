import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AIService, type Provider } from "../packages/ai-service/index.ts";
import { emptyDocument } from "../packages/document-core/index.ts";
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-chat-smoke-"));
const service = await new AIService(directory).init();
if (process.env.ZHITU_CODEX_PATH)
  service.config.providers.codex.path = process.env.ZHITU_CODEX_PATH;
const results: any[] = [];
try {
  for (const provider of (process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["codex", "qoder"]) as Provider[]) {
    const detected = await service.detect(provider);
    console.log(provider, detected.version);
    const test = service.test(provider);
    await service.jobs.get(test.id)!.done;
    const health = service.view(test.id);
    console.log(provider, "connection", health.status, health.error || "");
    results.push({
      provider,
      kind: "test",
      status: health.status,
      error: health.error,
    });
    if (health.status !== "succeeded") continue;
    const task = service.generate({
      provider,
      prompt:
        "生成一个极简流程图，两个独立可编辑节点：开始、完成；从开始连接到完成。",
      xml: emptyDocument("AI 对话验证"),
      revision: 0,
      mode: "generate",
    });
    await service.jobs.get(task.id)!.done;
    const result = service.view(task.id);
    console.log(provider, "generation", result.status, result.error || "");
    results.push({
      provider,
      kind: "generation",
      status: result.status,
      error: result.error,
      changes: result.result?.changes.length,
    });
    if (result.result)
      await fs.writeFile(
        `artifacts/chat-${provider}.drawio`,
        result.result.candidateXml!,
      );
  }
  await fs.writeFile(
    "artifacts/ai-chat-smoke.json",
    JSON.stringify(results, null, 2),
  );
  if (
    results.some((r) => r.status !== "succeeded") ||
    results.length < (process.argv.slice(2).length || 2) * 2
  )
    process.exitCode = 1;
} finally {
  await service.close();
  await fs.rm(directory, { recursive: true, force: true });
}
