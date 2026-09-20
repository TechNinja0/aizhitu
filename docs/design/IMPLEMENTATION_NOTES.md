# 实施细节与设计收敛

日期：2026-09-18。以下是 G0 实测后确定的实现细节，保持 PRD 首版范围。

| 项目 | 最终实现 | 原因与证据位置 |
| --- | --- | --- |
| 内核版本 | draw.io 31.4.6；版本、原始文件 SHA-256 和来源记录在 vendor/drawio/manifest.json | 本地嵌入、编辑、文件往返、导出实测 |
| 启动适配 | 本地 bootstrap＋窄接口，禁用上游广泛的 embed 命令处理器 | 避免任意内核方法调用；只接收固定 origin 和指定 iframe 的工作台消息 |
| 元数据存储 | 根 cell 0 的 object.dw_meta，承载 profileVersion/documentId/generationMode/reviewItems/source/provenance | 通过真实内核 codec 保存重开，文字编辑和核对状态可一起撤销 |
| 会话令牌 | 本机服务把令牌注入不缓存的工作台 HTML，前端仅保存在内存 | 页面刷新可重新获得会话；不把令牌留在 URL、日志或持久存储 |
| 浏览器内核 | Playwright 1.63.0 的完整 Chromium，使用 channel=chromium | 同一内核用于 CLI、服务导出和自动化验证；setup 只安装所需完整 Chromium |
| Node | 推荐 24 LTS，同时支持 22.12+ | 完整检查在 Node 24.19.0 通过，Node 22.22.0 的构建与核心链路也已实测；不强制修改用户全局 Node |
| 任务结果 | 受控临时目录，随机任务名，文件权限 0600，10 分钟到期；关闭服务清理 | 避免已完成的导出长期占用大量内存 |
| 默认资源 | 仅内置基础 mxGraph 图形与本地 Noto Sans SC 字体，未加载额外图标/模板/ELK/Mermaid 包 | 支持明确的首版子集并消除运行时外部依赖 |
| 源文件保存 | 浏览器完整副本下载 | 不把下载触发冒充已覆盖磁盘原文件；直接写回为 P1 |

## 实际接口

工作台使用 `{channel:"diagram-workbench",id,method,args}`，响应返回相同 id 和 result/error。事件为 ready/changed/selection/saveRequested/deleteRequested。所有入站与出站匹配当前父窗口与精确 origin。

适配器方法为 `capabilities / load / snapshot / focus / review / action / preset / image / deleteSelection / svg`。`action` 只接收固定编辑命令列表；没有 eval、通用函数名调用、任意文件读写或外链加载接口。

HTTP 接口保持技术设计约定，另加 `/api/new` 和固定名称的 `/api/examples/:name`。导出结果通过经过认证的结果接口发送，用户不能指定服务端文件路径。CLI 始终接受显式本地输入/输出路径。

## 检查方法

- 文档和队列：`npm test`。
- 浏览器编辑及文件闭环：`npm run test:e2e`；原生连线端点/折点拖动、图形库、嵌套分组：`npm run test:interactions`。
- PNG/JPEG 实际嵌入与三格式导出：`npm run test:images`。
- 100 步撤销、删除关联边、锁定、真实导出、中文 PDF、性能：`npm run test:capabilities`。
- 模型生成准确性：单独运行 AI 截图测试并按基准评分，保留产物；不得用格式合法替代识别准确性。

设计文档中的示意 API 名称和元数据逻辑层级，以本文最终映射和实际类型声明为准；不会再引入并行的权威 JSON 图稿文件。
