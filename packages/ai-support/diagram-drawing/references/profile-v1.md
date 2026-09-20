# Profile 1.0

一个 UTF-8 `.drawio` 文件对应一个画布。标准结构为：

```xml
<mxfile compressed="false"><diagram id="page-1" name="画布">
<mxGraphModel grid="1" gridSize="10" page="0"><root>
<object id="0" dw_meta="{&quot;profileVersion&quot;:&quot;1.0&quot;,&quot;documentId&quot;:&quot;唯一UUID&quot;,&quot;generationMode&quot;:&quot;faithful&quot;,&quot;reviewItems&quot;:[]}"><mxCell/></object>
<mxCell id="1" parent="0"/>
<mxCell id="node-a" value="开始" vertex="1" parent="1" style="rounded=1;whiteSpace=wrap;html=0;fontFamily=Noto Sans SC;"><mxGeometry x="80" y="80" width="140" height="60" as="geometry"/></mxCell>
<mxCell id="node-b" value="处理" vertex="1" parent="1" style="rounded=1;whiteSpace=wrap;html=0;fontFamily=Noto Sans SC;"><mxGeometry x="80" y="220" width="140" height="60" as="geometry"/></mxCell>
<mxCell id="edge-a-b" edge="1" parent="1" source="node-a" target="node-b" style="edgeStyle=orthogonalEdgeStyle;endArrow=block;endFill=1;html=0;fontFamily=Noto Sans SC;"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>
```

JSON 属性必须 XML 转义。不要同时用两个 cell 保存同一个 ID。全部 ID 唯一；根为 0，绘图层为 1。节点必有正数 width/height。端点使用真实节点 ID；循环和并行边合法。业务关系线不能是没有 source/target 的独立图形。

分组为 `vertex="1" style="group;"`，容器用 `swimlane;horizontal=1;startSize=32;container=1;collapsible=0;`。子节点 parent 指向分组 ID，几何坐标相对父级；不要用全局坐标冒充组内坐标。分组不能成环。

文字优先使用 html=0，换行采用 XML 属性实体 `&#xa;`，`&` 写为 `&amp;`。使用本地 `Noto Sans SC`，颜色为 #RRGGBB。不用外链资源、脚本、任意 SVG 图标、插件、数学公式、多页或隐藏层。

## 核对元数据

全部产品元数据放在根 ID 0 的 object 的 `dw_meta` JSON 属性中，不放在会被内核丢弃的未知 mxfile 属性。字段：

- profileVersion: `1.0`。
- documentId: UUID，新图生成；改稿保持。
- generationMode: faithful / relayout / manual。
- reviewItems: 数组，可为空。
- source: 可选 `{sha256,width,height}`，仅保存原图摘要/像素尺寸，不保存截图字节。
- provenance: 可选字符串字典，记录工具版本与输入摘要，不记录密钥。

疑点示例：`{"id":"r1","objectId":"node-a","kind":"text","message":"原图中此名称看不清，请确认","sourceRect":{"x":80,"y":80,"width":140,"height":60},"status":"needsReview"}`。kind 为 text/relationship/shape/region。尚未确定的区域可省略 objectId。sourceRect 对应截图像素坐标，不是图稿坐标。不要自行标记 confirmed。

文件≤20 MiB、可见对象≤1000、分组深度≤10。截图不是附件；图片对象仅支持内嵌 PNG/JPEG：draw.io style 使用 `image=data:image/png,BASE64;`。
