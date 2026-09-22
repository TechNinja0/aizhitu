import { documentModel, styleMap, setStyle } from "./model.ts";
import { compareDocuments } from "./diff.ts";
type Box = {
  id: string;
  parent: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked: boolean;
  label: string;
  style: Record<string, string>;
  relative: boolean;
  decoration: boolean;
  container: boolean;
};
export type QualityOptions = {
  mode: "appearance" | "vertical" | "horizontal" | "architecture";
  selection?: string[];
  gap?: number;
  layerGap?: number;
  fontSize?: number;
  uniform?: boolean;
};
export type QualityIssue = { kind: string; ids: string[]; message: string };
const intersects = (a: Box, b: Box, p = 0) =>
  a.x < b.x + b.width + p &&
  a.x + a.width + p > b.x &&
  a.y < b.y + b.height + p &&
  a.y + a.height + p > b.y;
function context(xml: string) {
  const m = documentModel(xml),
    nodes = new Map<string, Box>();
  const locked = (id: string): boolean => {
    for (let c = m.cells.get(id); c; c = m.cells.get(c.getAttribute("parent")))
      if (styleMap(c.getAttribute("style") || "").locked === "1") return true;
    return false;
  };
  for (const c of m.checked.cells!.filter((c) => c.kind === "node")) {
    const s = styleMap(c.style),
      g = c.geometry;
    nodes.set(c.id, {
      id: c.id,
      parent: c.parent,
      x: Number(g.x || 0),
      y: Number(g.y || 0),
      width: Number(g.width),
      height: Number(g.height),
      label: c.label,
      style: s,
      locked: locked(c.id),
      decoration: s.shape === "text" || c.style.split(";").includes("text"),
      relative: g.relative === "1" || Number(s.rotation || 0) !== 0,
      container:
        s.container === "1" ||
        c.style.includes("swimlane") ||
        s.shape === "swimlane",
    });
  }
  const absolute = (n: Box): Box => {
    let x = n.x,
      y = n.y;
    for (let p = nodes.get(n.parent); p; p = nodes.get(p.parent)) {
      x += p.x;
      y += p.y;
    }
    return { ...n, x, y };
  };
  const ancestor = (a: string, b: string) => {
    for (let p = nodes.get(b); p; p = nodes.get(p.parent))
      if (p.parent === a) return true;
    return false;
  };
  return { ...m, nodes, absolute, ancestor, locked };
}
function textSize(n: Box, font = Number(n.style.fontSize || 14)) {
  const text = n.label.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, "");
  const widths = text
    .split("\n")
    .map((s) =>
      Array.from(s).reduce(
        (a, c) => a + (c.charCodeAt(0) > 255 ? font : font * 0.6),
        0,
      ),
    );
  const lines = widths.reduce(
    (a, w) => a + Math.max(1, Math.ceil(w / Math.max(10, n.width - 20))),
    0,
  );
  return {
    width: Math.max(60, Math.min(360, Math.max(0, ...widths) + 24)),
    height: Math.max(40, lines * font * 1.4 + 16),
  };
}
const segmentHits = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  n: Box,
) => {
  // Liang–Barsky clipping, excluding mere contact with the border.
  const x = n.x + 2,
    y = n.y + 2,
    w = n.width - 4,
    h = n.height - 4;
  let lo = 0,
    hi = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - x],
    [dx, x + w - a.x],
    [-dy, a.y - y],
    [dy, y + h - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
      if (lo > hi) return false;
    }
  }
  return lo <= hi;
};
export function inspectQuality(xml: string) {
  const c = context(xml),
    nodes = [...c.nodes.values()].map(c.absolute),
    issues: QualityIssue[] = [];
  let total = 0;
  const add = (i: QualityIssue) => {
    total++;
    if (issues.length < 200) issues.push(i);
  };
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.relative) continue;
    if (n.label && Number(n.style.fontSize || 14) < 12)
      add({
        kind: "小字号",
        ids: [n.id],
        message: "字号小于 12，导出后可能难以阅读",
      });
    if (n.label && !n.container && textSize(n).height > n.height + 2)
      add({
        kind: "可能溢出",
        ids: [n.id],
        message: "按字符宽度估计，文字可能超出节点；请结合实际预览核对",
      });
    for (let j = i + 1; j < nodes.length; j++)
      if (
        !nodes[j].relative &&
        !c.ancestor(n.id, nodes[j].id) &&
        !c.ancestor(nodes[j].id, n.id) &&
        intersects(n, nodes[j])
      )
        add({
          kind: "节点重叠",
          ids: [n.id, nodes[j].id],
          message: `${n.label || n.id} 与 ${nodes[j].label || nodes[j].id} 重叠`,
        });
  }
  for (const e of c.checked.cells!.filter((e) => e.kind === "edge")) {
    const a = c.nodes.get(e.source!),
      b = c.nodes.get(e.target!);
    if (!a || !b || a.relative || b.relative) continue;
    const aa = c.absolute(a),
      bb = c.absolute(b),
      g = c.cells.get(e.id).getElementsByTagName("mxGeometry")[0];
    const parent = c.nodes.get(e.parent),
      origin = parent ? c.absolute(parent) : { x: 0, y: 0 };
    const bends = Array.from(g?.getElementsByTagName("mxPoint") || [])
      .filter((p: any) => p.parentNode?.getAttribute("as") === "points")
      .map((p: any) => ({
        x: Number(p.getAttribute("x")) + origin.x,
        y: Number(p.getAttribute("y")) + origin.y,
      }));
    const pts = [
      { x: aa.x + aa.width / 2, y: aa.y + aa.height / 2 },
      ...bends,
      { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 },
    ];
    for (const n of nodes) {
      if (
        n.relative ||
        n.id === a.id ||
        n.id === b.id ||
        c.ancestor(n.id, a.id) ||
        c.ancestor(n.id, b.id)
      )
        continue;
      if (pts.some((p, i) => i > 0 && segmentHits(pts[i - 1], p, n)))
        add({
          kind: "可能穿线",
          ids: [e.id, n.id],
          message: `连线可能穿过 ${n.label || n.id}，请核对实际路由`,
        });
    }
  }
  return { issues, total, truncated: total > issues.length };
}
export function planQuality(xml: string, o: QualityOptions) {
  if (
    !o ||
    !["appearance", "vertical", "horizontal", "architecture"].includes(o.mode)
  )
    throw Error("请选择有效排版方式");
  const gap = o.gap ?? 40,
    layerGap = o.layerGap ?? 80,
    font = o.fontSize ?? 14;
  if (
    ![gap, layerGap, font].every(Number.isFinite) ||
    gap < 16 ||
    gap > 200 ||
    layerGap < 32 ||
    layerGap > 300 ||
    font < 12 ||
    font > 32
  )
    throw Error("排版参数超出范围");
  const c = context(xml),
    selected = new Set(o.selection || []),
    warnings: string[] = [];
  if (
    !Array.isArray(o.selection ?? []) ||
    (o.selection ?? []).some((id) => !c.cells.has(id))
  )
    throw Error("选区无效");
  const includes = (n: Box | undefined): boolean =>
    !!n &&
    (!selected.size ||
      selected.has(n.id) ||
      [...selected].some((id) => c.ancestor(id, n.id)));
  // A container containing a fixed/unselected descendant cannot move as a whole.
  const movable = (n: Box) =>
    includes(n) &&
    !n.locked &&
    !n.relative &&
    !n.decoration &&
    ![...c.nodes.values()].some(
      (child) =>
        c.ancestor(n.id, child.id) &&
        (!includes(child) || child.locked || child.relative),
    );
  const moved = new Set<string>();
  for (const n of c.nodes.values())
    if (includes(n) && !n.locked && !n.decoration) {
      if (n.relative) {
        warnings.push(`跳过相对坐标或旋转对象：${n.label || n.id}`);
        continue;
      }
      setStyle(c.cells.get(n.id), { fontSize: String(font) });
      if (o.mode === "appearance" && !n.container) {
        const size = textSize(n, font);
        n.height = Math.max(n.height, size.height);
        n.width = Math.max(n.width, size.width);
        moved.add(n.id);
      }
    }
  const parents = [...new Set([...c.nodes.values()].map((n) => n.parent))];
  const depth = (id: string) => {
    let d = 0;
    for (let p = c.nodes.get(id); p; p = c.nodes.get(p.parent)) d++;
    return d;
  };
  parents.sort((a, b) => depth(b) - depth(a));
  for (const parent of parents) {
    const siblings = [...c.nodes.values()].filter((n) => n.parent === parent),
      items = siblings.filter(movable),
      fixed = siblings.filter((n) => !movable(n));
    if (!items.length) continue;
    if (o.uniform) {
      const ordinary = items.filter((n) => !n.container);
      const w = Math.max(0, ...ordinary.map((n) => n.width)),
        h = Math.max(0, ...ordinary.map((n) => n.height));
      for (const n of ordinary) {
        n.width = w;
        n.height = h;
        moved.add(n.id);
      }
    }
    if (o.mode !== "appearance") {
      const ids = new Set(items.map((n) => n.id)),
        ranks = new Map(items.map((n) => [n.id, 0])),
        incoming = new Map(items.map((n) => [n.id, 0])),
        out = new Map(items.map((n) => [n.id, [] as string[]]));
      const representative = (id: string | undefined) => {
        let n = id ? c.nodes.get(id) : undefined;
        while (n && n.parent !== parent) n = c.nodes.get(n.parent);
        return n?.id;
      };
      for (const e of c.checked.cells!.filter((e) => e.kind === "edge")) {
        const a = representative(e.source),
          b = representative(e.target);
        if (
          a &&
          b &&
          a !== b &&
          ids.has(a) &&
          ids.has(b) &&
          !out.get(a)!.includes(b)
        ) {
          out.get(a)!.push(b);
          incoming.set(b, incoming.get(b)! + 1);
        }
      }
      const queue = items.filter((n) => !incoming.get(n.id)).map((n) => n.id),
        visited = new Set<string>();
      for (let k = 0; k < queue.length; k++) {
        const id = queue[k];
        visited.add(id);
        for (const next of out.get(id)!) {
          ranks.set(next, Math.max(ranks.get(next)!, ranks.get(id)! + 1));
          incoming.set(next, incoming.get(next)! - 1);
          if (!incoming.get(next)) queue.push(next);
        }
      }
      let nextRank = Math.max(0, ...ranks.values());
      for (const n of items)
        if (!visited.has(n.id)) ranks.set(n.id, ++nextRank);
      const horizontal = o.mode === "horizontal",
        container = c.nodes.get(parent),
        startX = container ? 24 : Math.min(...siblings.map((n) => n.x)),
        startY = container
          ? Number(container.style.startSize || 32) + 24
          : Math.min(...siblings.filter((n) => !n.decoration).map((n) => n.y));
      const placed = [...fixed];
      let along = horizontal ? startX : startY;
      for (const rank of [...new Set(ranks.values())].sort((a, b) => a - b)) {
        const level = items.filter((n) => ranks.get(n.id) === rank);
        let across = horizontal ? startY : startX;
        for (const n of level) {
          n.x = horizontal ? along : across;
          n.y = horizontal ? across : along;
          let attempts = 0;
          while (
            placed.some((p) => intersects(n, p, gap / 2)) &&
            attempts++ < 2000
          ) {
            if (horizontal) n.y += gap + 24;
            else n.x += gap + 24;
          }
          placed.push(n);
          moved.add(n.id);
          across = (horizontal ? n.y + n.height : n.x + n.width) + gap;
        }
        along +=
          Math.max(...level.map((n) => (horizontal ? n.width : n.height))) +
          layerGap;
      }
    }
    const p = c.nodes.get(parent);
    if (p && !p.locked && !p.relative && includes(p)) {
      p.width = Math.max(p.width, ...siblings.map((n) => n.x + n.width + 24));
      p.height = Math.max(
        p.height,
        ...siblings.map((n) => n.y + n.height + 24),
      );
      moved.add(p.id);
    }
  }
  for (const n of c.nodes.values())
    if (moved.has(n.id)) {
      const g = c.cells.get(n.id).getElementsByTagName("mxGeometry")[0];
      for (const key of ["x", "y", "width", "height"] as const)
        g.setAttribute(key, String(n[key]));
    }
  if (o.mode !== "appearance")
    for (const e of c.checked.cells!.filter((e) => e.kind === "edge")) {
      if (
        c.locked(e.id) ||
        (!moved.has(e.source!) && !moved.has(e.target!)) ||
        (selected.size &&
          !selected.has(e.id) &&
          !(
            includes(c.nodes.get(e.source!)!) &&
            includes(c.nodes.get(e.target!)!)
          ))
      )
        continue;
      const a = c.nodes.get(e.source!),
        b = c.nodes.get(e.target!);
      if (!a || !b) continue;
      const aa = c.absolute(a),
        bb = c.absolute(b),
        horizontal = o.mode === "horizontal";
      const start = horizontal
        ? { x: aa.x + aa.width, y: aa.y + aa.height / 2 }
        : { x: aa.x + aa.width / 2, y: aa.y + aa.height };
      const end = horizontal
        ? { x: bb.x, y: bb.y + bb.height / 2 }
        : { x: bb.x + bb.width / 2, y: bb.y };
      const obstacles = [...c.nodes.values()]
        .filter(
          (n) =>
            n.id !== a.id &&
            n.id !== b.id &&
            !c.ancestor(n.id, a.id) &&
            !c.ancestor(n.id, b.id),
        )
        .map(c.absolute);
      let bends: Array<{ x: number; y: number }> | undefined;
      for (let k = 0; k < 50; k++) {
        const mid = horizontal
          ? (start.x + end.x) / 2 +
            (k ? Math.ceil(k / 2) * gap * (k % 2 ? 1 : -1) : 0)
          : (start.y + end.y) / 2 +
            (k ? Math.ceil(k / 2) * gap * (k % 2 ? 1 : -1) : 0);
        const points = horizontal
          ? [
              { x: mid, y: start.y },
              { x: mid, y: end.y },
            ]
          : [
              { x: start.x, y: mid },
              { x: end.x, y: mid },
            ];
        const all = [start, ...points, end];
        if (
          !obstacles.some((n) =>
            all.some((p, i) => i > 0 && segmentHits(all[i - 1], p, n)),
          )
        ) {
          bends = points;
          break;
        }
      }
      if (!bends) {
        warnings.push(`连线 ${e.label || e.id} 未找到安全路径，请核对`);
        continue;
      }
      const cell = c.cells.get(e.id),
        g = cell.getElementsByTagName("mxGeometry")[0];
      if (!g) continue;
      for (const arr of Array.from(g.getElementsByTagName("Array")) as any[])
        if (arr.getAttribute("as") === "points") g.removeChild(arr);
      const arr = c.doc.createElement("Array");
      arr.setAttribute("as", "points");
      const parent = c.nodes.get(e.parent),
        origin = parent ? c.absolute(parent) : { x: 0, y: 0 };
      for (const p of bends) {
        const point = c.doc.createElement("mxPoint");
        point.setAttribute("x", String(p.x - origin.x));
        point.setAttribute("y", String(p.y - origin.y));
        arr.appendChild(point);
      }
      g.appendChild(arr);
      setStyle(cell, {
        edgeStyle: "orthogonalEdgeStyle",
        exitX: horizontal ? "1" : "0.5",
        exitY: horizontal ? "0.5" : "1",
        entryX: horizontal ? "0" : "0.5",
        entryY: horizontal ? "0.5" : "0",
        exitDx: "0",
        exitDy: "0",
        entryDx: "0",
        entryDy: "0",
      });
    }
  const result = compareDocuments(xml, c.serialize());
  return {
    ...result,
    baseXml: c.checked.xml!,
    warnings: warnings.slice(0, 100),
    quality: inspectQuality(result.candidateXml!),
  };
}
