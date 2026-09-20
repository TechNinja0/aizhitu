# AI智图 · AI 绘图支持包安装

返回 [项目首页](../../README.md) · [使用指南](../../docs/USAGE.md)

工作台先完成 `npm ci` 和 `npm run setup`。Skill 使用当前安装目录中的 CLI，移动工作台后需重新建立链接。无须购买另一个绘图服务或配置模型 API key。

## Codex

在需要画图的项目根目录下建立 `.agents/skills/diagram-drawing` 符号链接，目标为工作台的 `packages/ai-support/diagram-drawing` 绝对路径。重启/刷新当前客户端的技能发现后，输入 `$diagram-drawing` 或明确要求使用该 Skill。

## Qoder

在需要画图的项目根目录执行：

```sh
qoder skills link --scope workspace '/工作台绝对路径/packages/ai-support/diagram-drawing'
qoder skills list
```

如果 CLI 提示信任链接，阅读其说明后确认。此命令只链接当前工作区，不修改全局技能。

## 自检

```sh
node '/工作台绝对路径/bin/diagram.mjs' doctor --json
```

再在 AI 客户端中提供一张流程图截图，要求生成 `.drawio`、调用校验、渲染并实际查看 PNG。工具自检不能证明模型支持视觉，也不能替代客户端的权限设置。客户端/模型兼容结论见工作台 `docs/testing/REPORT.md`。

## 日常指令

> 使用 diagram-drawing Skill，把这张流程图按原布局转成可编辑文件。看不清的内容标记待核对，保存到当前输出目录，交付源文件、校验结果和预览。

改稿时提供最新保存的源文件；浏览器中尚未保存的修改不会自动传给 AI。Skill 不携带模型凭据，沿用客户端现有账号与额度。

## 运行权限与实测版本

CLI `validate` 是纯文件校验；`render` 需要启动 Chromium 并监听随机的 127.0.0.1 端口。`doctor` 的 `loopback=false` 意味着当前执行环境阻止本地预览，请按客户端提供的权限机制允许这一工具，或在普通本地终端执行渲染。不要把格式校验通过等同于完整预览成功。

本轮使用 Codex CLI 0.153.4（gpt-6-astra）及 Qoder CLI 1.1.42（auto）测试。旧 Codex CLI 0.147.0 无法调用本轮所用的新模型，需使用支持该模型的客户端版本。客户端的模型选择、订阅与额度不由绘图工作台提供。

Codex 安装示例（把路径替换为实际目录）：

```sh
mkdir -p .agents/skills
ln -s '/工作台绝对路径/packages/ai-support/diagram-drawing' .agents/skills/diagram-drawing
```

已有同名 Skill 时先检查其来源，避免覆盖。也可以直接给 AI 提供本 Skill 的绝对路径并要求读取；真实截图基准明确指定了此路径，不能据此证明所有客户端版本都会自动发现 Skill。
