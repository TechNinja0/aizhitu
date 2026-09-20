# 本地 CLI 会话交付验证

日期：2026-09-18。范围：本机 CLI 设置、会话、状态、候选预览与应用、命令启动分享。历史 v1.0 报告不替代本报告，P2 暂缓项目不计为完成。

## 自动化检查

| 实际执行命令 | 结果 |
| --- | --- |
| `npm run build` | 类型检查和生产构建通过 |
| `npm test` | 43 项通过，包含 8 项 AI 服务/进程检查 |
| `npm run test:e2e` | 原编辑/文件/导出/认证回归 17 项通过 |
| `npm run test:enhancements` | 美化、语义保留、幂等、候选应用与修订冲突相关检查 4 项通过 |
| `npm run test:ai-chat` | 会话浏览器检查 6 项通过 |
| `node bin/zhitu.mjs --help` | 帮助正确 |
| `node bin/zhitu.mjs --port 0 --no-open` | 成功启动随机 loopback 端口，SIGTERM 后停止 |
| `node scripts/check-doc-links.mjs` | 本地 Markdown 文件链接检查通过 |
| `npm run package:local` | 构建并生成约 9 MiB 分享包和 SHA-256 文件 |
| `node scripts/verify-local-package.mjs` | 独立临时目录解压、离线缓存 npm ci、启动器启动、编辑器及认证 AI API 均通过 |

AI 浏览器测试使用确定性的 CLI 替身；真实模型验证单独列于下一节，不能混为一谈。浏览器检查覆盖认证与跨站拒绝、检测和显式连接测试、最新未保存画布、预览前禁止应用、一次撤销、等待期间手工修改后的冲突拦截、取消和无运行时错误。

## 实际客户端能力

- Codex CLI **0.153.4**：本机已安装应用中的可执行文件。复用现有 `gpt-6-astra` 配置，真实连接成功。
- PATH 中旧 Codex **0.147.0**：实际失败，服务返回该模型要求新版 CLI；已增加受控版本错误提示。未升级全局 CLI，工作台设置指向已验证的新版路径。
- Qoder CLI **1.1.42**：复用默认模型配置，真实连接和简单文字生成通过。
- 两个客户端均通过一次真实截图生成和一次随后选区改稿。命令为 `npx tsx scripts/ai-chat-capabilities.ts codex`（测试时用 `ZHITU_CODEX_PATH` 指定新版）以及 `npx tsx scripts/ai-chat-capabilities.ts qoder`。
- `npx tsx scripts/verify-chat-artifacts.ts`：两个真实输出均为 5 个独立节点、5 条绑定端点的关系，中文标签、条件分支和回线方向与输入截图一致。
- 选区修改均仅产生 **1 项文字变化**，其他对象、布局、样式与连线不变。
- 使用 `node bin/diagram.mjs render --input <实际生成文件> --format png --output <预览文件> --scale 1` 分别渲染两份真实输出，成功且无警告，已查看 PNG。Codex 与 Qoder 的字体大小、颜色略有差异，不宣称像素级一致。

证据位于开发目录 `artifacts/ai-chat-*.log`、`ai-chat-e2e.json`、`chat-*-capabilities.json`、`chat-semantic-verification.json`、`chat-*-screenshot.drawio/png`。个人运行证据不打入分享包。

## 分享与边界

分享包由明确清单产生，包含运行所需源码、构建、编辑器、字体、示例、测试、文档和许可证；不含 node_modules、个人 CLI 登录、工作台设置或测试生成图稿。接收者需要 Node.js 22.12+，首次安装需要下载依赖和 Chromium。提供 `start.command` 与 `node bin/zhitu.mjs`。

分享包已在本机 macOS arm64 的独立临时目录进行全新依赖安装与启动验证，使用本机已有 npm 缓存和 Chromium；未在无缓存、首次联网下载环境或同事的另一台电脑验证。

当前不是自包含 Mac .app/.dmg，未执行 Developer ID 签名、公证或另一台实体 Mac 验证。多页、MCP、代码库入口及额外图稿类型继续暂缓。连接成功记录不是持续在线保证，UI 显示验证时间，15 分钟后转待验证。

历史 AI smoke JSON 保留旧版 Codex 失败记录；最终新版验证以本报告及 `chat-codex-capabilities.json` 为准，不删除失败证据。
