# v1.1 验收报告

日期：2026-09-18。环境：macOS arm64，Node.js 22.22.0，锁定依赖、Playwright Chromium、draw.io 31.4.6。产品版本 1.1.0，文件 profile 保持 1.0。

## 结论与修复

完整 `npm run check` 通过：50 项单元/CLI 测试，68 组浏览器检查，含类型检查与生产构建。浏览器检查按脚本的 PASS 组统计，不代表 68 个独立产品功能，也不意味着所有可能输入均无缺陷。

用户反馈的两类问题已建立回归场景：

- **预览像没响应**：候选变化列表较长时，原预览位于会话下方。现在点击即打开大图弹窗，显示加载状态；支持放大、缩小、适应窗口、关闭和应用。渲染失败有明确错误与重试。以新增 55 节点候选验证弹窗可见、图片解码成功、缩放方向正确。
- **未实质修改却提示过期**：校验后的 XML 字体已归一化，但用于内容哈希的 cell 样式仍使用归一化前字体；此外 XML 属性顺序、等价数字写法、编辑再撤销导致修订号变化，也会造成误判。现在统一语义哈希，保留真正的样式覆盖顺序、几何位置、文字、关系和元信息变化；应用前重新核验内容并使用最新修订号，防止校验之后发生并发改动。
- **真实冲突保护**：真正修改图稿后仍拒绝旧候选覆盖；候选保留，可下载 `.drawio` 独立打开。图片实际加载后才能应用，应用支持一步撤销。

更新服务前找回了用户截图中已完成任务的候选，已单独备份，并在新服务浏览器中验证其预览、应用后内容一致和一步撤销通过。原任务生成时的完整浏览器基线及操作序列未留存，根因机制由代码定位与可重复回归确认。个人候选与任务记录不随分享包分发。

## 本轮命令与结果

| 命令 | 实际结果 |
| --- | --- |
| `npm run check` | 通过；build、50 单元/CLI、68 浏览器检查组 |
| `npx tsx --test tests/document-tools.test.ts` | 6 项通过，覆盖字体归一化、等价几何、真正内容变化和命名样式覆盖顺序 |
| `npm run setup` | 固定资源哈希、字体、Chromium、Node 与 loopback 检查通过 |
| `node bin/diagram.mjs doctor --json` | `ok: true`，产品版本 1.1.0，profile 1.0 |
| `npx tsx scripts/ai-chat-capabilities.ts qoder Qwen3.8-Flash` | 真实 Qoder 截图生成与选区文字修改通过；截图 5 节点、5 连线，约 41 秒 |
| `ZHITU_CODEX_PATH=/Applications/ChatGPT.app/Contents/Resources/codex npx tsx scripts/ai-chat-smoke.ts codex` | 真实 Codex 连接与文字生成通过；使用本机模型配置 |
| `npx tsx scripts/verify-generated-candidates.ts` | 将真实 Qoder、Codex 结果导入工作台，预览、应用后语义一致、一步撤销均通过 |
| `npx tsx --test tests/cli.test.ts` | 版本显示调整后，CLI 跨目录与输出不覆盖回归通过（1 项） |
| `npm run docs:check` | 85 个本地 Markdown 链接目标存在 |
| `node scripts/package-share.mjs` + `node scripts/verify-local-package.mjs` | 分享包白名单、新目录缓存安装、独立启动及接口检查通过 |
| `npx tsx artifacts/verify-recovered-candidate.ts` | 用户原任务候选：大图预览、应用无内容丢失、一步撤销通过；测试文件仅保留本机 |
| `npx tsc --noEmit` | 最终版本元信息同步后，类型检查通过；运行服务 `/api/capabilities` 验证为 1.1.0 |
| `node scripts/licenses.mjs` | 117 个当前平台已安装依赖的许可摘要更新 |

完整本机记录为 `artifacts/v1.1-full-check.log`、`product-polish-results.json`、`real-candidate-ui-results.json` 和两份真实 CLI 日志。它们不随分享包分发。

## 功能覆盖

| 测试模块 | 组数 | 重点 |
| --- | ---: | --- |
| e2e | 17 | 示例打开、编辑、保存、恢复、PNG/SVG/PDF 导出、无外网编辑 |
| interactions | 6 | 节点与连线交互、拖动、选择、编辑与撤销 |
| capabilities | 12 | 文件校验、兼容边界、图稿和导出能力 |
| images | 1 | 图片资源导出 |
| enhancements | 4 | 美化语义与幂等、候选应用和撤销、过期拦截 |
| ai-chat | 9 | 会话、候选、取消、失败、选区与任务安全边界 |
| product-audit | 11 | 搜索、版本、AI 任务恢复、缩放、附件及会话 UI 回归 |
| product-polish | 8 | 10 主题、颜色与最近色、复制样式、锁定、对齐分布、大图预览、等价基线与真实冲突 |

主题均验证不改变 ID、文字、父子结构、连线和几何，支持一步撤销；原三套主题颜色保持兼容。最近颜色验证同一浏览器存储下新页面恢复。对齐和分布覆盖 8 个动作、撤销和跨容器拒绝；锁定对象不被主题/颜色覆盖。新流程浏览器无运行时错误。

界面回归使用可控假 CLI 以稳定复现错误、取消与超时；真实 Qoder/Codex 测试另列，不混为模型识别准确率。真实生成结果还在浏览器中验证了源内容不丢失。

## 边界

- 本轮真实 Qoder 只验证 Qwen3.8-Flash，不能代表所有模型、账户状态和长任务必成功。
- 合成截图的成功不代表复杂、模糊、超大业务截图的识别准确率；使用者仍需核对文字与关系。
- Chrome 系 Chromium/macOS arm64 为本轮实测平台；其他系统、浏览器、系统文件授权提示与所有外部文件并发情况未穷举。
- GitHub Actions 配置已提供，尚未在远程执行；没有创建、推送或发布外部仓库。
- 多页、复杂 UML/BPMN、多人协作、服务器部署与 App 封装不在本版范围。

发布文件与独立安装验证见 [开源与分享检查](OPEN_SOURCE_CHECK.md)。当前能力以 [产品规格](../product/PRD.md)、[技术设计](../design/TECHNICAL_DESIGN.md) 和 [使用指南](../USAGE.md) 为准，其他早期测试报告仅作历史记录。
