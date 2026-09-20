# 第三方组件与许可

AI智图（AI ZhiTu）是独立项目，与 draw.io、OpenAI、Qoder 等上游产品或组织没有官方隶属、赞助或背书关系。

自有代码、文档、Skill 和原创示例采用根目录 [Apache-2.0](LICENSE)；第三方内容继续适用自己的许可。根目录许可不覆盖或替代下列资源条款。

主题配色、快捷颜色栏与候选预览组件为本项目原创实现；功能参考不包含 ProcessOn 或其他竞品的代码、图标、主题素材或商标。

## draw.io

- 固定版本：**31.4.6**。
- 来源：[上游仓库及版本](https://github.com/jgraph/drawio/tree/v31.4.6)。
- 原始文件：[LICENSE](vendor/drawio/LICENSE)、[README](vendor/drawio/README.md)、[VERSION](vendor/drawio/VERSION)。
- 文件来源和 SHA-256：[manifest.json](vendor/drawio/manifest.json)；`npm run setup` 检查其完整性。
- 本项目的适配逻辑位于 `packages/editor-adapter`，所选上游文件保留原始内容。不是重新实现或独占拥有 draw.io 编辑器。

上游对代码采用 Apache-2.0；对图标集、stencil 库和模板另有条款，包括在 Atlassian 产品及其市场生态中使用、分发或集成相关资源的限制。完整内容以随版本保留的 README 为准。不能把整个第三方目录的所有视觉素材概括为不受限制的 Apache-2.0 资源。

本工作台使用规定的基础图形，没有单独加载额外 stencil 或模板库；vendor 中仍含上游 bundle、界面图标及资源，所以“不加载某个图形库”不代表全部打包素材已经完成独立授权审查。扩充资源或重新分发到不同场景前，应检查相应资源条款。

原始 draw.io 商标及标识归其权利人所有，不得据此表示本项目得到官方背书。本项目以 AI智图名称展示。

## 字体

`assets/fonts` 中的 Noto Sans SC 来自 `@fontsource/noto-sans-sc` **5.3.0**，遵循 [SIL Open Font License 1.1](assets/fonts/LICENSE)。字体文件与许可需一并保留，不能改用本项目许可证重新授权。

`fonts.css` 由 `scripts/fonts.mjs` 基于 Fontsource CSS 生成：仅选用 400 / 700 字重和 WOFF2，并将 `font-display` 设置为 `block`；字体二进制未修改。

## npm 依赖与运行时

| 组件 | 锁定版本 | 许可 |
| --- | --- | --- |
| React / React DOM | 19.3.0 | MIT |
| Express | 5.2.1 | MIT |
| @xmldom/xmldom | 0.9.12 | MIT |
| saxes | 6.0.0 | ISC |
| Playwright | 1.63.0 | Apache-2.0；随包第三方组件另附声明 |

完整依赖版本以 [package-lock.json](package-lock.json) 为准。[npm 许可摘要](licenses/npm-licenses.json) 由 `node scripts/licenses.mjs` 从本机已安装包生成，只覆盖该平台实际安装的包，不是跨平台依赖的完整法律审查。

`npm ci` 安装的包保留各自的 LICENSE / NOTICE。前端打包会包含 React 等代码，因此额外保留其 [许可原文](licenses/frontend-LICENSES.txt)，分发构建包时应一并提供。其他依赖或新增打包模块同样需要保留适用声明，不能只附许可名称清单。

Chromium 由 Playwright 安装，不作为本项目原创代码；重新打包浏览器时应保留它的第三方许可和声明。仓库不包含浏览器二进制。

## 用户输入和输出

本项目不因绘图工具的使用而主张用户图稿的著作权。用户导入的图片、图标、模板及外部 AI 输出仍受原有权利和模型服务条款约束，本项目不对这些材料做统一授权。

仓库中的示例和测试基准由项目脚本构造；维护者应在接受新增示例时核实其来源，避免包含真实业务或未授权素材。
