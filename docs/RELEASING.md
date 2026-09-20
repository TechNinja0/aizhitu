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

## v1.1 发布产物

1. `npm run check` 和 `npm run docs:check` 通过后执行 `npm run package:local`。
2. 执行 `node scripts/verify-local-package.mjs` 验证独立解压目录的安装与启动。此脚本使用本机 npm 缓存，不等于无缓存联网安装验证。
3. 发布 `artifacts/ai-zhitu-local.tar.gz` 和 `.sha256`，附 [更新记录](../CHANGELOG.md) 与实际测试平台。包不含个人账号、配置或生成图稿。
4. 源码工作流见 `.github/workflows/check.yml`，首次推送后查看真实 CI 结果；本地通过不能代替远程 CI 已运行的声明。

本轮只完成本地代码、文档与分享产物，不创建外部仓库、不推送、不发布 Release。

## 创建并推送仓库

在 GitHub 创建空仓库 `ai-zhitu`，不要让 GitHub 再生成 README、LICENSE 或 `.gitignore`，本项目已提供这些文件。

在项目根目录执行：

```sh
git init -b main
git add .
git status --short
git diff --cached --stat
git diff --cached --check
```

检查暂存内容后提交：

```sh
git commit -m "docs: prepare AI ZhiTu for open source"
```

在 GitHub 新仓库页面复制准确的 `git remote add origin ...` 命令，在本地执行，然后推送：

```sh
git push -u origin main
```

本文不会预填不存在的账号、仓库 URL 或作者邮箱。仓库公开后，可补充 README 中的克隆命令与项目主页。

## 仓库设置

- 添加中文简介及 `drawio`、`diagram`、`local-first`、`ai` 等 Topics。
- 开启 Issues；如准备处理私密安全反馈，开启 Private vulnerability reporting。
- 首次公开可先发布预览版本，说明 macOS 验证范围与已知限制，不把旧版 P0 测试结果当作所有新功能验收。
- 截图应使用仓库合成示例，避免包含本机路径、客户信息或令牌。
- 收到外部用户安装反馈后，再考虑 Windows / Linux 安装验证、自动 CI 和桌面打包。

## 维护工作量

开源并不要求持续增加功能，但需要让安装方法、许可证与实际能力保持一致。优先修复无法安装、无法保存、错误导出及数据丢失问题；功能请求可按维护者时间安排，不承诺交付日期。
