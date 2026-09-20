# AI智图 · 技术设计

版本：1.2.1 · 更新：2026-09-20。对应 [当前产品规格](../product/PRD.md)。详细 CLI 契约见 [LOCAL_AI_DESIGN.md](LOCAL_AI_DESIGN.md)，历史接口说明见 [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md)。

## 架构

```text
浏览器 React 工作台
  ├─ 独立 origin 的 draw.io 31.4.6 + editor-adapter
  ├─ IndexedDB 草稿/版本 + localStorage 最近颜色
  └─ 带会话认证的本地 HTTP API
       ├─ WorkspaceStore：SQLite 文档/版本/身份/租约 → 文件列表与独立文档 URL
       ├─ document-core：校验、规范化、内容身份
       ├─ document-tools：差异、图片源文件嵌入/提取
       ├─ render-worker：同版本内核 + Chromium，PNG/SVG/PDF
       └─ AIService：固定 Provider 参数 → 本机 Codex/Qoder CLI
```

Node.js 最低 22.22；依赖和上游资源固定版本。默认监听 127.0.0.1；显式 --lan-host 后两个服务监听 0.0.0.0，并校验配置的 Host、Origin 和会话 token。内核、字体和编辑资源随包分发，编辑与导出不依赖外网。使用 Node 内置 SQLite，无独立数据库服务或云账号。只有管理员可修改服务器 CLI 配置。

## 共享工作区

默认启动入口开启共享模式，`/` 为文件库，`/documents/:id` 为持久化文档，`/local` 保留单机临时画布。`startServer` 的测试兼容默认仍是本地编辑器，测试共享能力需传 `shared: true`。

- `WorkspaceStore` 使用 `node:sqlite`，WAL 与同步事务保存文档、版本、身份会话和租约；所有图稿经过原校验器，新导入强制分配新 documentId。
- `POST /api/session` 仅接收用户名，每次加入创建独立随机身份与 token，不按名称接管已有身份。浏览器保存 token，数据库仅存 SHA-256 摘要，无定期到期。`PATCH /api/session` 改名并同步当前租约名称，身份 ID 与文件归属保持不变。有效旧会话保留身份并撤销远程管理员角色；过期会话不复活。旧 accounts/settings 表保留但不再读取，新数据库不创建。管理员 bootstrap token 仅向服务电脑的本机地址与 loopback 连接提供。所有成员共用文件库，删除/恢复仅创建者或管理员，AI 设置只允许管理员。
- 编辑锁绑定浏览器身份、页面 client ID 和随机 lock token，默认 30 秒租约，客户端每 2 秒续约。租约存 SQLite，多个数据库连接也无法抢到同一文档的锁。页面退出使用 keepalive 尝试释放，异常退出依靠租约到期。
- 每次写入在 `BEGIN IMMEDIATE` 事务内验证有效租约和期望服务器 revision，原子更新文档、递增版本、写入历史。409 表示旧版本，423 表示无有效编辑权。服务器 revision 与画布本地 revision 分开管理。
- 有修改且持有锁时每 2 秒自动保存；只读页面每 2 秒读取轻量状态，发现 revision 变化后加载完整图稿。没有逐笔实时广播；断线或冲突保留当前未同步内容，不覆盖。
- 适配器 `setReadOnly` 禁用图形编辑、原生菜单/快捷键和修改类桥接命令，仍允许读取快照、查看与导出。服务器写入校验是最终边界。
- 每份文档保留最近 50 个服务器版本。删除为软删除，恢复原图或历史内容均递增版本。备份应停止服务后复制整个数据目录。
- 共享 AI 按服务串行排队，最多 8 个活跃任务，任务列表、读取与取消按浏览器身份隔离，共享页列表再按文档过滤。队列和结果不跨服务重启持久化。
- 独立画布 origin 继续隔离编辑器与主站。局域网 HTTP 兼容 UUID 随机生成、摘要和复制链接的降级路径；浏览器直接写本地文件不可用时下载副本。

部署和使用见 [局域网共享指南](../LAN_WORKSPACE.md)。

## 文档模型与身份

主文件为原生单页 `.drawio`，导入兼容标准压缩与未压缩 XML。根对象 `dw_meta` 持有 profileVersion、documentId、generationMode、reviewItems 和可选来源摘要。profile 保持 1.0；产品版本独立为 1.2.1。

校验器禁止 DTD、可执行内容、外部图像/链接和不支持的形状/样式。字体规范化为本地 Noto Sans SC。`fileHash` 表示原始输入，`contentHash` 表示规范化后的文档内容：

- 对象顺序、ID、父级、标签、连接端点、角色、几何与折点、样式、核对元数据及注释参与身份。
- 在计算摘要前统一字体；XML 属性顺序、JSON 字段顺序、样式键值顺序和等价数字写法不构成内容变化。
- 保留数组与图层顺序，不能忽略对象前后层级、连线路径或核对状态改变。
- 视口平移/缩放不参与摘要，也不增加编辑 revision。

候选的基线必须按同一规范计算，不能一端使用转换前字体，另一端使用转换后字体。

## 编辑器桥接

工作台与 iframe 使用固定 channel 的 postMessage，验证精确 origin 与 source；请求带唯一 ID，15 秒超时。适配器集中提供 snapshot/load、选择定位、常规操作、主题/颜色、外观复制、排列、候选应用、核对和导出。

`revision` 由 graph.model 变更递增。主题、颜色、排列和候选应用都通过单个 model transaction，保留一次撤销。锁定对象及锁定祖先不会被样式批量修改；跨容器对齐拒绝执行，避免不同坐标系导致错误移动。上游 vendor 原始文件不修改。

10 套主题共用 `themes.js`；前端选择器/卡片与适配器读取同一个目录。纯文本和图片不强制加填充边框；主题不改变形状、文字、几何或连接关系。颜色输入只接受十六进制或 none；最近 10 色去重排序保存在 `zhitu-recent-colors-v1`，浏览器存储不可用时不影响编辑操作。

格式复制仅传外观白名单，不复制 label、ID、shape、parent、端点锚点或几何。排列调用原生 alignCells/distributeCells。在 graph.container 捕获滚轮：普通滚轮保留原生滚动，Command（非 Mac 兼容 Ctrl）+滚轮缩放，10%～400%，同步 viewport 事件到宿主工具栏。空格使用编辑器原生 panning handler 平移，捕获按键以阻止页面滚动；文本编辑不拦截，keyup、窗口失焦和页面隐藏清除状态。宿主在鼠标位于编辑器时可转发 panMode，以覆盖工具栏仍持有焦点的情况。

## AI 与候选事务

1. 发送时结束文字编辑并读取完整未保存快照、选区、身份和 revision。
2. AIService 验证输入，私有临时目录调用固定 CLI；提示词经 stdin，图片作为原生附件，参数不通过 shell 拼接。
3. Qoder 使用逐段 JSON，关闭本次 Hook/外部 MCP；Codex 使用只读 exec、JSON 事件和最终回答文件。只回显受控阶段及生成字符数，丢弃原始推理和日志。
4. 图稿校验、文档身份和选区限制通过后生成候选与差异；不会直接改画布。
5. 点击预览立即打开统一 CandidatePreview。渲染排队/运行有可见状态；图片解码成功后允许应用。支持缩放、适应、失败重试、关闭。候选源文件可独立下载。
6. 应用前重新取 snapshot，对比最新 contentHash 和 documentId。内容一致时绑定这个新快照 revision，允许用户编辑后撤销回原稿；内容不同要求显式确认覆盖，记录最新内容摘要与 revision，确认期间再次变化需重新确认。
7. 在 IndexedDB 保存应用前版本；适配器同步核对 revision/documentId，防止校验/备份等待期间发生的新编辑。
8. 保留 graph.model.root 身份，在一个事务内替换层内容；临时关闭 maintainEdgeParent，避免完整候选连线被重定位。一步撤销恢复原图。

预览过程中切换文档/候选会失效异步回调，旧图片不能落到新图稿。真实冲突不做隐式合并，保留预览与下载。

## 存储、保存和恢复

- 共享文档以服务器 SQLite 为权威持久化来源；独立磁盘 `.drawio` 可作为导入、导出和备份。临时画布仍以磁盘 `.drawio` 为长期持久化方式；直接写回使用 File System Access API，不支持的浏览器退回下载。
- 文件选择、校验、写入等待前后检查打开代次与 documentId；切图后中止旧写入，不能把旧结果标记为新图稿已保存。检查已知磁盘内容变化，不提供跨应用文件锁。
- IndexedDB 草稿用于异常恢复；版本库每图最多 20 项，全局 40 MiB，超限先清理最旧项。恢复版本前备份当前画布。
- AI 设置位于 `~/.ai-zhitu/clients.json`，只存路径/模型/默认 Provider，不存凭据；任务临时文件结束即清理，内存任务约 1 小时过期。

## 渲染和限制

PNG/SVG 整图或选区、PDF 单页整图。导出由独立 Chromium 执行，不改变工作台选择、撤销或保存状态。PNG/SVG 整图可嵌入源文件，选区和 PDF 禁止源文件嵌入，避免泄露选区外对象。

| 资源 | 限制 |
| --- | --- |
| 文件 / 展开 XML | 20 MiB / 50 MiB |
| 可见对象 / cells | 1,000 / 3,000 |
| XML / 分组深度 | 64 / 10 |
| 图片合计字节 | 12 MiB |
| 单图片 / 图片合计像素 | 16 / 32 百万 |
| PNG 边长 / 总像素 | 8,192 / 32 百万 |
| PDF 边长 | 14,400 pt |
| 导出运行时间 | 单任务 30 秒；前端预览等待包含排队时间 |
| AI 图稿 / 截图 | 2 MiB / 8 MiB |
| AI 输出 / 时间 | 24 MiB，5 分钟无输出、20 分钟生成总预算 |

## 验证与分发

`npm run test:shared` 用不同浏览器上下文与同一浏览器身份多标签页模拟局域网协作；`tests/shared-workspace.test.ts` 验证存储、租约、并发、身份与 AI 隔离。`npm run check` 包含单元、实际内核交互、性能样本、图片/PDF、AI 模拟集成、版本/保存竞态、预览与主题回归。真实 CLI 检查单独执行。`.github/workflows/check.yml` 不需要 AI 账号，远程运行结果须在首次推送后检查。

分享包按白名单生成，包含代码、构建、编辑器、字体、许可证、示例和文档；不含本机配置、账号、node_modules、产物日志或个人图稿。首次启动安装依赖/Chromium；目前验证以 macOS arm64 为主，不宣称 Windows/Linux 安装链路已通过。
