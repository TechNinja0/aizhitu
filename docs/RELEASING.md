# GitHub 发布指南

## 发布定位

仓库名建议为 `ai-zhitu`，显示名称为 **AI智图 / AI ZhiTu**，简介为 **AI 辅助制图工作台：基于 draw.io 的本地编辑器，配套 AI Skill、图稿校验和 PNG/SVG/PDF 导出。**

建议作为可独立使用的社区工具发布。核心价值是截图重建、文件校验、原图核对和继续改稿的完整流程；编辑器能力来自 draw.io，模型识别来自用户已有的 AI 客户端。

## 发布前

- 确认自有代码、示例和素材有权公开，特别是来自工作单位或客户的内容。
- 确认根目录 `LICENSE`、`NOTICE` 署名以及 `THIRD_PARTY_NOTICES.md` 的资源边界。
- 按 README 从干净目录验证安装与示例流程；不要将本机 `node_modules` 一起上传。
- 执行 `npm run check`，记录环境、命令和失败项。完整命令已覆盖增强功能与候选/主题回归。
- 检查暂存内容，不提交密钥、账号配置、个人路径、真实业务图稿、AI 对话和构建产物。
- 保留 `package-lock.json`、固定的 `vendor/drawio` 资源、字体与许可、合成 `fixtures`。
- 如发布构建包，随包带上 LICENSE、NOTICE、第三方声明、字体许可及打包依赖要求的许可文本；npm 许可摘要不能代替许可原文。

## 当前版本发布产物（v1.6）

1. `npm run check` 和 `npm run docs:check` 通过后执行 `npm run package:local`。
2. 执行 `node scripts/verify-local-package.mjs` 验证独立解压目录的安装与启动。此脚本使用本机 npm 缓存，不等于无缓存联网安装验证。
3. 发布 `artifacts/ai-zhitu-local.tar.gz` 和 `.sha256`，附 [更新记录](../CHANGELOG.md) 与实际测试平台。包不含个人账号、配置或生成图稿。
4. 源码工作流见 `.github/workflows/check.yml`，首次推送后查看真实 CI 结果；本地通过不能代替远程 CI 已运行的声明。

## 提交与推送已有仓库

当前仓库为 [TechNinja0/aizhitu](https://github.com/TechNinja0/aizhitu)，默认分支为 `main`。先核对远端、暂存区、未暂存文件和已提交但尚未推送的提交：

```sh
git fetch origin
git status --short
git log --oneline origin/main..HEAD
git diff --stat
git diff --cached --stat
```

更新 README、使用指南、产品/技术规格、SECURITY、CHANGELOG 和相应测试报告，使其描述当前实现；历史版本报告保留当时的验证范围。审核需要提交的文件后显式暂存，运行 `git diff --cached --check`，再提交并使用普通推送：

```sh
git commit -m "feat: 完善账号权限与文件自动保存"
git push origin main
```

推送后核对本地 HEAD 与远端分支一致，并检查 GitHub Actions。源码推送、创建 Release 和上传安装包是不同操作；只有需要发布安装包时才执行独立的 Release 流程。不要把备份数据库、日志、账号配置或 `artifacts/` 加入版本控制。

## 仓库设置

- 添加中文简介及 `drawio`、`diagram`、`local-first`、`ai` 等 Topics。
- 开启 Issues；如准备处理私密安全反馈，开启 Private vulnerability reporting。
- 首次公开可先发布预览版本，说明 macOS 验证范围与已知限制，不把旧版 P0 测试结果当作所有新功能验收。
- 截图应使用仓库合成示例，避免包含本机路径、客户信息或令牌。
- 收到外部用户安装反馈后，再考虑 Windows / Linux 安装验证、自动 CI 和桌面打包。

## 维护工作量

开源并不要求持续增加功能，但需要让安装方法、许可证与实际能力保持一致。优先修复无法安装、无法保存、错误导出及数据丢失问题；功能请求可按维护者时间安排，不承诺交付日期。
