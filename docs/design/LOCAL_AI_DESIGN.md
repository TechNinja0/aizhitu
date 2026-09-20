# 本地 CLI 会话设计

日期：2026-09-18。本文扩展原文件交换设计，v1.2 同时适用于本机和局域网共享。以本文件和 `docs/LOCAL_AI.md` 为本轮实现契约，原 v1.0 文档保留历史。

## 链路

React AIChat → 已有认证的工作区 HTTP API → AIService → 固定 CLI Provider 参数 → 最终文本中的候选 XML → document-core 校验 / document-tools diff → 本地渲染预览 → editor-adapter applyCandidate(最新快照 revision) → 一次撤销事务。

截图作为 CLI 的附件传入，规范、最新图稿、选区与近 12 轮历史经 stdin 传入。CLI 不直接修改编辑器或用户文件。该路径不依赖用户另行安装 Skill；复用随包 profile 规范作为任务上下文。外部文件交换继续使用原 Skill。

## Provider

- Codex：`exec --skip-git-repo-check --ephemeral -s read-only -C <task> --json -o <answer> [-i <image>] -`，提示词通过 stdin。读取最终回答文件，不将事件流当图稿。
- Qoder：`-w <task> --tools "" --permission-mode default --no-session-persistence --max-model-request-retries 1 [--attachment <image>] -m <model> --include-partial-messages --settings '{"disableAllHooks":true}' --strict-mcp-config --mcp-config '{"mcpServers":{}}' -p -o stream-json`，提示词通过 stdin，提取结果对象 `result`。
- 不使用任何绕过权限或取消沙箱参数。模型任务不要求读写源项目。工作台将回答解析为候选文件，负责本地校验、预览及应用。
- 复用客户端已有登录与全局配置。客户端自己的扩展及日志由其管理，工作台不声明接管或隔离所有 CLI 插件。
- 执行路径为用户配置的绝对路径，或按 PATH / 常见目录发现；macOS 支持发现已安装应用内的 Codex CLI。检测时可以显示备用版本供选择，不自动更新安装。

## HTTP 接口

所有接口复用会话 Bearer token、Host / Origin 限制和 no-store。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | /api/ai/settings | 返回非敏感配置、客户端可执行性和最近验证状态，不调用模型 |
| POST | /api/ai/settings | 校验并原子保存工作台自己的配置 |
| POST | /api/ai/detect | 有时限的 --version 检查、可选已安装备用版本 |
| POST | /api/ai/test | 创建显式模型连接测试任务 |
| POST | /api/ai/generate | 捕获输入并创建候选生成任务 |
| GET | /api/ai/jobs/:id | 查询状态与候选结果 |
| DELETE | /api/ai/jobs/:id | 取消运行任务，终止 CLI 进程组 |

## 配置和生命周期

配置文件 `~/.ai-zhitu/clients.json`，目录默认 0700、文件 0600。只保存默认 Provider、各 Provider 的 path / model；不保存账号令牌。以临时文件后 rename 发布。

任务状态：共享模式 queued → running → validating → succeeded / failed / cancelled。校验失败时最多重新生成 2 次，即总共 3 次模型调用。连接/执行错误不触发图稿自动修复。连续 5 分钟无 stdout 终止，绘图任务总时限 20 分钟（修复共享预算），输出限 24 MiB；本地任务目录结束即清理。每段 stdout 重置空闲计时；事件经 JSONL 分块解析为固定词汇的阶段、文本字符数与时间，保存最近 30 条摘要。前端每秒取任务状态，用户消息在提交时立即入列，终态更新同一轮消息。raw stderr、隐藏推理与原始事件流不返回浏览器，不写持久日志。只根据已知错误模式给出版本/登录提示，其余给出受控通用错误。

一个工作台服务同时仅执行一个模型任务；共享模式运行与排队合计最多 8 个，任务读取与取消按浏览器身份隔离，设置修改只允许管理员；最多保留 30 个终态任务，一小时过期。候选和网页会话为内存态。关闭侧栏不取消，切换文档取消；网页刷新后原任务仍由服务管理到结束/超时，停止服务取消并等待进程退出。

状态“在线”需要当前 Provider / 模型近期实际响应，15 分钟后转待验证。每 15 秒的轮询只检查本地状态，不不断消耗模型额度。模型回答格式错误与 AI 不可达分别处理。设置改变会重置验证状态。

## 修改安全

输入校验文档、revision、选区、history 和附件大小/类型。AI 候选要求同一 documentId。仅选区修改要求差异属于选中对象、后代及两端均在选区内的已有边。新增选区外节点须使用全图模式。

前端必须先预览候选，应用前重新取 snapshot 比较输入 contentHash 与 documentId；适配层再同步检查最新快照 revision 与 documentId，然后在一个 mxGraphModel 事务中替换层内容，保留 root 对象身份，形成一次撤销。生成期间继续手工编辑会使旧候选不能直接覆盖。

“重新生成”仍以当前 documentId 为目标，明确标示预览后替换整图；不在后台新开文件或擅自保存。未来多页/MCP 可以复用变更层，但本轮不实现。

## 分发

命令入口 `node bin/zhitu.mjs` 自动初始化项目依赖/Chromium、启动本地服务、可选打开浏览器。默认 loopback；--lan-host、--editor-port、--data-dir 提供局域网部署，见 [共享指南](../LAN_WORKSPACE.md)。

`npm run package:local` 以明确文件清单产生源码启动包与 SHA-256 校验文件。包内不包含个人设置、密钥、任务目录或测试产物。不是自包含原生 app；使用者需要 Node 和其自己的 AI CLI。Mac .app/.dmg 签名、公证及跨架构产物另作分发阶段。

## 2026-09-18 使用可靠性补充

- GET /api/ai/jobs 返回最近任务摘要（不重复传输候选 XML），单任务查询保留 prompt/documentId/model，供用户显式接回。刷新后的候选先检查包含 metadata/geometry 的原有 contentHash，再绑定当前编辑器 revision；不以相同文件名判断是同一版本。
- /api/ai/detect 接受本次待检测路径而不持久化；保存与检测分离。
- IndexedDB 的独立 diagram-versions 数据库保存命名版本；每图 20 版、全局 40 MiB。两种候选入口应用前调用 addVersion；恢复版本使用同一 applyCandidate 事务并先备份当前画布。
- applyCandidate 临时关闭 mxGraphModel.maintainEdgeParent，保留候选中已经明确的边父级和相对几何，事务后恢复正常编辑规则。
- 直接写回依据图稿打开代次与 documentId 检查，在文件选择、校验及写入后核对，提交前发现切图就 abort。下载副本使用发送时捕获的文件名，不能更新后来打开图稿的保存状态。

## 会话和视口补充

- CLI、模型和附件入口在输入框底部，Qoder 使用明确的模型枚举，Auto 显式传 `-m Auto`；Codex 忽略历史 model 字段和请求 model，不传 `-m`。
- Qoder 单次 `--settings` 禁用 Hook，并用严格空 MCP 配置减少无关启动工作，复用登录、不改写全局设置；已对 1.1.42 实测。
- 适配器在 graph.container 捕获非 passive wheel，按指针位置缩放并限制比例。视口变化通过 viewport 事件同步工具栏；不调用图模型事务、不会增加 revision。编辑文字时保留原滚轮行为。

## v1.1 候选可靠性

预览使用独立大图窗口，先显示加载态、失败内联可重试，实际图片加载成功才允许应用；候选可直接下载。内容摘要统一使用规范化后的字体、样式与几何，不以等价序列化差异判为冲突。比较内容一致后，绑定最新快照 revision 进行应用，允许编辑后撤销回原稿，但仍防止比较/备份期间的新编辑。完整规格以 [当前技术设计](TECHNICAL_DESIGN.md) 为准。
