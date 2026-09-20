import type { TemplateEdge, TemplateNode } from "./index";
type Point = { x: number; y: number };
const offset = 18;
const key = (n: number) => Math.round(n * 1e6) / 1e6;

// Route the dense reference templates through the gutters between components.
// Lane containers are responsibility boundaries, not obstacles.
export function routeArchitecture(
  nodes: TemplateNode[],
  edges: TemplateEdge[],
): TemplateEdge[] {
  const boxes = nodes.filter((n) => n.shape !== "lane");
  const xs = [
    ...new Set(
      boxes
        .flatMap((n) => [n.x - offset, n.x + n.w / 2, n.x + n.w + offset])
        .map(key),
    ),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set(
      boxes
        .flatMap((n) => [n.y - offset, n.y + n.h / 2, n.y + n.h + offset])
        .map(key),
    ),
  ].sort((a, b) => a - b);
  const points = ys.flatMap((y) => xs.map((x) => ({ x, y })));
  const blocked = (a: Point, b: Point) =>
    boxes.some((n) => {
      const left = n.x - 6,
        right = n.x + n.w + 6,
        top = n.y - 6,
        bottom = n.y + n.h + 6;
      return a.x === b.x
        ? a.x > left &&
            a.x < right &&
            Math.max(a.y, b.y) > top &&
            Math.min(a.y, b.y) < bottom
        : a.y > top &&
            a.y < bottom &&
            Math.max(a.x, b.x) > left &&
            Math.min(a.x, b.x) < right;
    });
  const neighbors = points.map((p, i) => {
    const adjacent = [
      i % xs.length ? i - 1 : -1,
      i % xs.length < xs.length - 1 ? i + 1 : -1,
      i >= xs.length ? i - xs.length : -1,
      i < points.length - xs.length ? i + xs.length : -1,
    ];
    return adjacent.filter((j) => j >= 0 && !blocked(p, points[j]));
  });
  const anchor = (
    n: TemplateNode,
    side: NonNullable<TemplateEdge["from"]>,
    outside: boolean,
  ): Point => {
    const d = outside ? offset : 0;
    return {
      x: key(
        side === "left"
          ? n.x - d
          : side === "right"
            ? n.x + n.w + d
            : n.x + n.w / 2,
      ),
      y: key(
        side === "top"
          ? n.y - d
          : side === "bottom"
            ? n.y + n.h + d
            : n.y + n.h / 2,
      ),
    };
  };
  return edges.map((edge) => {
    const source = boxes.find((n) => n.id === edge.source)!,
      target = boxes.find((n) => n.id === edge.target)!;
    const from = edge.from!,
      to = edge.to!;
    const start = anchor(source, from, true),
      end = anchor(target, to, true);
    const index = (p: Point) => ys.indexOf(p.y) * xs.length + xs.indexOf(p.x);
    const first = index(start),
      last = index(end),
      horizontal = (side: string) => side === "left" || side === "right";
    // Two states per grid point retain arrival direction, allowing bend penalties.
    const initial = first * 2 + Number(horizontal(from));
    const cost = new Float64Array(points.length * 2).fill(Infinity);
    const previous = new Int32Array(points.length * 2).fill(-1);
    const heap: { state: number; cost: number }[] = [];
    const push = (item: { state: number; cost: number }) => {
      let i = heap.length;
      heap.push(item);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent].cost <= item.cost) break;
        heap[i] = heap[parent];
        i = parent;
      }
      heap[i] = item;
    };
    const pop = () => {
      const best = heap[0],
        tail = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (
            child + 1 < heap.length &&
            heap[child + 1].cost < heap[child].cost
          )
            child++;
          if (tail.cost <= heap[child].cost) break;
          heap[i] = heap[child];
          i = child;
        }
        heap[i] = tail;
      }
      return best;
    };
    cost[initial] = 0;
    push({ state: initial, cost: 0 });
    let finish = -1;
    while (heap.length) {
      const current = pop();
      if (current.cost !== cost[current.state]) continue;
      const at = current.state >> 1,
        direction = current.state % 2;
      if (at === last) {
        finish = current.state;
        break;
      }
      for (const next of neighbors[at]) {
        const a = points[at],
          b = points[next],
          axis = Number(a.y === b.y),
          state = next * 2 + axis;
        const distance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        const score =
          current.cost +
          distance +
          (axis === direction ? 0 : 36) +
          (next === last && axis !== Number(horizontal(to)) ? 36 : 0);
        if (score < cost[state]) {
          cost[state] = score;
          previous[state] = current.state;
          push({ state, cost: score });
        }
      }
    }
    if (finish < 0)
      throw Error(`No architecture route: ${source.id} -> ${target.id}`);
    const path: Point[] = [];
    for (let state = finish; state >= 0; state = previous[state])
      path.push(points[state >> 1]);
    path.reverse();
    const all = [
      anchor(source, from, false),
      ...path,
      anchor(target, to, false),
    ];
    const corners = all.filter(
      (p, i) =>
        !i ||
        i === all.length - 1 ||
        !(
          (all[i - 1].x === p.x && p.x === all[i + 1].x) ||
          (all[i - 1].y === p.y && p.y === all[i + 1].y)
        ),
    );
    return { ...edge, via: corners.slice(1, -1) };
  });
}
