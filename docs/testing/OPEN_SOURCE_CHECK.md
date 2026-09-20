# v1.1 开源与分享检查

日期：2026-09-18。实测平台为 macOS arm64、Node.js 22.22.0。功能验收见 [v1.1 报告](V1_1_REPORT.md)。

## 已完成

- 自有代码采用 Apache-2.0；保留 LICENSE、NOTICE、第三方声明、上游和字体许可。`node scripts/licenses.mjs` 已更新 117 个本平台已安装依赖的摘要。
- `npm run setup` 校验固定 draw.io 资源及本地运行依赖通过。
- `npm run check` 构建、50 项单元/CLI、68 组浏览器检查通过；真实 AI 测试单独记录。
- 产品规格、技术设计、使用指南、README、贡献说明、安全说明、发布指南和 CHANGELOG 已同步到 1.1.0。
- GitHub Actions 配置使用假 CLI 执行构建和回归，不需要个人 AI 账号；远程工作流尚未运行。

- `npm run docs:check`：85 个 Markdown 本地链接目标存在，不检查远程链接或标题锚点。
- `node scripts/package-share.mjs` 与 `node scripts/verify-local-package.mjs`：本机分享包内容检查、独立临时目录安装、工作台/编辑器/授权 AI API 启动检查均通过。

## 分享包验证方法

`node scripts/package-share.mjs` 使用明确文件白名单，生成 `artifacts/ai-zhitu-local.tar.gz` 和 SHA-256 文件；包含运行源码、构建页面、编辑器、字体、示例和文档，不包含个人账号、配置、AI 任务记录、生成图稿、node_modules 或 artifacts。

`node scripts/verify-local-package.mjs` 检查包内容，解压到临时新目录，通过本机离线 npm 缓存执行 `npm ci`，使用 `node bin/zhitu.mjs --port 0 --no-open` 启动，并验证工作台、独立编辑器及授权 AI 配置 API。该检查不是无缓存网络安装或跨平台测试。

首次使用仍需安装 Node.js 22.12+，按 README 初始化；同事使用自己的 AI CLI 登录和额度。生成物只在本地交付，未创建 GitHub 仓库、推送代码或发布 Release。

详细发布步骤见 [发布指南](../RELEASING.md)，功能边界见 [验收报告](V1_1_REPORT.md)。
