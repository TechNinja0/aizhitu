# 校验与可选预览

## 独立使用（不安装工作台）

使用环境已有 XML 解析器进行真实解析，例如安装有 Python 3 时，在目标项目执行下面的命令，把最后一个参数换成输出文件：

```sh
python3 -c 'import sys, xml.etree.ElementTree as E; E.parse(sys.argv[1]); print("XML parse OK")' 'docs/architecture/project.drawio'
```

这只证明 XML 能解析。进一步通过解析后的对象检查唯一 ID、根与绘图层、parent 引用及环、节点正数尺寸、边端点、合法 JSON 元数据和核对对象引用。按 [格式规范](drawio-format.md) 检查生成内容；可使用宿主已有工具或任务内临时检查脚本，不假定 Node 自带 DOMParser。工具不可用时如实标记未执行，不强制安装依赖。

语义检查需对照同名 Markdown 的证据表：关系方向是否正确、规划是否混入当前实现、待核对项是否在图上可见、是否出现无证据的基础设施。结构检查无法证明这些事实。

源文件可以在 AI智图或兼容 draw.io 的编辑器打开后预览、导出；未实际打开或渲染时，不声称导入或预览成功。默认不要上传项目内容到在线服务。

## 已安装 AI智图 CLI 时

只有用户提供了工作台位置或环境已明确配置时才使用，路径应来自实际环境，不要从 Skill 目录向上推算。以下 `<工作台绝对路径>` 需替换为真实安装目录，输入输出路径也按当前任务替换：

```sh
node '<工作台绝对路径>/bin/diagram.mjs' validate --input 'docs/architecture/project.drawio' --json
node '<工作台绝对路径>/bin/diagram.mjs' doctor --json
node '<工作台绝对路径>/bin/diagram.mjs' render --input 'docs/architecture/project.drawio' --format png --output 'docs/architecture/project.png' --scale 2
```

`validate` 检查完整 Profile；`doctor` 用于渲染环境诊断；`render` 需要工作台资源、Chromium 和本地回环端口。自检中的图片输入要求来自截图工作流，源码架构分析不需要图片输入。渲染依赖不可用不否定已完成的 XML 或 Profile 校验，应分别报告结果。

PNG 已存在时换新文件名。渲染成功后有图像查看能力就实际查看，检查遮挡、裁切、连线方向和文字溢出；仅有 PNG 文件但未查看时不要声称完成视觉检查。
