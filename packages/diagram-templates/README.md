# 内置图稿模板

36 个中文模板，分为系统架构（24）、业务流程（7）、数据设计（3）、组织与规划（2）。其中 18 个架构进阶模板位于 `architecture.ts`，6 个综合进阶模板位于 `advanced.ts`，包含分层容器、多角色泳道、异常分支和运维环节；原有 12 个模板保留为基础模板。节点与连线数据同时生成 `.drawio` 内容和 SVG 预览，所有内置资源随应用打包，不访问外网。

模板为本项目重新编排绘制，参考公开资料中的通用图式；未复制第三方图库的 XML、图片、品牌图标或专有素材。参考资料于 2026-09-20 检索：

| 参考资料 | 对应模板 |
| --- | --- |
| [Azure 架构风格](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/) | 经典分层架构、微服务架构、数据处理管道 |
| [Azure Web-Queue-Worker](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/web-queue-worker) | 异步任务架构 |
| [draw.io 技术图例](https://www.drawio.com/docs/diagram-types/) | 高可用部署架构、基础判断流程、申请审批流程、CI/CD 发布流程、订单实体关系、团队组织架构、项目规划导图 |
| [draw.io 泳道图](https://www.drawio.com/docs/diagram-types/swimlane-diagrams/) | 跨部门泳道流程 |
| [ProcessOn 架构图指南](https://www.processon.com/framework) | 电商平台全景架构、云原生双可用区部署、实时离线数据仓库 |
| [ProcessOn 采购流程指南](https://www.processon.com/knowledge/caigouliuchengtu) | 采购审批与验收泳道 |
| [draw.io 技术图例](https://www.drawio.com/docs/diagram-types/) | 订单交易与履约闭环、灰度发布与回滚流水线 |

## 新增架构模板目录

所有模板归入系统架构分类；节点数量包含可编辑容器。参考资料用于理解通用模式，图稿使用本项目的布局与中文示例重新绘制。

| 模板 | 节点 / 连线 | 参考资料 |
| --- | --- | --- |
| Android APP · MVVM 分层架构 | 25 / 17 | [Android Developers · App 架构](https://developer.android.com/topic/architecture) |
| 大型 APP · 组件化与模块依赖 | 19 / 17 | [Android Developers · 模块化](https://developer.android.com/topic/modularization) |
| 移动 APP · 离线优先与同步架构 | 15 / 13 | [Android Developers · 离线优先](https://developer.android.com/topic/architecture/data-layer/offline-first) |
| Flutter APP · 跨平台业务架构 | 20 / 14 | [Flutter · 应用架构指南](https://docs.flutter.dev/app-architecture/guide) |
| 多端接入 · BFF 服务架构 | 20 / 15 | [Azure · BFF 模式](https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends) |
| DDD · 端口与适配器架构 | 15 / 11 | [AWS · 六边形架构](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html) |
| 微服务 · 服务治理与可观测架构 | 20 / 16 | [Azure · 微服务设计](https://learn.microsoft.com/en-us/azure/architecture/microservices/design/) |
| 事件驱动 · 发布订阅与可靠消费 | 15 / 12 | [Azure · 事件驱动架构](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven) |
| CQRS · 读写分离与事件投影 | 20 / 15 | [Azure · CQRS 模式](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs) |
| SaaS · 多租户平台架构 | 20 / 15 | [AWS · SaaS 架构视角](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/saas-lens.html) |
| Serverless · Web 与异步任务架构 | 20 / 15 | [AWS · Serverless Web 应用](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/web-application.html) |
| Kubernetes · 控制面与工作节点 | 20 / 16 | [Kubernetes · 集群架构](https://kubernetes.io/docs/concepts/architecture/) |
| 跨地域容灾 · 主备与故障切换 | 15 / 14 | [AWS · 灾难恢复策略](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html) |
| IoT · 边缘设备与云平台架构 | 15 / 12 | [AWS · 设备遥测参考架构](https://docs.aws.amazon.com/reference-architecture-diagrams/latest/connected-home-telemetry/connected-home-telemetry.html) |
| AI 应用 · RAG 知识检索架构 | 20 / 18 | [Azure · RAG 方案设计](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide) |
| 可观测平台 · 日志指标链路架构 | 20 / 15 | [OpenTelemetry · Collector 架构](https://opentelemetry.io/docs/collector/architecture/) |
| 数据平台 · 湖仓一体分层架构 | 15 / 11 | [Databricks · Medallion 湖仓](https://docs.databricks.com/aws/en/lakehouse/medallion) |
| C4 · 系统容器与外部依赖 | 20 / 15 | [C4 model · 容器图](https://c4model.com/diagrams/container) |

新增架构模板通过正交避障路由保持连线不穿过组件；容器表达责任边界，虚线表达配置、实现关系或切换路径，具体含义见连线文字。

## 添加模板

向 `templates` 添加定义，指定唯一 ID、分类、名称、描述、标签、参考来源、节点和连线。坐标以画布绝对位置表示；泳道子节点指定 `parent`，XML 序列化时转换为容器相对位置。连线绑定节点，支持端点方向和折点。

`templateXml` 不复用模板文档 ID，每次创建通过现有文档校验获得新 ID。保存、分享、导出与其他图稿使用同一链路。`templateSvg` 是离线矢量预览，与 XML 共享图形、布局、文字、颜色和连线端点；字体与标签定位的细节由各自渲染器处理。

## 个人模板

编辑器通过「保存为模板」捕获独立图稿快照，以现有离线渲染队列生成 PNG。服务器核对渲染任务所有者、整图范围和内容摘要后，保存到 `templates.sqlite`。模板按身份隔离；列表不返回 XML，实例化接口检查所有权。复用时分配新的文档 ID，填充现有空白图稿则保留该图稿的元数据。

支持 `GET/POST /api/templates`、`PATCH/DELETE /api/templates/:id`、`POST /api/templates/:id/instantiate`。个人模板最多 100 个/身份，预览最大 4 MiB；文档沿用现有 Profile 校验。原图的来源、识别核对元数据不会传给新副本，图形、容器、样式和连线保持完整。

验证：`npm run build` 后执行 `npm run test:templates`，覆盖文档校验、独立身份、字段换行、36 个真实画布加载、架构图连线避障与容器边界、复杂度筛选、预览缩放、个人模板持久化、权限隔离、复用、编辑、删除与错误重试。
