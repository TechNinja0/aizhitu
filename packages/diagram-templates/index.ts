// Original, editable diagrams informed by the linked public references.
// XML and SVG previews share geometry, labels and colors; no remote assets are needed.
export const categories = [
  { id: "architecture", name: "系统架构", symbol: "▤" },
  { id: "flow", name: "业务流程", symbol: "⑂" },
  { id: "data", name: "数据设计", symbol: "▥" },
  { id: "planning", name: "组织与规划", symbol: "✳" },
] as const;
type Category = (typeof categories)[number]["id"];
type Tone = "green" | "blue" | "amber" | "rose" | "gray";
type Shape = "box" | "decision" | "terminal" | "database" | "lane";
export type TemplateNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tone: Tone;
  shape: Shape;
  parent?: string;
};
type Point = { x: number; y: number };
type Side = "top" | "right" | "bottom" | "left";
export type TemplateEdge = {
  source: string;
  target: string;
  label?: string;
  from?: Side;
  to?: Side;
  via?: Point[];
  dashed?: boolean;
};
export type DiagramTemplate = {
  id: string;
  name: string;
  category: Category;
  description: string;
  tags: string[];
  source: { name: string; url: string };
  nodes: TemplateNode[];
  edges: TemplateEdge[];
};
const palette: Record<Tone, [string, string]> = {
  green: ["#e6f1e9", "#6c9479"],
  blue: ["#e9f0fa", "#7c9fc6"],
  amber: ["#fff3db", "#c4a263"],
  rose: ["#faeae6", "#c38d81"],
  gray: ["#f1f3f5", "#97a3ac"],
};
const n = (
  id: string,
  label: string,
  x: number,
  y: number,
  tone: Tone = "green",
  shape: Shape = "box",
  w = 160,
  h = 64,
  parent?: string,
): TemplateNode => ({ id, label, x, y, w, h, tone, shape, parent });
const e = (
  source: string,
  target: string,
  label?: string,
  from?: Side,
  to?: Side,
  via?: Point[],
): TemplateEdge => ({ source, target, label, from, to, via });
const gallery = {
  name: "draw.io · 官方图例",
  url: "https://www.drawio.com/docs/diagram-types/",
};
const azure = {
  name: "Azure · 架构风格指南",
  url: "https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/",
};
export const templates: DiagramTemplate[] = [
  {
    id: "layered",
    name: "经典分层架构",
    category: "architecture",
    description: "从客户端到数据层，清晰表达系统职责与调用关系。",
    tags: ["Web", "三层架构", "后端"],
    source: azure,
    nodes: [
      n("web", "Web 客户端", 40, 30, "blue"),
      n("mobile", "移动端", 280, 30, "blue"),
      n("gateway", "API 网关 / 接入层", 160, 160, "green", "box", 160),
      n("business", "业务服务层", 160, 290),
      n("db", "业务数据库", 40, 420, "amber", "database"),
      n("cache", "缓存服务", 280, 420, "amber", "database"),
    ],
    edges: [
      e("web", "gateway", undefined, "bottom", "left"),
      e("mobile", "gateway", undefined, "bottom", "right"),
      e("gateway", "business"),
      e("business", "db", undefined, "bottom", "top"),
      e("business", "cache", undefined, "right", "top"),
    ],
  },
  {
    id: "microservices",
    name: "微服务架构",
    category: "architecture",
    description: "通过网关拆分用户、订单和库存服务，展示独立数据存储。",
    tags: ["API", "服务拆分", "微服务"],
    source: azure,
    nodes: [
      n("client", "客户端", 250, 20, "blue"),
      n("gateway", "API 网关", 250, 145),
      n("users", "用户服务", 30, 290),
      n("orders", "订单服务", 250, 290),
      n("stock", "库存服务", 470, 290),
      n("userdb", "用户库", 30, 425, "amber", "database"),
      n("orderdb", "订单库", 250, 425, "amber", "database"),
      n("stockdb", "库存库", 470, 425, "amber", "database"),
    ],
    edges: [
      e("client", "gateway"),
      e("gateway", "users", undefined, "left", "top"),
      e("gateway", "orders"),
      e("gateway", "stock", undefined, "right", "top"),
      e("users", "userdb"),
      e("orders", "orderdb"),
      e("stock", "stockdb"),
    ],
  },
  {
    id: "async-worker",
    name: "异步任务架构",
    category: "architecture",
    description: "以消息队列连接 Web 服务和后台任务，适合耗时处理场景。",
    tags: ["消息队列", "Worker", "异步"],
    source: {
      name: "Azure · Web-Queue-Worker",
      url: "https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/web-queue-worker",
    },
    nodes: [
      n("client", "客户端", 30, 60, "blue"),
      n("web", "Web / API 服务", 270, 60),
      n("queue", "任务消息队列", 510, 60, "amber"),
      n("worker", "后台 Worker", 510, 270),
      n("db", "任务 / 业务数据库", 270, 270, "blue", "database"),
      n("notify", "通知服务", 750, 270, "rose"),
    ],
    edges: [
      e("client", "web", "请求"),
      e("web", "queue", "入队"),
      e("queue", "worker", "消费"),
      e("web", "db", "读写"),
      e("worker", "db", "更新"),
      e("worker", "notify", "完成通知"),
    ],
  },
  {
    id: "high-availability",
    name: "高可用部署架构",
    category: "architecture",
    description: "负载均衡、多实例服务与主从数据库的基础部署拓扑。",
    tags: ["部署", "负载均衡", "主从"],
    source: gallery,
    nodes: [
      n("client", "用户请求", 250, 20, "blue"),
      n("lb", "负载均衡", 250, 145),
      n("app1", "应用实例 A", 90, 280),
      n("app2", "应用实例 B", 410, 280),
      n("db", "主数据库", 250, 425, "amber", "database"),
      n("replica", "只读副本", 510, 425, "blue", "database"),
    ],
    edges: [
      e("client", "lb"),
      e("lb", "app1", undefined, "left", "top"),
      e("lb", "app2", undefined, "right", "top"),
      e("app1", "db", undefined, "bottom", "left"),
      e("app2", "db", undefined, "bottom", "top"),
      e("db", "replica", "复制"),
    ],
  },
  {
    id: "basic-flow",
    name: "基础判断流程",
    category: "flow",
    description: "开始、处理、条件分支和结束，快速搭建通用业务流程。",
    tags: ["流程图", "条件", "入门"],
    source: gallery,
    nodes: [
      n("start", "开始", 40, 180, "gray", "terminal", 110, 54),
      n("input", "提交信息", 215, 175),
      n("check", "条件满足？", 440, 150, "amber", "decision", 160, 114),
      n("success", "执行处理", 670, 70),
      n("retry", "补充信息", 670, 290, "rose"),
      n("end", "结束", 905, 75, "gray", "terminal", 110, 54),
    ],
    edges: [
      e("start", "input"),
      e("input", "check"),
      e("check", "success", "是", "top", "left"),
      e("check", "retry", "否", "bottom", "left"),
      e("success", "end"),
      e("retry", "input", "重新提交", "bottom", "bottom", [
        { x: 750, y: 410 },
        { x: 295, y: 410 },
      ]),
    ],
  },
  {
    id: "approval",
    name: "申请审批流程",
    category: "flow",
    description: "申请、审核、通过与驳回闭环，适合请假、报销和权限申请。",
    tags: ["审批", "报销", "工作流"],
    source: gallery,
    nodes: [
      n("start", "提交申请", 40, 165, "blue"),
      n("review", "负责人审核", 280, 165),
      n("decision", "审核通过？", 520, 140, "amber", "decision", 160, 114),
      n("approved", "执行 / 归档", 770, 55),
      n("rejected", "退回修改", 770, 295, "rose"),
    ],
    edges: [
      e("start", "review"),
      e("review", "decision"),
      e("decision", "approved", "通过", "top", "left"),
      e("decision", "rejected", "驳回", "bottom", "left"),
      e("rejected", "start", "重新申请", "bottom", "bottom", [
        { x: 850, y: 415 },
        { x: 120, y: 415 },
      ]),
    ],
  },
  {
    id: "swimlane",
    name: "跨部门泳道流程",
    category: "flow",
    description: "按申请人、审批人和财务划分职责，展示报销的跨部门交接。",
    tags: ["泳道图", "协作", "报销"],
    source: {
      name: "draw.io · 泳道图指南",
      url: "https://www.drawio.com/docs/diagram-types/swimlane-diagrams/",
    },
    nodes: [
      n("applicant", "申请人", 20, 20, "blue", "lane", 960, 155),
      n("approver", "审批人", 20, 175, "green", "lane", 960, 155),
      n("finance", "财务", 20, 330, "amber", "lane", 960, 155),
      n("submit", "提交报销单", 70, 83, "blue", "box", 160, 60, "applicant"),
      n("review", "审核凭证", 310, 240, "green", "box", 160, 60, "approver"),
      n("approve", "确认审批", 550, 240, "green", "box", 160, 60, "approver"),
      n("pay", "核算并付款", 550, 395, "amber", "box", 160, 60, "finance"),
      n("receive", "收到款项", 780, 83, "blue", "box", 160, 60, "applicant"),
    ],
    edges: [
      e("submit", "review", undefined, "bottom", "left"),
      e("review", "approve"),
      e("approve", "pay"),
      e("pay", "receive", undefined, "right", "bottom"),
    ],
  },
  {
    id: "cicd",
    name: "CI/CD 发布流程",
    category: "flow",
    description: "从代码提交到自动化测试、人工审批和发布后的监控回滚。",
    tags: ["DevOps", "持续集成", "发布"],
    source: gallery,
    nodes: [
      n("commit", "提交代码", 30, 70, "blue"),
      n("build", "构建 / 单元测试", 270, 70),
      n("test", "集成测试", 510, 70),
      n("approve", "审批发布", 750, 70, "amber"),
      n("deploy", "部署生产", 750, 270),
      n("monitor", "监控正常？", 500, 245, "amber", "decision", 180, 114),
      n("done", "发布完成", 260, 275, "green", "terminal"),
      n("rollback", "回滚版本", 510, 440, "rose"),
    ],
    edges: [
      e("commit", "build"),
      e("build", "test"),
      e("test", "approve"),
      e("approve", "deploy"),
      e("deploy", "monitor"),
      e("monitor", "done", "是"),
      e("monitor", "rollback", "否", "bottom", "top"),
    ],
  },
  {
    id: "data-pipeline",
    name: "数据处理管道",
    category: "data",
    description: "串联数据采集、清洗、仓储和分析，梳理 ETL 数据流转。",
    tags: ["ETL", "数据仓库", "分析"],
    source: azure,
    nodes: [
      n("db", "业务数据库", 30, 30, "blue", "database"),
      n("logs", "事件 / 日志", 30, 240, "blue"),
      n("ingest", "数据采集", 280, 135),
      n("clean", "清洗与转换", 530, 135),
      n("warehouse", "数据仓库", 780, 135, "amber", "database"),
      n("report", "报表 / 分析", 1030, 135),
    ],
    edges: [
      e("db", "ingest", undefined, "right", "top"),
      e("logs", "ingest", undefined, "right", "bottom"),
      e("ingest", "clean"),
      e("clean", "warehouse"),
      e("warehouse", "report"),
    ],
  },
  {
    id: "entity-relationship",
    name: "订单实体关系",
    category: "data",
    description: "用户、订单、订单项与商品的基础 ER 图，标注主键与关系。",
    tags: ["ER", "数据库", "订单"],
    source: gallery,
    nodes: [
      n(
        "user",
        "用户 User\nPK user_id\nname · email",
        30,
        40,
        "blue",
        "box",
        195,
        120,
      ),
      n(
        "order",
        "订单 Order\nPK order_id\nFK user_id · status",
        365,
        40,
        "green",
        "box",
        195,
        120,
      ),
      n(
        "item",
        "订单项 OrderItem\nPK item_id\nFK order_id · product_id",
        365,
        290,
        "amber",
        "box",
        220,
        120,
      ),
      n(
        "product",
        "商品 Product\nPK product_id\nname · price",
        740,
        290,
        "blue",
        "box",
        195,
        120,
      ),
    ],
    edges: [
      e("user", "order", "1 : N"),
      e("order", "item", "1 : N"),
      e("product", "item", "1 : N"),
    ],
  },
  {
    id: "org-chart",
    name: "团队组织架构",
    category: "planning",
    description: "展示负责人与产品、研发、设计团队的汇报层级和分工。",
    tags: ["组织架构", "团队", "层级"],
    source: gallery,
    nodes: [
      n("lead", "团队负责人", 345, 20, "green"),
      n("product", "产品团队", 65, 170, "blue"),
      n("engineering", "研发团队", 345, 170),
      n("design", "设计团队", 625, 170, "amber"),
      n("pm", "产品经理", 65, 325, "blue"),
      n("front", "前端工程师", 255, 325),
      n("back", "后端工程师", 435, 325),
      n("designer", "体验设计师", 625, 325, "amber"),
    ],
    edges: [
      e("lead", "product", undefined, "left", "top"),
      e("lead", "engineering"),
      e("lead", "design", undefined, "right", "top"),
      e("product", "pm"),
      e("engineering", "front", undefined, "bottom", "top"),
      e("engineering", "back", undefined, "right", "top"),
      e("design", "designer"),
    ],
  },
  {
    id: "mind-map",
    name: "项目规划导图",
    category: "planning",
    description: "围绕目标、需求、交付与风险展开，快速整理项目思路。",
    tags: ["思维导图", "项目", "规划"],
    source: gallery,
    nodes: [
      n("project", "项目规划", 410, 210, "green", "box", 180, 80),
      n("goal", "目标与范围", 140, 90, "blue"),
      n("needs", "用户与需求", 140, 355, "blue"),
      n("delivery", "里程碑与交付", 700, 90, "amber"),
      n("risk", "资源与风险", 700, 355, "rose"),
      n("metric", "成功指标", 140, 0, "blue", "box", 160, 50),
      n("priority", "需求优先级", 140, 465, "blue", "box", 160, 50),
      n("schedule", "上线计划", 700, 0, "amber", "box", 160, 50),
      n("plan", "应对方案", 700, 465, "rose", "box", 160, 50),
    ],
    edges: [
      e("project", "goal", undefined, "left", "right"),
      e("project", "needs", undefined, "left", "right"),
      e("project", "delivery", undefined, "right", "left"),
      e("project", "risk", undefined, "right", "left"),
      e("goal", "metric"),
      e("needs", "priority"),
      e("delivery", "schedule"),
      e("risk", "plan"),
    ],
  },
];

const escape = (value: string) =>
  value.replace(
    /[&<>"'\n\r]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
        "\n": "&#10;",
        "\r": "&#13;",
      })[c]!,
  );
const anchors: Record<Side, [number, number]> = {
  top: [0.5, 0],
  right: [1, 0.5],
  bottom: [0.5, 1],
  left: [0, 0.5],
};
function route(t: DiagramTemplate, edge: TemplateEdge) {
  const source = t.nodes.find((n) => n.id === edge.source)!;
  const target = t.nodes.find((n) => n.id === edge.target)!;
  const dx = target.x + target.w / 2 - source.x - source.w / 2;
  const dy = target.y + target.h / 2 - source.y - source.h / 2;
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const from =
    edge.from ||
    (horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top");
  const to =
    edge.to ||
    (horizontal ? (dx > 0 ? "left" : "right") : dy > 0 ? "top" : "bottom");
  const start = {
    x: source.x + source.w * anchors[from][0],
    y: source.y + source.h * anchors[from][1],
  };
  const end = {
    x: target.x + target.w * anchors[to][0],
    y: target.y + target.h * anchors[to][1],
  };
  const h1 = from === "left" || from === "right",
    h2 = to === "left" || to === "right";
  const via =
    edge.via ||
    (h1 !== h2
      ? [h1 ? { x: end.x, y: start.y } : { x: start.x, y: end.y }]
      : h1
        ? [
            { x: (start.x + end.x) / 2, y: start.y },
            { x: (start.x + end.x) / 2, y: end.y },
          ]
        : [
            { x: start.x, y: (start.y + end.y) / 2 },
            { x: end.x, y: (start.y + end.y) / 2 },
          ]);
  return {
    from,
    to,
    via,
    points: [start, ...via, end].filter(
      (p, i, a) => !i || p.x !== a[i - 1].x || p.y !== a[i - 1].y,
    ),
  };
}
export function templateXml(
  template: DiagramTemplate | null,
  title: string,
): string {
  const nodes =
    template?.nodes
      .map((node) => {
        const parent = template.nodes.find((n) => n.id === node.parent);
        const [fill, stroke] = palette[node.tone];
        const shape = {
          box: "rounded=1;arcSize=12;",
          decision: "rhombus;",
          terminal: "rounded=1;arcSize=50;",
          database: "shape=cylinder;size=12;",
          lane: "swimlane;horizontal=1;startSize=38;container=1;collapsible=0;swimlaneFillColor=#ffffff;",
        }[node.shape];
        const style = `${shape}whiteSpace=wrap;html=0;fillColor=${fill};strokeColor=${stroke};fontColor=#263e33;fontSize=15;fontFamily=Noto Sans SC;strokeWidth=1.5;`;
        return `<mxCell id="${node.id}" value="${escape(node.label)}" style="${style}" vertex="1" parent="${node.parent || "1"}"><mxGeometry x="${node.x - (parent?.x || 0)}" y="${node.y - (parent?.y || 0)}" width="${node.w}" height="${node.h}" as="geometry"/></mxCell>`;
      })
      .join("") || "";
  const edges =
    template?.edges
      .map((edge, i) => {
        const r = route(template, edge);
        const [exitX, exitY] = anchors[r.from],
          [entryX, entryY] = anchors[r.to];
        return `<mxCell id="edge-${i}" value="${escape(edge.label || "")}" edge="1" parent="1" source="${edge.source}" target="${edge.target}" style="edgeStyle=none;noEdgeStyle=1;rounded=0;html=0;endArrow=block;endFill=1;endSize=7;strokeColor=#83948a;strokeWidth=1.5;fontColor=#526157;fontFamily=Noto Sans SC;fontSize=13;labelBackgroundColor=#ffffff;exitX=${exitX};exitY=${exitY};entryX=${entryX};entryY=${entryY};${edge.dashed ? "dashed=1;" : ""}"><mxGeometry relative="1" as="geometry"><Array as="points">${r.via.map((p) => `<mxPoint x="${p.x}" y="${p.y}"/>`).join("")}</Array></mxGeometry></mxCell>`;
      })
      .join("") || "";
  // Validation assigns a new document identity on every creation.
  return `<mxfile compressed="false"><diagram id="page-1" name="${escape(title)}"><mxGraphModel grid="1" gridSize="10" page="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${nodes}${edges}</root></mxGraphModel></diagram></mxfile>`;
}
export function templateSvg(template: DiagramTemplate): string {
  const routes = template.edges.map((edge) => route(template, edge));
  const width =
    Math.max(
      ...template.nodes.map((n) => n.x + n.w),
      ...routes.flatMap((r) => r.points.map((p) => p.x)),
    ) + 30;
  const height =
    Math.max(
      ...template.nodes.map((n) => n.y + n.h),
      ...routes.flatMap((r) => r.points.map((p) => p.y)),
    ) + 30;
  const nodeSvg = (n: TemplateNode) => {
    const [fill, stroke] = palette[n.tone];
    const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="1.5"`;
    let shape = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.shape === "terminal" ? 22 : 7}" ${attrs}/>`;
    if (n.shape === "decision")
      shape = `<polygon points="${n.x + n.w / 2},${n.y} ${n.x + n.w},${n.y + n.h / 2} ${n.x + n.w / 2},${n.y + n.h} ${n.x},${n.y + n.h / 2}" ${attrs}/>`;
    if (n.shape === "database")
      shape = `<path d="M${n.x},${n.y + 12} a${n.w / 2},12 0 0 1 ${n.w},0 v${n.h - 24} a${n.w / 2},12 0 0 1 -${n.w},0 Z" ${attrs}/><ellipse cx="${n.x + n.w / 2}" cy="${n.y + 12}" rx="${n.w / 2}" ry="12" ${attrs}/>`;
    if (n.shape === "lane")
      shape = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="#fff" stroke="${stroke}"/><path d="M${n.x},${n.y} h${n.w} v38 h-${n.w} Z" ${attrs}/>`;
    const lines = n.label.split("\n");
    return `${shape}<text x="${n.x + n.w / 2}" y="${n.shape === "lane" ? n.y + 24 : n.y + n.h / 2 - (lines.length - 1) * 11 + 5}" fill="#263e33" text-anchor="middle" font-size="15" font-family="Noto Sans SC, sans-serif">${lines.map((line, i) => `<tspan x="${n.x + n.w / 2}" dy="${i ? 22 : 0}">${escape(line)}</tspan>`).join("")}</text>`;
  };
  const edges = template.edges
    .map((edge, i) => {
      const points = routes[i].points;
      // Put labels on the longest segment, away from node boundaries.
      let longest = 0,
        labelAt = points[0];
      for (let j = 1; j < points.length; j++) {
        const a = points[j - 1],
          b = points[j],
          length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length > longest) {
          longest = length;
          labelAt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }
      }
      return `<path d="${points.map((p, j) => `${j ? "L" : "M"}${p.x},${p.y}`).join(" ")}" fill="none" stroke="#83948a" stroke-width="1.5" marker-end="url(#arrow)"${edge.dashed ? ' stroke-dasharray="5 4"' : ""}/>${edge.label ? `<text x="${labelAt.x}" y="${labelAt.y - 7}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="13" fill="#526157" stroke="#fff" stroke-width="5" paint-order="stroke">${escape(edge.label)}</text>` : ""}`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -15 ${width + 15} ${height + 15}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#83948a"/></marker></defs>${template.nodes
    .filter((n) => n.shape === "lane")
    .map(nodeSvg)
    .join("")}${edges}${template.nodes
    .filter((n) => n.shape !== "lane")
    .map(nodeSvg)
    .join("")}</svg>`;
}
