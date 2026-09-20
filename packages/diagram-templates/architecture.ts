import type { DiagramTemplate, TemplateNode, TemplateEdge } from "./index";
import { routeArchitecture } from "./architecture-routing";

// Original editable layouts. References describe the pattern; product names and
// deployment choices below are examples, not required configurations.
type Item = [id: string, label: string, shape?: TemplateNode["shape"]];
type Source = DiagramTemplate["source"];
const sources = {
  android: {
    name: "Android Developers · App 架构",
    url: "https://developer.android.com/topic/architecture",
  },
  modular: {
    name: "Android Developers · 模块化",
    url: "https://developer.android.com/topic/modularization",
  },
  offline: {
    name: "Android Developers · 离线优先",
    url: "https://developer.android.com/topic/architecture/data-layer/offline-first",
  },
  flutter: {
    name: "Flutter · 应用架构指南",
    url: "https://docs.flutter.dev/app-architecture/guide",
  },
  bff: {
    name: "Azure · BFF 模式",
    url: "https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends",
  },
  hexagonal: {
    name: "AWS · 六边形架构",
    url: "https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html",
  },
  services: {
    name: "Azure · 微服务设计",
    url: "https://learn.microsoft.com/en-us/azure/architecture/microservices/design/",
  },
  events: {
    name: "Azure · 事件驱动架构",
    url: "https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven",
  },
  cqrs: {
    name: "Azure · CQRS 模式",
    url: "https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs",
  },
  saas: {
    name: "AWS · SaaS 架构视角",
    url: "https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/saas-lens.html",
  },
  serverless: {
    name: "AWS · Serverless Web 应用",
    url: "https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/web-application.html",
  },
  kubernetes: {
    name: "Kubernetes · 集群架构",
    url: "https://kubernetes.io/docs/concepts/architecture/",
  },
  recovery: {
    name: "AWS · 灾难恢复策略",
    url: "https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html",
  },
  iot: {
    name: "AWS · 设备遥测参考架构",
    url: "https://docs.aws.amazon.com/reference-architecture-diagrams/latest/connected-home-telemetry/connected-home-telemetry.html",
  },
  rag: {
    name: "Azure · RAG 方案设计",
    url: "https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide",
  },
  telemetry: {
    name: "OpenTelemetry · Collector 架构",
    url: "https://opentelemetry.io/docs/collector/architecture/",
  },
  lakehouse: {
    name: "Databricks · Medallion 湖仓",
    url: "https://docs.databricks.com/aws/en/lakehouse/medallion",
  },
  c4: {
    name: "C4 model · 容器图",
    url: "https://c4model.com/diagrams/container",
  },
} satisfies Record<string, Source>;

class Diagram {
  nodes: TemplateNode[] = [];
  edges: TemplateEdge[] = [];
  constructor(
    private details: Pick<
      DiagramTemplate,
      "id" | "name" | "description" | "tags" | "source"
    >,
  ) {}
  // A row represents a responsibility boundary, not a sequential flow.
  row(
    id: string,
    label: string,
    y: number,
    tone: TemplateNode["tone"],
    items: Item[],
  ) {
    const width = 1360,
      gap = 36,
      w = (width - 64 - (items.length - 1) * gap) / items.length;
    this.nodes.push({
      id,
      label,
      x: 40,
      y,
      w: width,
      h: 170,
      tone,
      shape: "lane",
    });
    items.forEach(([key, text, shape = "box"], i) =>
      this.nodes.push({
        id: key,
        label: text,
        x: 72 + i * (w + gap),
        y: y + 68,
        w,
        h: 76,
        tone,
        shape,
        parent: id,
      }),
    );
    return this;
  }
  column(
    id: string,
    label: string,
    x: number,
    tone: TemplateNode["tone"],
    items: Item[],
  ) {
    this.nodes.push({
      id,
      label,
      x,
      y: 40,
      w: 300,
      h: 70 + items.length * 130,
      tone,
      shape: "lane",
    });
    items.forEach(([key, text, shape = "box"], i) =>
      this.nodes.push({
        id: key,
        label: text,
        x: x + 30,
        y: 110 + i * 130,
        w: 240,
        h: 76,
        tone,
        shape,
        parent: id,
      }),
    );
    return this;
  }
  link(
    source: string,
    target: string,
    label?: string,
    direction: "v" | "h" = "v",
    dashed = false,
  ) {
    const s = this.nodes.find((n) => n.id === source)!,
      t = this.nodes.find((n) => n.id === target)!;
    const forward = direction === "v" ? t.y > s.y : t.x > s.x;
    this.edges.push({
      source,
      target,
      label,
      dashed,
      from:
        direction === "v"
          ? forward
            ? "bottom"
            : "top"
          : forward
            ? "right"
            : "left",
      to:
        direction === "v"
          ? forward
            ? "top"
            : "bottom"
          : forward
            ? "left"
            : "right",
    });
    return this;
  }
  side(
    source: string,
    target: string,
    label: string,
    side: "left" | "right",
    dashed = false,
  ) {
    this.edges.push({ source, target, label, from: side, to: side, dashed });
    return this;
  }
  done(): DiagramTemplate {
    return {
      ...this.details,
      category: "architecture",
      complexity: "advanced",
      nodes: this.nodes,
      edges: routeArchitecture(this.nodes, this.edges),
    };
  }
}
const diagram = (
  id: string,
  name: string,
  description: string,
  tags: string[],
  source: Source,
) => new Diagram({ id, name, description, tags: ["进阶", ...tags], source });

const android = diagram(
  "app-mvvm",
  "Android APP · MVVM 分层架构",
  "以登录与内容场景展示 UI、ViewModel、可选领域层、Repository 和数据源，标明依赖方向与状态回传。",
  ["APP", "移动端", "Android", "MVVM", "Compose", "分层"],
  sources.android,
)
  .row("ui", "01  UI / 页面与导航", 30, "blue", [
    ["login-ui", "登录页面\nCompose / Activity"],
    ["feed-ui", "内容列表\nUI State 渲染"],
    ["detail-ui", "详情页面\n用户事件"],
    ["nav", "导航宿主\n路由 / 返回栈"],
  ])
  .row("state", "02  状态持有 / ViewModel", 270, "green", [
    ["login-vm", "LoginViewModel\n登录状态"],
    ["feed-vm", "FeedViewModel\n分页 / 刷新"],
    ["detail-vm", "DetailViewModel\n收藏 / 加载"],
    ["saved", "SavedStateHandle\n页面状态恢复"],
  ])
  .row("domain", "03  领域层 / 复杂逻辑按需引入", 510, "green", [
    ["sign-in", "SignInUseCase\n账户校验"],
    ["get-feed", "GetFeedUseCase\n内容组合"],
    ["bookmark", "BookmarkUseCase\n收藏规则"],
    ["policy", "领域模型与规则\n纯业务逻辑"],
  ])
  .row("data", "04  数据层 / Repository 协调数据源", 750, "amber", [
    ["user-repo", "UserRepository\n会话数据"],
    ["feed-repo", "FeedRepository\n内容数据"],
    ["mark-repo", "BookmarkRepository\n收藏数据"],
    ["prefs-repo", "SettingsRepository\n偏好设置"],
  ])
  .row("source", "05  数据源 / 持久化与外部系统", 990, "gray", [
    ["api", "HTTP API\n认证 / 内容接口"],
    ["room", "Room 数据库\n本地内容缓存", "database"],
    ["marks", "收藏表\n离线持久化", "database"],
    ["prefs", "DataStore\n用户偏好", "database"],
  ])
  .link("login-ui", "login-vm", "用户事件")
  .link("feed-ui", "feed-vm", "事件 / 状态订阅")
  .link("detail-ui", "detail-vm", "事件 / 状态订阅")
  .link("nav", "saved", "恢复")
  .link("login-vm", "sign-in")
  .link("feed-vm", "get-feed")
  .link("detail-vm", "bookmark")
  .link("bookmark", "policy", "规则", "h")
  .link("sign-in", "user-repo")
  .link("get-feed", "feed-repo")
  .link("bookmark", "mark-repo")
  .link("saved", "prefs-repo", "持久配置")
  .link("user-repo", "api")
  .link("feed-repo", "room", "读取 / 更新")
  .link("mark-repo", "marks")
  .link("prefs-repo", "prefs")
  .link("feed-repo", "api", "远端刷新")
  .done();

const modular = diagram(
  "app-modular",
  "大型 APP · 组件化与模块依赖",
  "按应用装配、业务功能、数据能力、基础设施划分模块，表达构建依赖而非运行时请求；功能模块通过导航契约协作。",
  ["APP", "Android", "组件化", "模块化", "移动端"],
  sources.modular,
)
  .row("assembly", "01  应用装配 / 组合功能与依赖", 30, "blue", [
    ["app", ":app\n启动 / 依赖注入"],
    ["routing", ":core:navigation\n路由契约"],
    ["design", ":core:designsystem\n主题 / 通用组件"],
  ])
  .row("features", "02  业务模块 / 独立实现与测试", 280, "green", [
    ["home", ":feature:home\n首页"],
    ["search", ":feature:search\n搜索"],
    ["profile", ":feature:profile\n个人中心"],
    ["checkout", ":feature:checkout\n结算"],
  ])
  .row("repositories", "03  数据模块 / 稳定的数据访问接口", 530, "amber", [
    ["catalog", ":data:catalog\n商品与内容"],
    ["account", ":data:account\n账户与会话"],
    ["order", ":data:order\n交易数据"],
    ["models", ":core:model\n共享数据模型"],
  ])
  .row("foundation", "04  基础设施 / 禁止反向依赖业务模块", 780, "gray", [
    ["network", ":core:network\nHTTP / 序列化"],
    ["database", ":core:database\n表与迁移", "database"],
    ["common", ":core:common\n调度 / 通用工具"],
    ["testing", ":core:testing\n测试替身 / 测试数据"],
  ])
  .link("app", "home", "装配")
  .link("app", "search", "装配")
  .link("app", "profile", "装配")
  .link("app", "checkout", "装配")
  .link("home", "routing", "路由接口")
  .link("search", "design", "UI 组件")
  .link("home", "catalog")
  .link("search", "catalog")
  .link("profile", "account")
  .link("checkout", "order")
  .link("catalog", "network")
  .link("catalog", "database")
  .link("account", "network")
  .link("order", "database")
  .link("models", "common")
  .link("order", "models", "类型", "h")
  .link("models", "testing", "测试数据")
  .done();

const offline = diagram(
  "app-offline",
  "移动 APP · 离线优先与同步架构",
  "将本地库作为界面读取源，写入本地数据与待同步队列；后台同步包含网络约束、重试、版本冲突与增量拉取。",
  ["APP", "离线", "同步", "弱网", "Android"],
  sources.offline,
)
  .column("device", "设备侧 / 可离线工作", 40, "blue", [
    ["screen", "页面与状态持有者\n订阅本地变化"],
    ["repo", "Repository\n读写协调"],
    ["local", "本地数据库\n界面读取源", "database"],
    ["outbox", "待同步记录\n本地事务写入", "database"],
  ])
  .column("sync", "同步边界 / 可恢复任务", 470, "green", [
    ["network", "网络与电量约束\n后台任务调度"],
    ["worker", "同步执行器\n增量 / 批量"],
    ["conflict", "冲突合并\n版本号 / 用户选择"],
    ["retry", "重试与退避\n幂等键 / 游标"],
  ])
  .column("cloud", "服务端 / 跨设备一致性", 900, "amber", [
    ["auth", "认证与权限\n访问令牌"],
    ["api", "同步 API\n拉取 / 提交"],
    ["db", "服务端数据库\n版本 / 变更日志", "database"],
    ["push", "变更通知\n提示客户端刷新"],
  ])
  .link("screen", "repo", "事件 / 订阅")
  .link("repo", "local", "先写本地")
  .link("local", "outbox", "同一事务")
  .link("network", "worker", "满足条件")
  .link("outbox", "retry", "待同步", "h")
  .link("retry", "worker", "调度重试")
  .link("worker", "conflict", "冲突响应")
  .link("conflict", "local", "合并写回", "h")
  .link("worker", "api", "上传 / 拉取", "h")
  .link("api", "auth", "鉴权")
  .link("api", "db", "版本校验")
  .link("db", "push", "变更事件")
  .link("push", "retry", "唤醒同步", "h")
  .done();

const flutter = diagram(
  "flutter-app",
  "Flutter APP · 跨平台业务架构",
  "按官方 MVVM 建议组织页面、ViewModel、Repository 和 Service，并补充原生能力适配与平台存储边界。",
  ["APP", "Flutter", "跨平台", "MVVM", "移动端"],
  sources.flutter,
)
  .row("views", "01  视图层 / 跨平台 UI", 30, "blue", [
    ["login", "登录视图\n表单与反馈"],
    ["list", "列表视图\n加载与空状态"],
    ["detail", "详情视图\n展示与操作"],
    ["router", "路由与应用外壳\n页面切换"],
  ])
  .row("vm", "02  ViewModel / UI 状态与命令", 270, "green", [
    ["auth-vm", "AuthViewModel\n认证命令"],
    ["list-vm", "ListViewModel\n分页状态"],
    ["detail-vm", "DetailViewModel\n详情与收藏"],
    ["app-vm", "AppViewModel\n主题 / 会话"],
  ])
  .row("repos", "03  Repository / 应用数据源", 510, "amber", [
    ["auth-repo", "AuthRepository\n账户与令牌"],
    ["content-repo", "ContentRepository\n缓存 / 内容"],
    ["favorite-repo", "FavoritesRepository\n收藏持久化"],
    ["settings-repo", "SettingsRepository\n用户偏好"],
  ])
  .row("services", "04  Service / 数据与平台边界", 750, "gray", [
    ["remote", "API Service\nHTTP / JSON"],
    ["local", "Local Service\n本地数据库", "database"],
    ["native", "Platform Service\n相机 / 定位插件"],
    ["secure", "Storage Service\n安全存储 / 偏好"],
  ])
  .link("login", "auth-vm")
  .link("list", "list-vm")
  .link("detail", "detail-vm")
  .link("router", "app-vm")
  .link("auth-vm", "auth-repo")
  .link("list-vm", "content-repo")
  .link("detail-vm", "favorite-repo")
  .link("app-vm", "settings-repo")
  .link("auth-repo", "remote")
  .link("content-repo", "remote")
  .link("content-repo", "local")
  .link("favorite-repo", "local")
  .link("content-repo", "native", "平台数据")
  .link("settings-repo", "secure")
  .done();

const bff = diagram(
  "bff-platform",
  "多端接入 · BFF 服务架构",
  "区分移动端、Web 与运营端的聚合职责，将认证和限流放在接入边界，业务服务与数据保持独立。",
  ["APP", "Web", "BFF", "服务架构", "网关"],
  sources.bff,
)
  .row("clients", "01  多端渠道", 30, "blue", [
    ["mobile", "移动 APP\n轻量响应 / 弱网"],
    ["web", "Web 门户\n富交互 / 多页面"],
    ["admin", "运营工作台\n批量管理"],
    ["identity", "身份提供方\nOIDC / SSO"],
  ])
  .row("access", "02  统一接入 / 跨端策略", 270, "green", [
    ["mgw", "移动接入路由\n令牌校验 / 配额"],
    ["wgw", "Web 接入路由\n会话校验 / WAF"],
    ["agw", "管理接入路由\n角色与审计"],
    ["policy", "网关策略\n限流 / 监控"],
  ])
  .row("bff", "03  端侧聚合 / 避免承载核心领域规则", 510, "green", [
    ["mbff", "Mobile BFF\n聚合 / 精简字段"],
    ["wbff", "Web BFF\n分页 / 页面组合"],
    ["abff", "Admin BFF\n操作编排"],
    ["cache", "聚合缓存\n按身份隔离", "database"],
  ])
  .row("services", "04  领域服务", 750, "amber", [
    ["users", "用户服务\n账户 / 权限"],
    ["catalog", "商品服务\n检索 / 详情"],
    ["orders", "订单服务\n交易规则"],
    ["audit", "审计服务\n操作记录"],
  ])
  .link("mobile", "mgw")
  .link("web", "wgw")
  .link("admin", "agw")
  .link("mgw", "identity", "认证")
  .link("policy", "mgw", "策略", "h", true)
  .link("mgw", "mbff")
  .link("wgw", "wbff")
  .link("agw", "abff")
  .link("wbff", "cache", "读取", "h")
  .link("mbff", "users")
  .link("mbff", "catalog")
  .link("wbff", "catalog")
  .link("wbff", "orders")
  .link("abff", "orders")
  .link("abff", "audit")
  .done();

const hexagonal = diagram(
  "ddd-hexagonal",
  "DDD · 端口与适配器架构",
  "用订单领域演示入站适配、应用用例、领域模型和出站端口；虚线标明实现关系，业务核心不依赖外部实现。",
  ["DDD", "六边形", "Clean Architecture", "系统架构", "依赖倒置"],
  sources.hexagonal,
)
  .column("inbound", "入站适配器", 40, "blue", [
    ["rest", "REST Controller\nHTTP DTO"],
    ["consumer", "事件消费者\n集成消息"],
    ["job", "定时任务\n超时关单"],
    ["test", "用例测试\n测试驱动入口"],
  ])
  .column("core", "应用与领域核心", 470, "green", [
    ["port", "入站端口\n用例接口"],
    ["usecase", "应用服务\n事务 / 用例编排"],
    ["aggregate", "订单聚合\n实体 / 值对象"],
    ["outport", "出站端口\n仓储 / 支付接口"],
  ])
  .column("adapters", "出站适配器", 900, "amber", [
    ["sql", "持久化适配器\n实现仓储接口"],
    ["payment", "支付适配器\n实现支付接口"],
    ["publisher", "消息适配器\n发布领域事件"],
    ["fake", "内存适配器\n测试替身"],
  ])
  .link("rest", "port", "调用", "h")
  .link("consumer", "port", "调用", "h")
  .link("job", "port", "调用", "h")
  .link("test", "port", "调用", "h")
  .link("port", "usecase", "实现用例")
  .link("usecase", "aggregate", "执行业务")
  .link("usecase", "outport", "依赖抽象")
  .link("sql", "outport", "实现", "h", true)
  .link("payment", "outport", "实现", "h", true)
  .link("publisher", "outport", "实现", "h", true)
  .link("fake", "outport", "实现", "h", true)
  .done();

const governance = diagram(
  "service-governance",
  "微服务 · 服务治理与可观测架构",
  "展示网关、独立业务服务与存储，以及注册发现、配置下发、流量策略和遥测采集的控制关系。",
  ["服务架构", "微服务", "治理", "注册中心", "可观测"],
  sources.services,
)
  .row("entry", "01  接入边界", 30, "blue", [
    ["client", "APP / Web\n外部调用"],
    ["gateway", "API 网关\n路由 / 限流"],
    ["auth", "统一身份\n令牌 / 授权"],
    ["config", "配置与服务发现\n实例目录"],
  ])
  .row("apps", "02  业务服务 / 独立部署", 290, "green", [
    ["user", "用户服务\n账户领域"],
    ["order", "订单服务\n交易领域"],
    ["inventory", "库存服务\n预占 / 释放"],
    ["payment", "支付服务\n支付 / 对账"],
  ])
  .row("state", "03  私有数据 / 通过 API 或事件协作", 550, "amber", [
    ["userdb", "用户数据库", "database"],
    ["orderdb", "订单数据库", "database"],
    ["stockdb", "库存数据库", "database"],
    ["paydb", "支付数据库", "database"],
  ])
  .row("ops", "04  运行支撑 / 遥测与治理", 810, "gray", [
    ["collector", "遥测采集\nTrace / Log / Metric"],
    ["dashboard", "服务看板\n依赖 / SLO"],
    ["alerts", "告警与值班\n异常定位"],
    ["control", "流量策略\n超时 / 熔断 / 重试"],
  ])
  .link("client", "gateway", "HTTPS", "h")
  .link("gateway", "auth", "鉴权", "h")
  .link("gateway", "user")
  .link("gateway", "order")
  .link("gateway", "inventory")
  .link("gateway", "payment")
  .link("config", "payment", "发现 / 配置", "v", true)
  .link("user", "userdb")
  .link("order", "orderdb")
  .link("inventory", "stockdb")
  .link("payment", "paydb")
  .side("user", "collector", "遥测", "left")
  .side("payment", "control", "策略", "right", true)
  .link("collector", "dashboard", "聚合", "h")
  .link("dashboard", "alerts", "阈值", "h")
  .link("control", "alerts", "治理事件", "h")
  .done();

const events = diagram(
  "event-platform",
  "事件驱动 · 发布订阅与可靠消费",
  "以订单、支付、设备事件为例，覆盖事件总线、消费组、幂等处理、死信与重放，表达异步解耦。",
  ["服务架构", "EDA", "事件驱动", "Kafka", "消息队列"],
  sources.events,
)
  .column("producers", "事件生产者", 40, "blue", [
    ["order", "订单领域\n业务事件"],
    ["payment", "支付领域\n支付结果"],
    ["device", "设备接入\n状态事件"],
    ["outbox", "Outbox / CDC\n可靠发布"],
  ])
  .column("channel", "事件通道", 470, "amber", [
    ["orders-topic", "订单主题\n分区 / 保留"],
    ["payments-topic", "支付主题\n顺序 / 重试"],
    ["devices-topic", "遥测主题\n吞吐 / 保留"],
    ["schema", "事件契约\nSchema / 版本"],
  ])
  .column("consumers", "独立消费组", 900, "green", [
    ["fulfill", "履约服务\n幂等处理"],
    ["notify", "通知服务\n去重 / 模板"],
    ["analytics", "分析服务\n聚合窗口"],
    ["dlq", "死信与重放\n隔离失败消息"],
  ])
  .link("order", "outbox", "同事务记录")
  .link("payment", "outbox", "同事务记录")
  .link("outbox", "orders-topic", "订单事件", "h")
  .link("outbox", "payments-topic", "支付事件", "h")
  .link("device", "devices-topic", "遥测", "h")
  .link("schema", "orders-topic", "契约", "v", true)
  .link("orders-topic", "fulfill", "订阅", "h")
  .link("payments-topic", "notify", "订阅", "h")
  .link("devices-topic", "analytics", "订阅", "h")
  .link("fulfill", "dlq", "重试耗尽")
  .link("notify", "dlq", "重试耗尽")
  .link("dlq", "notify", "人工修复后重放")
  .done();

const cqrs = diagram(
  "cqrs-outbox",
  "CQRS · 读写分离与事件投影",
  "独立写模型与读模型，通过事务 Outbox 发布变更并更新查询投影，标注最终一致性与幂等边界。",
  ["服务架构", "CQRS", "读写分离", "Outbox", "事件投影"],
  sources.cqrs,
)
  .row("api", "01  接口分工", 30, "blue", [
    ["command", "命令 API\n创建 / 修改"],
    ["query", "查询 API\n筛选 / 汇总"],
    ["auth", "访问控制\n身份 / 租户"],
    ["contract", "接口契约\n版本 / 校验"],
  ])
  .row("logic", "02  业务与查询模型", 270, "green", [
    ["handler", "命令处理器\n领域约束"],
    ["reader", "查询处理器\n只读投影"],
    ["rules", "领域模型\n聚合 / 不变量"],
    ["projector", "投影处理器\n去重 / 检查点"],
  ])
  .row("storage", "03  存储与事务边界", 510, "amber", [
    ["write", "写库 + Outbox\n同一事务提交", "database"],
    ["read", "查询投影库\n面向读取优化", "database"],
    ["relay", "Outbox Relay\n轮询 / CDC"],
    ["bus", "事件通道\n至少一次投递"],
  ])
  .row("recovery", "04  一致性与恢复", 750, "gray", [
    ["audit", "命令审计\n幂等请求记录"],
    ["status", "版本 / 同步状态\n提示读取延迟"],
    ["dlq", "失败事件隔离\n告警 / 修复"],
    ["replay", "投影重建\n重放保留事件"],
  ])
  .link("command", "handler")
  .link("query", "reader")
  .link("auth", "command", "授权", "h")
  .link("contract", "auth", "策略", "h")
  .link("handler", "rules", "业务校验", "h")
  .link("handler", "write", "事务写入")
  .link("reader", "read", "只读查询")
  .link("write", "relay", "变更", "h")
  .link("relay", "bus", "发布", "h")
  .link("bus", "projector", "异步消费")
  .link("projector", "read", "幂等更新")
  .link("write", "audit")
  .link("read", "status")
  .link("bus", "dlq", "失败")
  .link("bus", "replay", "保留事件")
  .done();

const saas = diagram(
  "saas-multitenant",
  "SaaS · 多租户平台架构",
  "分开租户控制面和业务面，包含开通、套餐、计量、租户上下文传播，以及共享池与独享资源的隔离选择。",
  ["系统架构", "SaaS", "多租户", "控制面", "租户隔离"],
  sources.saas,
)
  .row("access", "01  身份与租户边界", 30, "blue", [
    ["portal", "租户门户\n登录 / 工作台"],
    ["identity", "身份服务\n用户 + Tenant ID"],
    ["gateway", "业务 API 网关\n租户上下文 / 配额"],
    ["admin", "平台运营台\n租户管理"],
  ])
  .row("control", "02  控制面 / 租户生命周期", 270, "gray", [
    ["onboard", "开通编排\n创建租户资源"],
    ["plans", "套餐与配额\n功能开关"],
    ["meter", "使用量计量\n账单汇总"],
    ["registry", "租户目录\n资源位置 / 状态", "database"],
  ])
  .row("business", "03  业务面 / 请求始终携带租户上下文", 510, "green", [
    ["shared", "共享业务池\n按租户授权"],
    ["isolated", "独享业务实例\n高隔离租户"],
    ["usage", "计量事件收集\n请求 / 存储用量"],
    ["resolver", "资源解析\n定位租户数据"],
  ])
  .row("data", "04  数据隔离 / 按套餐选择", 750, "amber", [
    ["pool", "共享数据池\nTenant ID 过滤", "database"],
    ["silo", "独立租户数据库\n独立凭据", "database"],
    ["billing", "计费与审计库\n租户维度", "database"],
    ["objects", "对象存储\n租户前缀 / 策略", "database"],
  ])
  .link("portal", "identity", "登录", "h")
  .link("identity", "gateway", "租户令牌", "h")
  .link("admin", "registry", "管理")
  .link("onboard", "registry", "登记", "h")
  .link("plans", "onboard", "套餐", "h")
  .link("onboard", "shared", "开通")
  .link("plans", "isolated", "隔离策略")
  .link("usage", "meter", "用量上报")
  .link("registry", "resolver", "查目录")
  .side("gateway", "resolver", "路由", "right")
  .link("shared", "pool")
  .link("isolated", "silo")
  .link("usage", "billing")
  .link("resolver", "objects")
  .link("shared", "usage", "事件", "h")
  .done();

const serverless = diagram(
  "serverless-web",
  "Serverless · Web 与异步任务架构",
  "采用 AWS 服务举例，覆盖静态托管、认证、同步 API、对象上传触发、队列消费和故障恢复。",
  ["系统架构", "Serverless", "AWS", "Lambda", "无服务器"],
  sources.serverless,
)
  .row("edge", "01  用户接入与静态内容", 30, "blue", [
    ["browser", "Web / 移动 APP\nHTTPS"],
    ["cdn", "CloudFront\n内容分发"],
    ["static", "S3 静态站点\n前端资源", "database"],
    ["auth", "Cognito\n身份与令牌"],
  ])
  .row("compute", "02  同步业务路径", 280, "green", [
    ["apigw", "API Gateway\n认证 / 配额"],
    ["function", "Lambda API\n业务处理"],
    ["db", "DynamoDB\n业务数据", "database"],
    ["upload", "S3 上传区\n文件 / 事件", "database"],
  ])
  .row("async", "03  异步任务路径", 530, "amber", [
    ["schedule", "EventBridge\n计划 / 业务事件"],
    ["queue", "SQS 队列\n缓冲 / 重试"],
    ["worker", "Lambda Consumer\n幂等执行"],
    ["result", "S3 结果区\n任务产物", "database"],
  ])
  .row("support", "04  运维与恢复", 780, "gray", [
    ["iam", "IAM 执行角色\n最小权限"],
    ["logs", "CloudWatch\n日志 / 指标"],
    ["dlq", "死信队列\n失败隔离"],
    ["alert", "告警与回放\n排障 / 重试"],
  ])
  .link("browser", "cdn", "访问", "h")
  .link("cdn", "static", "取静态资源", "h")
  .link("browser", "apigw", "调用 API")
  .link("auth", "apigw", "校验令牌")
  .link("apigw", "function", "调用", "h")
  .link("function", "db", "读写", "h")
  .link("function", "upload", "预签名上传", "h")
  .link("upload", "queue", "对象事件")
  .link("schedule", "queue", "投递", "h")
  .link("queue", "worker", "触发", "h")
  .link("worker", "result", "写产物", "h")
  .link("worker", "logs", "遥测")
  .link("queue", "dlq", "耗尽重试")
  .link("dlq", "alert", "通知", "h")
  .link("iam", "logs", "审计", "h")
  .done();

const k8s = diagram(
  "kubernetes-cluster",
  "Kubernetes · 控制面与工作节点",
  "区分控制面、节点代理与业务负载，展示 API Server、etcd、调度器和控制器的关系，避免把控制流画成业务流。",
  ["云部署", "Kubernetes", "K8s", "容器", "集群"],
  sources.kubernetes,
)
  .row("control", "01  控制面 / 集群期望状态", 30, "blue", [
    ["scheduler", "Scheduler\n选择目标节点"],
    ["api", "API Server\n认证 / 资源 API"],
    ["etcd", "etcd\n集群状态", "database"],
    ["controller", "Controller Manager\n调谐资源状态"],
  ])
  .row("agents", "02  节点代理 / 两个工作节点示例", 290, "green", [
    ["kubelet-a", "Node A · kubelet\nPod 生命周期"],
    ["runtime-a", "Node A · Runtime\n容器运行时"],
    ["kubelet-b", "Node B · kubelet\nPod 生命周期"],
    ["runtime-b", "Node B · Runtime\n容器运行时"],
  ])
  .row("pods", "03  业务负载与服务网络", 550, "green", [
    ["pod-a", "Node A · Pod\nAPI 副本"],
    ["network-a", "Node A · CNI / Proxy\nPod 网络 / Service"],
    ["pod-b", "Node B · Pod\nAPI 副本"],
    ["network-b", "Node B · CNI / Proxy\nPod 网络 / Service"],
  ])
  .row("access", "04  业务入口与持久化", 810, "amber", [
    ["ingress", "Ingress / Gateway\n集群流量入口"],
    ["service", "Service\n稳定服务地址"],
    ["volume", "PersistentVolume\n持久化卷", "database"],
    ["csi", "CSI 驱动\n存储挂载"],
  ])
  .link("scheduler", "api", "监听 / 绑定", "h")
  .link("api", "etcd", "读写", "h")
  .link("controller", "api", "调谐", "h")
  .link("kubelet-a", "api", "监听 / 上报")
  .link("kubelet-b", "api", "监听 / 上报")
  .link("kubelet-a", "runtime-a", "CRI", "h")
  .link("kubelet-b", "runtime-b", "CRI", "h")
  .link("runtime-a", "pod-a", "运行")
  .link("runtime-b", "pod-b", "运行")
  .link("pod-a", "network-a", "网络", "h")
  .link("pod-b", "network-b", "网络", "h")
  .link("ingress", "service", "路由", "h")
  .link("service", "network-a", "转发")
  .link("service", "network-b", "转发")
  .link("pod-b", "volume", "挂载")
  .link("csi", "volume", "供给", "h")
  .done();

const recovery = diagram(
  "multi-region-dr",
  "跨地域容灾 · 主备与故障切换",
  "以温备模式展示主地域、缩容备用地域、异步复制、健康探测和切换运行手册；实际 RTO/RPO 需通过演练确认。",
  ["云部署", "容灾", "跨地域", "主备", "高可用"],
  sources.recovery,
)
  .column("primary", "主地域 / 承载业务", 40, "green", [
    ["entry-a", "主站负载均衡\n正常业务流量"],
    ["app-a", "应用集群\n正常容量"],
    ["db-a", "主数据库\n业务写入", "database"],
    ["object-a", "对象存储\n原始数据", "database"],
  ])
  .column("dr", "备用地域 / 温备", 500, "amber", [
    ["entry-b", "备站负载均衡\n切换后接入"],
    ["app-b", "备用应用\n缩容运行 / 扩容"],
    ["db-b", "异步复制副本\n切换前提升主库", "database"],
    ["object-b", "跨地域副本\n对象异步复制", "database"],
  ])
  .column("control", "流量与恢复控制", 960, "blue", [
    ["dns", "DNS / 全局入口\n主备路由"],
    ["health", "健康探测\n多点监控"],
    ["runbook", "恢复运行手册\n隔离原主 / 提升 / 扩容"],
    ["drill", "演练与校验\nRTO / RPO / 回切"],
  ])
  .link("entry-a", "app-a")
  .link("app-a", "db-a")
  .link("app-a", "object-a", "文件")
  .link("entry-b", "app-b")
  .link("app-b", "db-b")
  .link("app-b", "object-b", "文件")
  .link("db-a", "db-b", "异步复制", "h")
  .link("object-a", "object-b", "异步复制", "h")
  .link("dns", "entry-b", "故障切换", "h", true)
  .link("health", "dns", "切换依据")
  .link("health", "runbook", "触发处置")
  .link("runbook", "app-b", "扩容", "h", true)
  .link("runbook", "db-b", "提升 / 防双写", "h", true)
  .link("runbook", "drill", "验证")
  .done();

const iot = diagram(
  "iot-edge-cloud",
  "IoT · 边缘设备与云平台架构",
  "展示设备接入、边缘缓存、证书认证、遥测处理、数字孪生和指令下发；区分数据上行与控制下行。",
  ["系统架构", "IoT", "物联网", "边缘计算", "MQTT"],
  sources.iot,
)
  .column("edge", "现场 / 边缘", 40, "blue", [
    ["sensor", "传感器 / 设备\n采样 / 执行"],
    ["gateway", "边缘网关\n协议转换"],
    ["buffer", "本地缓冲\n断网续传", "database"],
    ["agent", "设备管理 Agent\n配置 / 升级"],
  ])
  .column("cloud", "云接入 / 路由", 470, "green", [
    ["cert", "设备注册与证书\n唯一身份 / 吊销"],
    ["broker", "MQTT / IoT 接入\n会话 / 鉴权"],
    ["rules", "规则引擎\n过滤 / 分流"],
    ["twin", "数字孪生 / 影子\n期望与上报状态", "database"],
  ])
  .column("apps", "应用与数据", 900, "amber", [
    ["console", "设备控制台\n状态 / 运维"],
    ["stream", "实时处理\n聚合 / 告警"],
    ["timeseries", "时序存储\n遥测数据", "database"],
    ["command", "指令服务\n权限 / 超时 / 回执"],
  ])
  .link("sensor", "gateway", "采样")
  .link("gateway", "buffer", "持久缓冲")
  .link("buffer", "broker", "遥测上行", "h")
  .link("broker", "cert", "证书校验")
  .link("broker", "rules", "事件")
  .link("rules", "stream", "数据流", "h")
  .link("stream", "timeseries", "写入")
  .link("stream", "console", "实时状态")
  .link("console", "command", "操作")
  .link("command", "twin", "期望状态", "h")
  .link("twin", "agent", "配置下发", "h")
  .link("agent", "sensor", "执行 / 回执")
  .done();

const rag = diagram(
  "rag-knowledge",
  "AI 应用 · RAG 知识检索架构",
  "分开离线索引与在线问答，包含解析切片、向量化、权限过滤、混合检索、重排、引用回答和质量评估。",
  ["系统架构", "AI", "RAG", "大模型", "知识库", "向量检索"],
  sources.rag,
)
  .row("ingest", "01  知识入库 / 离线与增量处理", 30, "blue", [
    ["docs", "文档与业务资料\n权限 / 版本"],
    ["parse", "解析与清洗\nOCR / 去重"],
    ["chunk", "切片与元数据\n来源 / ACL"],
    ["embed", "Embedding\n语义向量"],
  ])
  .row("indexes", "02  检索存储 / 权限与来源可追溯", 280, "amber", [
    ["original", "原文存储\n页码 / 片段位置", "database"],
    ["catalog", "元数据目录\n访问权限 / 版本", "database"],
    ["keyword", "关键词索引\n全文 / 条件过滤", "database"],
    ["vector", "向量索引\n相似度检索", "database"],
  ])
  .row("online", "03  在线问答 / 检索后再生成", 530, "green", [
    ["question", "用户问题\n身份 / 会话"],
    ["retrieve", "混合检索\nACL 过滤 / Query 向量"],
    ["rerank", "重排与上下文\n相关性 / Token 预算"],
    ["llm", "LLM 生成\n基于证据回答"],
  ])
  .row("quality", "04  交付与质量闭环", 780, "gray", [
    ["feedback", "用户反馈\n有用 / 纠错"],
    ["eval", "离线评估集\n召回 / 忠实度"],
    ["trace", "运行观测\n延迟 / 成本 / 检索"],
    ["answer", "回答与引用\n来源链接 / 拒答"],
  ])
  .link("docs", "parse", "采集", "h")
  .link("parse", "chunk", "解析", "h")
  .link("chunk", "embed", "编码", "h")
  .link("docs", "original")
  .link("chunk", "catalog")
  .link("chunk", "keyword")
  .link("embed", "vector")
  .link("question", "retrieve", "检索请求", "h")
  .link("retrieve", "catalog", "权限约束")
  .link("retrieve", "keyword", "全文")
  .link("retrieve", "vector", "相似度")
  .link("retrieve", "rerank", "候选", "h")
  .link("rerank", "llm", "证据上下文", "h")
  .link("llm", "answer", "生成")
  .link("rerank", "trace", "追踪")
  .link("feedback", "eval", "沉淀样本", "h")
  .link("eval", "trace", "质量结果", "h")
  .link("answer", "feedback", "反馈", "h")
  .done();

const telemetry = diagram(
  "observability-platform",
  "可观测平台 · 日志指标链路架构",
  "参考 OpenTelemetry Collector 管道，展示应用埋点、Agent/Gateway 采集、处理导出和三类遥测后端。",
  ["系统架构", "可观测", "OpenTelemetry", "监控", "日志", "链路"],
  sources.telemetry,
)
  .row("signals", "01  遥测信号来源", 30, "blue", [
    ["app", "服务 SDK\nTrace / Metric / Log"],
    ["host", "主机与容器\n资源指标"],
    ["log", "应用日志\n结构化事件"],
    ["browser", "前端体验\n错误 / 请求耗时"],
  ])
  .row("collect", "02  Collector / Agent 与 Gateway", 280, "green", [
    ["receive", "Receivers\nOTLP / 采集协议"],
    ["process", "Processors\n过滤 / 批次 / 脱敏"],
    ["sample", "采样与属性\n资源标识 / 关联"],
    ["export", "Exporters\n重试 / 目标路由"],
  ])
  .row("backend", "03  遥测后端 / 示例选型", 530, "amber", [
    ["traces", "链路存储\nTempo / Jaeger", "database"],
    ["metrics", "指标存储\nPrometheus", "database"],
    ["logs", "日志存储\nLoki / Elasticsearch", "database"],
    ["archive", "低频归档\n保留策略", "database"],
  ])
  .row("use", "04  诊断与响应", 780, "gray", [
    ["trace-ui", "链路分析\n依赖 / 慢调用"],
    ["slo", "SLO 看板\n可用性 / 延迟"],
    ["search", "日志检索\nTrace ID 关联"],
    ["alert", "告警通知\n去重 / 值班"],
  ])
  .link("app", "receive")
  .link("host", "receive")
  .link("log", "receive")
  .link("browser", "receive")
  .link("receive", "process", "处理", "h")
  .link("process", "sample", "属性", "h")
  .link("sample", "export", "导出", "h")
  .link("export", "traces")
  .link("export", "metrics")
  .link("export", "logs")
  .link("export", "archive")
  .link("traces", "trace-ui")
  .link("metrics", "slo")
  .link("logs", "search")
  .link("slo", "alert", "错误预算", "h")
  .done();

const lakehouse = diagram(
  "lakehouse-medallion",
  "数据平台 · 湖仓一体分层架构",
  "以 Bronze、Silver、Gold 三层组织原始、清洗与业务数据，配套批流接入、质量检查、数据目录和分析消费。",
  ["系统架构", "数据架构", "湖仓", "Lakehouse", "大数据", "Medallion"],
  sources.lakehouse,
)
  .column("input", "数据接入", 40, "blue", [
    ["db", "业务库 CDC\n增量变更"],
    ["events", "事件与日志\n实时流"],
    ["files", "文件 / 外部 API\n批量导入"],
    ["ingest", "批流摄取\n检查点 / 幂等"],
  ])
  .column("lake", "湖仓数据层", 470, "amber", [
    ["bronze", "Bronze 原始层\n原样落地 / 可回放", "database"],
    ["silver", "Silver 清洗层\n去重 / 统一 / 校验", "database"],
    ["gold", "Gold 业务层\n指标 / 汇总 / 宽表", "database"],
    ["quality", "质量检查\n失败隔离 / 追溯"],
  ])
  .column("serve", "服务与治理", 900, "green", [
    ["catalog", "数据目录\n血缘 / 权限 / 审计"],
    ["notebook", "探索与机器学习\n特征 / 实验"],
    ["sql", "SQL / BI 服务\n报表 / 分析"],
    ["orchestrator", "任务编排\n依赖 / 监控 / 重跑"],
  ])
  .link("db", "ingest", "变更")
  .link("events", "ingest", "流")
  .link("files", "ingest", "批")
  .link("ingest", "bronze", "落地", "h")
  .link("bronze", "silver", "清洗")
  .link("silver", "gold", "业务建模")
  .link("silver", "quality", "校验失败")
  .link("bronze", "catalog", "登记血缘", "h", true)
  .link("silver", "notebook", "探索", "h")
  .link("gold", "sql", "查询", "h")
  .link("orchestrator", "quality", "调度 / 重跑", "h", true)
  .done();

const c4 = diagram(
  "c4-system-containers",
  "C4 · 系统容器与外部依赖",
  "以在线业务系统为例标注用户、应用容器、数据库和外部系统的职责与协议。这里的容器指可运行单元或数据存储。",
  ["系统架构", "C4", "容器图", "系统边界", "技术架构"],
  sources.c4,
)
  .row("actors", "用户与外部参与者", 30, "blue", [
    ["customer", "业务用户\n浏览 / 下单", "terminal"],
    ["operator", "运营人员\n管理 / 审核", "terminal"],
    ["partner", "合作伙伴系统\n开放接口调用"],
    ["identity", "外部身份系统\n统一登录"],
  ])
  .row("presentation", "业务系统边界 / 交互容器", 280, "green", [
    ["spa", "Web 应用\nTypeScript / 浏览器"],
    ["admin", "管理应用\nTypeScript / 浏览器"],
    ["api", "API 应用\n业务规则 / HTTP"],
    ["worker", "后台处理器\n异步任务 / 事件"],
  ])
  .row("stores", "业务系统边界 / 数据容器", 530, "amber", [
    ["database", "关系数据库\n交易与账户 / SQL", "database"],
    ["cache", "缓存\n热点数据 / Redis", "database"],
    ["queue", "消息队列\n任务与事件 / AMQP"],
    ["objects", "对象存储\n文件 / HTTPS", "database"],
  ])
  .row("external", "外部系统 / 独立责任边界", 780, "gray", [
    ["payment", "支付系统\n收款 / 退款"],
    ["mail", "通知系统\n邮件 / 短信"],
    ["delivery", "履约系统\n配送 / 状态回调"],
    ["audit", "审计平台\n日志 / 合规记录"],
  ])
  .link("customer", "spa", "HTTPS")
  .link("operator", "admin", "HTTPS")
  .link("partner", "api", "HTTPS / JSON")
  .link("api", "identity", "OIDC")
  .link("spa", "api", "HTTPS / JSON", "h")
  .link("admin", "api", "HTTPS / JSON", "h")
  .link("api", "database", "SQL")
  .link("api", "cache", "Redis")
  .link("api", "queue", "发布事件")
  .link("queue", "worker", "消费")
  .link("worker", "objects", "HTTPS")
  .side("spa", "payment", "支付页面跳转", "left")
  .side("worker", "audit", "遥测 / 审计", "right")
  .link("queue", "mail", "通知任务")
  .link("queue", "delivery", "履约事件")
  .done();

export const architectureTemplates: DiagramTemplate[] = [
  android,
  modular,
  offline,
  flutter,
  bff,
  hexagonal,
  governance,
  events,
  cqrs,
  saas,
  serverless,
  k8s,
  recovery,
  iot,
  rag,
  telemetry,
  lakehouse,
  c4,
];
