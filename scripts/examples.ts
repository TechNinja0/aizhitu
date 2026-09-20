import { emptyDocument } from "../packages/document-core/index.ts";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { writeFile, mkdir } from "node:fs/promises";
const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const node = (
  id: string,
  label: string,
  x: number,
  y: number,
  w = 150,
  h = 60,
  style = "",
  parent = "1",
) =>
  `<mxCell id="${id}" value="${escape(label)}" vertex="1" parent="${parent}" style="rounded=1;whiteSpace=wrap;html=0;fontFamily=Noto Sans SC;fontSize=14;fillColor=#ffffff;strokeColor=#648373;fontColor=#243e32;${style}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const edge = (id: string, source: string, target: string, label = "") =>
  `<mxCell id="${id}" value="${label}" edge="1" parent="1" source="${source}" target="${target}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=0;endArrow=block;endFill=1;fontFamily=Noto Sans SC;fontSize=12;strokeColor=#729184;fontColor=#456653;"><mxGeometry relative="1" as="geometry"/></mxCell>`;
function make(title: string, cells: string, review = false) {
  const xml = emptyDocument(title, "faithful").replace(
    "</root>",
    cells + "</root>",
  );
  if (!review) return xml;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const o = doc.getElementsByTagName("object")[0];
  const m = JSON.parse(o.getAttribute("dw_meta")!);
  m.reviewItems = [
    {
      id: "review-1",
      objectId: "service",
      kind: "text",
      message: "原图中的服务名称需要人工确认。",
      status: "needsReview",
      sourceRect: { x: 280, y: 170, width: 150, height: 60 },
    },
    {
      id: "review-2",
      objectId: "e3",
      kind: "relationship",
      message: "请核对服务到数据库的连接方向。",
      status: "needsReview",
    },
  ];
  o.setAttribute("dw_meta", JSON.stringify(m));
  return new XMLSerializer().serializeToString(doc);
}
await mkdir("fixtures/examples", { recursive: true });
const arch =
  node(
    "title",
    "订单服务 · 系统架构",
    60,
    40,
    600,
    45,
    "text;fillColor=none;strokeColor=none;fontSize=24;fontStyle=1;align=left;",
  ) +
  node("client", "客户端", 70, 170) +
  node("gateway", "API 网关", 280, 170, 150, 60, "fillColor=#e3f0e9;") +
  node(
    "group",
    "服务集群",
    490,
    100,
    430,
    260,
    "swimlane;horizontal=1;startSize=36;container=1;collapsible=0;fillColor=#f1f6f2;",
  ) +
  node("service", "订单服务", 30, 65, 150, 60, "", "group") +
  node("inventory", "库存服务", 235, 65, 150, 60, "", "group") +
  node(
    "queue",
    "消息队列",
    130,
    170,
    150,
    55,
    "fillColor=#fff4da;strokeColor=#b89b54;",
    "group",
  ) +
  node(
    "db",
    "订单数据库",
    545,
    440,
    130,
    85,
    "shape=cylinder;rounded=0;fillColor=#eaf1f7;strokeColor=#7196b0;",
  ) +
  node(
    "cache",
    "缓存",
    755,
    450,
    130,
    60,
    "fillColor=#fff4da;strokeColor=#b89b54;",
  ) +
  edge("e1", "client", "gateway", "HTTPS") +
  edge("e2", "gateway", "service") +
  edge("e3", "service", "db", "读写") +
  edge("e4", "service", "inventory", "校验库存") +
  edge("e5", "inventory", "cache") +
  edge("e6", "service", "queue", "发布事件");
const flow =
  node("start", "提交申请", 200, 50, 150, 55, "ellipse;") +
  node("check", "资料校验", 200, 165) +
  node(
    "decision",
    "是否通过？",
    215,
    275,
    120,
    90,
    "rhombus;fillColor=#fff4da;strokeColor=#b89b54;",
  ) +
  node(
    "approved",
    "审批完成",
    200,
    445,
    150,
    55,
    "ellipse;fillColor=#e3f0e9;",
  ) +
  node("fix", "补充资料", 450, 290) +
  edge("f1", "start", "check") +
  edge("f2", "check", "decision") +
  edge("f3", "decision", "approved", "是") +
  edge("f4", "decision", "fix", "否") +
  edge("f5", "fix", "check", "重新提交");
await writeFile(
  "fixtures/examples/architecture.drawio",
  make("订单服务架构", arch),
);
await writeFile(
  "fixtures/examples/review.drawio",
  make("待核对的架构图", arch, true),
);
await writeFile("fixtures/examples/flow.drawio", make("申请审批流程", flow));
