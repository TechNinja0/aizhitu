# 内置图稿模板

12 个中文模板，分为系统架构（4）、业务流程（4）、数据设计（2）、组织与规划（2）。`index.ts` 中的节点与连线数据同时生成 `.drawio` 内容和 SVG 预览，所有资源随应用打包，浏览、选择、创建不访问外网。

模板为本项目重新编排绘制，参考公开资料中的通用图式；未复制第三方图库的 XML、图片、品牌图标或专有素材。参考资料于 2026-09-20 检索：

| 参考资料 | 对应模板 |
| --- | --- |
| [Azure 架构风格](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/) | 经典分层架构、微服务架构、数据处理管道 |
| [Azure Web-Queue-Worker](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/web-queue-worker) | 异步任务架构 |
| [draw.io 技术图例](https://www.drawio.com/docs/diagram-types/) | 高可用部署架构、基础判断流程、申请审批流程、CI/CD 发布流程、订单实体关系、团队组织架构、项目规划导图 |
| [draw.io 泳道图](https://www.drawio.com/docs/diagram-types/swimlane-diagrams/) | 跨部门泳道流程 |

## 添加模板

向 `templates` 添加定义，指定唯一 ID、分类、名称、描述、标签、参考来源、节点和连线。坐标以画布绝对位置表示；泳道子节点指定 `parent`，XML 序列化时转换为容器相对位置。连线绑定节点，支持端点方向和折点。

`templateXml` 不复用模板文档 ID，每次创建通过现有文档校验获得新 ID。保存、分享、导出与其他图稿使用同一链路。`templateSvg` 是离线矢量预览，与 XML 共享图形、布局、文字、颜色和连线端点；字体与标签定位的细节由各自渲染器处理。

验证：`npm run build` 后执行 `npm run test:templates`，覆盖文档校验、独立身份、字段换行、12 个真实画布加载、筛选、预览、保存、未保存保护、共享持久化和错误重试。
