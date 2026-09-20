import { emptyDocument } from "../packages/document-core/index.ts";
import { startEngine } from "../apps/local-server/engine.ts";
import { Renderer } from "../packages/render-worker/index.ts";
import fs from "node:fs/promises";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const flowSets = [
  ["提交工单", "检查信息", "信息齐全？", "分派处理", "补充信息"],
  ["开始备份", "读取文件", "读取成功？", "保存快照", "记录错误"],
  ["提交订单", "校验库存", "库存足够？", "创建支付", "通知缺货"],
  ["代码提交", "运行测试", "测试通过？", "部署服务", "修复代码"],
  ["上传文档", "检查格式", "格式正确？", "进入归档", "退回修改"],
];
const archSets = [
  ["移动应用", "接入网关", "搜索服务", "索引数据库", "结果缓存"],
  ["管理后台", "鉴权网关", "用户服务", "用户数据库", "审计队列"],
  ["传感设备", "消息网关", "采集服务", "时序数据库", "告警服务"],
  ["Web 客户端", "负载均衡", "内容服务", "对象存储", "分发缓存"],
  ["任务调度", "执行网关", "计算服务", "任务数据库", "事件总线"],
];
const node = (
  id: string,
  label: string,
  x: number,
  y: number,
  style = "",
  w = 160,
  h = 64,
  parent = "1",
) =>
  `<mxCell id="${id}" value="${esc(label)}" vertex="1" parent="${parent}" style="rounded=1;whiteSpace=wrap;html=0;fontSize=18;fontFamily=Noto Sans SC;fillColor=#ffffff;strokeColor=#304b3b;strokeWidth=2;${style}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const edge = (id: string, s: string, t: string, label = "", extra = "") =>
  `<mxCell id="${id}" value="${label}" edge="1" parent="1" source="${s}" target="${t}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=0;strokeWidth=2;endArrow=block;endFill=1;fontSize=16;fontFamily=Noto Sans SC;${extra}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
await fs.mkdir("fixtures/benchmark/ground-truth", { recursive: true });
await fs.mkdir("fixtures/benchmark/images", { recursive: true });
const engine = await startEngine(),
  render = new Renderer(engine.origin);
try {
  for (let i = 0; i < 10; i++) {
    const flow = i < 5,
      labels = flow ? flowSets[i] : archSets[i - 5];
    let cells = flow
      ? node("n1", labels[0], 140, 30, "ellipse;") +
        node("n2", labels[1], 140, 170) +
        node(
          "n3",
          labels[2],
          135,
          310,
          "rhombus;fillColor=#fff2ce;",
          170,
          110,
        ) +
        node("n4", labels[3], 140, 490, "ellipse;fillColor=#e6f2e9;") +
        node("n5", labels[4], 440, 332) +
        edge("e1", "n1", "n2") +
        edge("e2", "n2", "n3") +
        edge("e3", "n3", "n4", "是", "exitX=0.5;exitY=1;entryX=0.5;entryY=0;") +
        edge("e4", "n3", "n5", "否", "exitX=1;exitY=0.5;entryX=0;entryY=0.5;") +
        edge("e5", "n5", "n2", "重试", "exitX=0.5;exitY=0;entryX=1;entryY=0.5;")
      : node("n1", labels[0], 40, 160) +
        node("n2", labels[1], 285, 160, "fillColor=#e6f2e9;") +
        node("n3", labels[2], 530, 160) +
        node(
          "n4",
          labels[3],
          430,
          350,
          "shape=cylinder;rounded=0;fillColor=#e5eff9;",
          165,
          92,
        ) +
        node("n5", labels[4], 695, 350, "fillColor=#fff2ce;") +
        edge("e1", "n1", "n2", "请求") +
        edge("e2", "n2", "n3", "转发") +
        edge("e3", "n3", "n4", "读写") +
        edge("e4", "n3", "n5", "事件");
    const name = `${String(i + 1).padStart(2, "0")}-${flow ? "flow" : "architecture"}`;
    const xml = emptyDocument(name, "faithful").replace(
      "</root>",
      cells + "</root>",
    );
    await fs.writeFile(`fixtures/benchmark/ground-truth/${name}.drawio`, xml);
    const r = await render.render(xml, { format: "png", scale: 2, margin: 30 });
    await fs.writeFile(`fixtures/benchmark/images/${name}.png`, r.data);
    console.log("fixture", name);
  }
} finally {
  await render.close();
  engine.server.close();
}
