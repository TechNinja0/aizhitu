# 常见诊断

- XML_INVALID：检查 XML 转义、mxfile/diagram/mxGraphModel/root 层级；首版只允许单画布。
- DUPLICATE_ID：每个对象使用唯一 ID，同步修改必要引用。
- EDGE_ENDPOINT_MISSING：关系边必须引用实际存在的节点，不能用图形名字代替 ID。
- PARENT_CYCLE / PARENT_MISSING：检查容器层级，组内坐标采用相对坐标。
- UNSUPPORTED_FEATURE：改用已支持的基础图形/样式；不能把不支持对象悄悄删掉。
- RESOURCE_LIMIT：减少非必要嵌入图片，或向用户说明超出范围；不能删减业务关系绕过限制。
- METADATA_INVALID / REVIEW_TARGET_MISSING：检查 JSON 转义、疑点对象 ID 和截图坐标。
- FONT_SUBSTITUTED：原字体无法保证离线；改用 Noto Sans SC 并核对换行。

最多自动修复三轮，仍失败保留候选和诊断。渲染错误和文件结构错误分开报告。
