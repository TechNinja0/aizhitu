# 基础图形和样式

节点 geometry 包含 x/y/width/height。使用下面的样式片段，可与通用样式组合：

| 图形 | 片段 |
| --- | --- |
| 矩形 | rounded=0; |
| 圆角矩形 | rounded=1; |
| 椭圆 | ellipse; |
| 判断菱形 | rhombus; |
| 数据库 | shape=cylinder; |
| 纯文字 | text;fillColor=none;strokeColor=none; |
| 分组 | group; |
| 标题容器 | swimlane;horizontal=1;startSize=32;container=1;collapsible=0; |

通用：`whiteSpace=wrap;html=0;fontFamily=Noto Sans SC;fontSize=14;fontColor=#243e32;fillColor=#ffffff;strokeColor=#648373;strokeWidth=1;`。加粗 fontStyle=1；对齐 align=left/center/right；verticalAlign=top/middle/bottom。虚线 dashed=1。

边：`edgeStyle=orthogonalEdgeStyle;rounded=0;endArrow=block;endFill=1;html=0;`，或去掉 edgeStyle 使用直线。连线标签写 value。双向箭头增加 startArrow/startFill。

固定锚点：exitX/exitY 为 source 边界的 0～1 相对位置；entryX/entryY 对应 target。手工折点：在 mxGeometry 中放 `<Array as="points"><mxPoint x="..." y="..."/></Array>`。不要添加随机节点只为弯折连线。

样例见 `examples/flow.drawio`、`examples/architecture.drawio`、`examples/review.drawio`。这些是语法参考，不代表当前截图内容。
