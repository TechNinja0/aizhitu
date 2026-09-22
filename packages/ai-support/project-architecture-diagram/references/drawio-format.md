# 可编辑架构图格式（AI智图 Profile 1.0）

本文件随对外 Skill 独立分发，描述生成所需的兼容子集；不需要从其他 Skill 读取规范。维护本项目时，Profile 变更应同步此文件和配套示例，并用工作台 `validate` 检查兼容性。

## XML 与对象

输出 UTF-8、未压缩的单页 `.drawio`，结构参考 [最小架构示例](../assets/minimal-architecture.drawio)：

- `mxfile compressed="false"` → 单个 `diagram` → `mxGraphModel` → `root`。
- 根为 `<object id="0" dw_meta="XML转义后的JSON"><mxCell/></object>`；绘图层为 `<mxCell id="1" parent="0"/>`。不要再生成另一个 `id="0"`。
- 所有对象 ID 唯一，使用稳定的语义 ID，标题和图例也有独立 ID。
- 节点 `vertex="1"`，包含 `mxGeometry` 的有限数值 `x/y/width/height`，宽高为正数。
- 连线 `edge="1"`，`source/target` 指向真实节点 ID，带 `<mxGeometry relative="1" as="geometry"/>`。不能用两点自由线冒充业务关系。
- 容器使用 `swimlane;horizontal=1;startSize=32;container=1;collapsible=0;`；分组使用 `group;`。子节点 `parent` 为容器 ID，坐标相对父级；容器留出标题高度和内容边距。父级必须存在且不能成环。
- 跨容器的边可放在绘图层 `parent="1"`，source/target 仍绑定内部节点。
- 属性转义 `&` → `&amp;`、`<` → `&lt;`、`"` → `&quot;`；多行标签用 `&#xa;`。不要输出 Markdown 围栏包裹的 XML 作为源文件。

## 元数据

产品元数据放在根 object 的 `dw_meta`，不要放在自创的 mxfile 属性中：

```json
{
  "profileVersion": "1.0",
  "documentId": "新建图时生成的UUID",
  "generationMode": "manual",
  "reviewItems": [],
  "provenance": {
    "skill": "project-architecture-diagram",
    "view": "module-architecture"
  }
}
```

`generationMode` 只允许 `manual`、`faithful`、`relayout`。新建源码架构图用 `manual`；不要发明 `architecture`、`code` 等枚举。`provenance` 为字符串字典，可保存 commit 或输入摘要，不保存凭据或完整源码。详细证据写同名 Markdown。

待核对项例：

```json
{"id":"review-cache","objectId":"api-cache","kind":"relationship","message":"文档声明使用缓存，尚未找到调用实现","status":"needsReview"}
```

核对项 ID 唯一；`objectId` 如提供必须存在；`kind` 为 `text/relationship/shape/region`，未确认项 `status` 为 `needsReview`。没有对应对象时可省略 `objectId`。无截图时不要生成 `source` 或 `sourceRect`，仓库路径不能代替截图尺寸。

## 样式与布局

通用节点：`rounded=1;whiteSpace=wrap;html=0;fontFamily=Noto Sans SC;fontSize=14;fontColor=#243e32;fillColor=#ffffff;strokeColor=#648373;`。

| 用途 | 样式片段 |
| --- | --- |
| 模块／服务 | `rounded=1;` |
| 存储 | `shape=cylinder;` |
| 标题／注释 | `text;fillColor=none;strokeColor=none;` |
| 关系 | `edgeStyle=orthogonalEdgeStyle;rounded=0;endArrow=block;endFill=1;html=0;` |
| 待核对对象／关系 | `dashed=1;strokeColor=#b7791f;`，标签加“待核对” |

默认沿从左到右或从上到下的主方向组织层次。同层对齐，节点宽度随文字调整，为连线标签留白；不要靠缩小字体容纳整个大型项目。颜色按组件角色保持一致，图例解释特殊线型。字体未安装时可能回退，需通过实际预览判断效果。

固定锚点可用 `exitX/exitY/entryX/entryY`（0～1）；手工折点放在边的 `mxGeometry` 内 `<Array as="points"><mxPoint x="..." y="..."/></Array>`。不要添加假业务节点控制走线。

保持文件 ≤20 MiB、可见对象 ≤1000、分组深度 ≤10。此 Skill 使用基础向量图形与纯文本，不嵌入截图、远程图片、脚本、插件、自定义 SVG、隐藏层或多页。不能以 Mermaid 文本或整张图片代替可编辑 `.drawio`。
