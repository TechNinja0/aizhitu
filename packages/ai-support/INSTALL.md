# AI智图 · 两种绘图 Skill 的选择与安装

返回 [项目首页](../../README.md) · [使用指南](../../docs/USAGE.md)

## 先选 Skill

| Skill | 使用场景 | 是否可以独立复制 |
| --- | --- | --- |
| [project-architecture-diagram](project-architecture-diagram/SKILL.md) · 对外 | 在 Cursor、Qoder、Codex 中分析业务项目源码／文档，生成架构图及证据说明 | 可以，只需完整复制这个 Skill 目录；工作台 CLI 可选 |
| [diagram-drawing](diagram-drawing/SKILL.md) · 工作台配套／对内维护 | 截图还原、现有图稿修改、强制 CLI 校验和渲染 | 不可以脱离工作台；外部 IDE 可以链接完整安装中的 Skill |

“对内”指工作台依赖和维护定位，不是访问权限限制。网页内 AI 会话无需安装这两个 Skill。二者都沿用宿主 Agent 的模型和工具能力，不携带模型凭据。

## 对外：在其他项目画架构图

把 `packages/ai-support/project-architecture-diagram/` **整个目录**复制到目标业务项目下的对应位置，保留 `references/` 和 `assets/`。无需复制完整工作台，也无需执行工作台的 `npm ci` 或 `npm run setup`。

| 客户端 | 项目级安装位置 | 显式调用 |
| --- | --- | --- |
| Cursor | `.cursor/skills/project-architecture-diagram/` | `/project-architecture-diagram`，或明确要求使用该 Skill |
| Qoder IDE／CLI | `.qoder/skills/project-architecture-diagram/` | `/project-architecture-diagram`，或明确要求使用该 Skill |
| Codex | `.agents/skills/project-architecture-diagram/` | `$project-architecture-diagram`，或明确要求使用该 Skill |

Cursor 与 Qoder 的目录和调用方式核对自 [Cursor Skills](https://cursor.com/docs/skills) 与 [Qoder Skills](https://docs.qoder.com/extensions/skills)（2026-09-22）；Codex 使用本项目既有的 `.agents/skills` 接入方式。安装后刷新技能发现或重启客户端。文档核对与本地文件验证不等于三种 IDE 均已端到端实测。

例如在目标项目根目录的 macOS/Linux 终端执行（将源路径替换成实际工作台或解压包位置）：

```sh
# Cursor 示例；Qoder 改成 .qoder/skills，Codex 改成 .agents/skills
skill_source='/工作台绝对路径/packages/ai-support/project-architecture-diagram'
skill_parent='.cursor/skills'
mkdir -p "$skill_parent"
# 同名目录或链接已存在时停止，先检查内容，不直接合并或覆盖
if [ -e "$skill_parent/project-architecture-diagram" ] || [ -L "$skill_parent/project-architecture-diagram" ]; then
  echo '已存在同名 Skill，请先检查其来源和版本。'
else
  cp -R "$skill_source" "$skill_parent/project-architecture-diagram"
fi
```

Windows 可直接复制整个文件夹到上表目录。如果 IDE 没有自动发现，直接给 Agent 提供已复制的 `SKILL.md` 绝对路径，要求读取并遵循。

在目标项目中使用：

> 使用 project-architecture-diagram Skill，分析当前项目的源码、配置和技术文档，生成当前实现的模块架构图。节点与连线都要有代码依据，推断标为待核对，不要把规划内容画成已经实现。输出 docs/architecture/project.drawio 和同名证据说明；具备渲染工具时再生成并查看 PNG。

也可以指定“只画登录模块的调用链”“根据这份 PRD 画目标架构，并标明规划”。默认只写图稿与说明，不修改业务代码。没有工作台 CLI 时可完成独立 XML／结构检查和交付；只有实际运行工作台 `validate` 后才可声称完整 Profile 校验通过，没有渲染工具时不承诺 PNG。产物可在工作台点击 **打开** 后继续编辑。

## 工作台配套：截图还原与图稿修改

以下安装说明仅适用于 `diagram-drawing`。工作台先完成 `npm ci` 和 `npm run setup`。其脚本使用当前安装目录中的 CLI，移动工作台后需重新建立链接。无须购买另一个绘图服务或配置模型 API key。

### Codex

在需要画图的项目根目录下建立 `.agents/skills/diagram-drawing` 符号链接，目标为工作台的 `packages/ai-support/diagram-drawing` 绝对路径。重启/刷新当前客户端的技能发现后，输入 `$diagram-drawing` 或明确要求使用该 Skill。

### Qoder

在需要画图的项目根目录执行：

```sh
qoder skills link --scope workspace '/工作台绝对路径/packages/ai-support/diagram-drawing'
qoder skills list
```

如果 CLI 提示信任链接，阅读其说明后确认。此命令只链接当前工作区，不修改全局技能。

### 自检

```sh
node '/工作台绝对路径/bin/diagram.mjs' doctor --json
```

再在 AI 客户端中提供一张流程图截图，要求生成 `.drawio`、调用校验、渲染并实际查看 PNG。工具自检不能证明模型支持视觉，也不能替代客户端的权限设置。客户端/模型兼容结论见工作台 `docs/testing/REPORT.md`。

### 日常指令

> 使用 diagram-drawing Skill，把这张流程图按原布局转成可编辑文件。看不清的内容标记待核对，保存到当前输出目录，交付源文件、校验结果和预览。

改稿时提供最新保存的源文件；浏览器中尚未保存的修改不会自动传给 AI。Skill 不携带模型凭据，沿用客户端现有账号与额度。

### 运行权限与实测版本

CLI `validate` 是纯文件校验；`render` 需要启动 Chromium 并监听随机的 127.0.0.1 端口。`doctor` 的 `loopback=false` 意味着当前执行环境阻止本地预览，请按客户端提供的权限机制允许这一工具，或在普通本地终端执行渲染。不要把格式校验通过等同于完整预览成功。

本轮使用 Codex CLI 0.153.4（gpt-6-astra）及 Qoder CLI 1.1.42（auto）测试。旧 Codex CLI 0.147.0 无法调用本轮所用的新模型，需使用支持该模型的客户端版本。客户端的模型选择、订阅与额度不由绘图工作台提供。

Codex 安装示例（把路径替换为实际目录）：

```sh
mkdir -p .agents/skills
ln -s '/工作台绝对路径/packages/ai-support/diagram-drawing' .agents/skills/diagram-drawing
```

已有同名 Skill 时先检查其来源，避免覆盖。也可以直接给 AI 提供本 Skill 的绝对路径并要求读取；真实截图基准明确指定了此路径，不能据此证明所有客户端版本都会自动发现 Skill。
