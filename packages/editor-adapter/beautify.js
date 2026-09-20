/* Pure routing planner: geometry is in the same absolute coordinate system. */
(function (root) {
  function plan(nodes, edges) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const changes = [];
    for (const edge of edges) {
      const a = byId.get(edge.source), b = byId.get(edge.target);
      if (!a || !b || a.id === b.id || edge.locked || a.locked || b.locked) continue;
      const excluded = new Set([a.id, b.id, ...(a.ancestors || []), ...(b.ancestors || [])]);
      const candidates = [];
      // Anchors need not be at the centres: common projection removes tiny doglegs without moving nodes.
      for (const axis of ['horizontal', 'vertical']) {
        const horizontal = axis === 'horizontal';
        const along = horizontal ? 'x' : 'y', across = horizontal ? 'y' : 'x';
        const size = horizontal ? 'width' : 'height', breadth = horizontal ? 'height' : 'width';
        const forward = a[along] + a[size] <= b[along];
        const backward = b[along] + b[size] <= a[along];
        if (!forward && !backward) continue;
        const lo = Math.max(a[across] + a[breadth] * .15, b[across] + b[breadth] * .15);
        const hi = Math.min(a[across] + a[breadth] * .85, b[across] + b[breadth] * .85);
        if (lo > hi) continue;
        const level = Math.max(lo, Math.min(hi, (a[across]+a[breadth]/2+b[across]+b[breadth]/2)/2));
        const start = forward ? a[along]+a[size] : a[along];
        const end = forward ? b[along] : b[along]+b[size];
        const min = Math.min(start,end), max = Math.max(start,end);
        const blocked = nodes.some(n => !excluded.has(n.id) && !n.decoration && n[along] < max-1 && n[along]+n[size] > min+1 && n[across]-5 < level && n[across]+n[breadth]+5 > level);
        if (blocked) continue;
        const sa = (level-a[across])/a[breadth], sb = (level-b[across])/b[breadth];
        candidates.push({id:edge.id, axis, distance:max-min, exitX:horizontal?(forward?1:0):sa, exitY:horizontal?sa:(forward?1:0), entryX:horizontal?(forward?0:1):sb, entryY:horizontal?sb:(forward?0:1)});
      }
      candidates.sort((a,b)=>a.distance-b.distance);
      if (candidates[0]) changes.push(candidates[0]);
    }
    return changes;
  }
  root.DiagramBeautify = {plan};
})(globalThis);
