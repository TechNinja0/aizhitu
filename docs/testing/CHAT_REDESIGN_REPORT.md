# 会话交互、Qoder 可靠性与画布缩放验证

日期：2026-09-18。基于本机 macOS arm64、Node.js 22.22.0、Chromium 和真实 draw.io 内核。

## 本轮交付

- 输入框底部选择 CLI；Qoder 提供 Auto 和指定的 7 个模型，Codex 使用本机配置。
- 用户消息即时显示、附件名称留痕、真实阶段和生成字符数、运行耗时、停止按钮、上传/粘贴/拖入、Enter 发送与 Shift+Enter 换行。
- 候选仍需预览再应用；失败/取消保留要求及截图。会话区滚动与画布缩放分开。
- 普通滚轮以指针为中心缩放；增加放大、缩小、100% 和适应按钮，范围 10%～400%，不改变图稿内容和撤销历史。
- 保留上一轮对象查找、版本记录、候选应用前备份、刷新接回任务、保存切图保护等优化。

## Qoder 问题分析与修复

旧调用采用缓冲 JSON，页面直到结束才得到结果，同时固定 5 分钟终止。模型仍在生成时也可能被截断。旧调用还继承与绘图无关的启动 Hook/MCP；本机诊断中一次简单请求约 27 秒后才完成启动准备。

新调用使用 stream-json 与 include-partial-messages，按 stdout 活动更新空闲计时；连续 5 分钟无输出才按无响应终止，图稿生成及修复总预算 20 分钟。单次调用关闭 Hook 和外部 MCP 加载，不改写全局客户端设置。逐段事件转换为固定词汇的执行摘要和文本字符数，不回显隐藏推理、原始日志、工具参数。

本次不能原样重放用户最初的失败任务（没有保留完整失败现场），因此上述是代码和本机复测确认的缺陷及影响因素，不宣称已证明原失败只有单一原因。

## 实际执行

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 通过：构建、48 项单元测试、60 组真实浏览器检查；日志 `artifacts/chat-redesign-full-check.log` |
| `npx tsx --test tests/ai-service.test.ts` | 12 项通过，含分块事件解析、私有内容不泄露、Qoder 模型参数、Codex 不覆盖模型、活动续期与空闲/总超时 |
| `npm run test:ai-chat` | 9 组通过，含模型选择位置、消息即时显示、运行进度、候选预览/应用/撤销、旧候选保护、取消、滚轮及按钮缩放 |
| `npm run test:product-audit` | 11 组通过，含设置草稿、对象查找、版本备份恢复及容量、切图保存保护、刷新接回、截图粘贴/拖入 |
| `npx tsx scripts/ai-chat-smoke.ts qoder` | Qoder 1.1.42：Auto 真实连接与文本生成通过；日志 `artifacts/qoder-stream-smoke.log` |
| `npx tsx scripts/ai-chat-capabilities.ts qoder Qwen3.8-Flash` | 真实截图还原约 45 秒，5 节点/5 连线；随后选区修改仅产生 1 项文字变化 |
| `ZHITU_CODEX_PATH=/Applications/ChatGPT.app/Contents/Resources/codex npx tsx scripts/ai-chat-smoke.ts codex` | Codex 0.153.4：沿用本机模型，真实连接与文本生成通过 |
| `npx tsx scripts/verify-chat-artifacts.ts` | 当前 Qoder 结果及已有 Codex 截图结果均匹配 5 个标签和 5 条有向关系；本轮没有重新跑 Codex 截图生成 |
| `npm run docs:check` | 82 个 Markdown 本地链接检查通过 |
| `node scripts/package-share.mjs` 与 `node scripts/verify-local-package.mjs` | 分享包清单、独立解压、锁定依赖安装及本地启动通过，结果 `artifacts/local-package-verification.json` |

本轮最初完整检查中的一条旧测试仍查找已移除的 Codex 模型输入框，修正为 Qoder 选择后，完整检查重新运行通过。可查看 `artifacts/ai-chat-running.png` 和 `artifacts/ai-chat-ui.png` 的实际浏览器截图。

## 范围与边界

- 模型选项已由本机 `qodercli --list-models` 核实；真实请求覆盖 Auto 和 Qwen3.8-Flash，没有逐个调用其他 6 个模型。访问权限和速度取决于使用者账号与模型服务。
- 前端保留最近 12 轮消息；网页刷新通过“最近 AI 任务”接回，服务内任务保留 1 小时，服务重启不保留会话。
- 分享包包含源码、构建产物、编辑器、字体、示例和文档；不包含账号、工作台配置、测试输出。接收方需 Node.js 22.12+ 和自己的 CLI 登录。
- 分享包安装检查使用本机缓存与 Chromium；不等于另一台实体电脑或首次无缓存联网安装已验证。
