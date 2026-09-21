// Shared by the server and editor. Inputs must be validated, uncompressed single-page XML.
export function mergeXml(
  baseXml,
  localXml,
  remoteXml,
  Parser = globalThis.DOMParser,
  Serializer = globalThis.XMLSerializer,
  conditional = false,
) {
  const parse = (xml) => new Parser().parseFromString(xml, "text/xml");
  const serialize = (node) => new Serializer().serializeToString(node);
  const children = (node) =>
    Array.from(node?.childNodes || []).filter((n) => n.nodeType === 1);
  const attrs = (node) =>
    Object.fromEntries(
      Array.from(node?.attributes || []).map((a) => [a.name, a.value]),
    );
  const canonical = (node) =>
    node
      ? JSON.stringify([
          node.tagName,
          Object.entries(attrs(node)).sort(),
          children(node).map(canonical),
        ])
      : "";
  const base = parse(baseXml),
    local = parse(localXml),
    remote = parse(remoteXml);
  const root = (doc) => doc.getElementsByTagName("root")[0];
  const entries = (doc) =>
    new Map(children(root(doc)).map((n) => [n.getAttribute("id"), n]));
  const b = entries(base),
    l = entries(local),
    r = entries(remote);
  const conflicts = new Set();
  const field = (before, next, current, key) => {
    if (before === next) return current;
    if (current !== before && current !== next) {
      conflicts.add(key);
      if (conditional) return current;
    }
    return next;
  };
  const patchAttrs = (bn, ln, rn, key) => {
    const ba = attrs(bn),
      la = attrs(ln),
      ra = attrs(rn);
    for (const name of new Set([...Object.keys(ba), ...Object.keys(la)])) {
      let value;
      // Preserve named-style boundaries; merge key/value properties inside matching blocks.
      if (name === "style" && ba[name] !== la[name]) {
        const split = (s) => {
          const blocks = [Object.create(null)];
          const names = [];
          for (const part of (s || "").split(";").filter(Boolean)) {
            const i = part.indexOf("=");
            if (i < 0) {
              names.push(part);
              blocks.push(Object.create(null));
            } else blocks.at(-1)[part.slice(0, i)] = part.slice(i + 1);
          }
          return { blocks, names };
        };
        const bs = split(ba[name]),
          ls = split(la[name]),
          rs = split(ra[name]);
        if (
          JSON.stringify(bs.names) === JSON.stringify(ls.names) &&
          JSON.stringify(bs.names) === JSON.stringify(rs.names)
        ) {
          value = rs.blocks
            .map((block, i) => {
              for (const k of new Set([
                ...Object.keys(bs.blocks[i]),
                ...Object.keys(ls.blocks[i]),
              ])) {
                const v = field(
                  bs.blocks[i][k],
                  ls.blocks[i][k],
                  block[k],
                  `${key}.style.${k}`,
                );
                if (v === undefined) delete block[k];
                else block[k] = v;
              }
              return (
                Object.entries(block)
                  .map(([k, v]) => `${k}=${v};`)
                  .join("") + (rs.names[i] ? rs.names[i] + ";" : "")
              );
            })
            .join("");
        } else value = field(ba[name], la[name], ra[name], `${key}.${name}`);
      } else value = field(ba[name], la[name], ra[name], `${key}.${name}`);
      if (value === undefined) rn.removeAttribute(name);
      else rn.setAttribute(name, value);
    }
  };
  const patch = (bn, ln, rn, key) => {
    if (canonical(bn) === canonical(ln)) return;
    if (bn.tagName !== ln.tagName || bn.tagName !== rn.tagName) {
      if (
        field(canonical(bn), canonical(ln), canonical(rn), key) ===
        canonical(ln)
      )
        rn.parentNode.replaceChild(remote.importNode(ln, true), rn);
      return;
    }
    patchAttrs(bn, ln, rn, key);
    const bc = children(bn),
      lc = children(ln),
      rc = children(rn);
    const signature = (nodes) =>
      nodes.map((n) => `${n.tagName}:${n.getAttribute("as") || ""}`).join("|");
    if (signature(bc) === signature(lc) && signature(bc) === signature(rc)) {
      bc.forEach((n, i) => patch(n, lc[i], rc[i], `${key}/${i}`));
    } else if (
      field(
        bc.map(canonical).join(""),
        lc.map(canonical).join(""),
        rc.map(canonical).join(""),
        `${key}.children`,
      ) === lc.map(canonical).join("")
    ) {
      while (rn.firstChild) rn.removeChild(rn.firstChild);
      lc.forEach((n) => rn.appendChild(remote.importNode(n, true)));
    }
  };
  for (const [id, bn] of b) {
    const ln = l.get(id),
      rn = r.get(id);
    if (!ln && rn && id !== "0" && id !== "1") {
      if (!conditional || canonical(bn) === canonical(rn)) {
        rn.parentNode.removeChild(rn);
        r.delete(id);
      }
    } else if (ln && rn) patch(bn, ln, rn, id);
    // A stale property edit cannot resurrect a remotely deleted object.
    else if (ln && !rn && canonical(bn) !== canonical(ln))
      conflicts.add(`${id}.deleted`);
  }
  for (const [id, ln] of l)
    if (!b.has(id)) {
      if (r.has(id)) {
        if (canonical(r.get(id)) !== canonical(ln))
          throw Error("新增对象 ID 冲突，请保存副本后重新载入");
      } else {
        const added = remote.importNode(ln, true);
        root(remote).appendChild(added);
        r.set(id, added);
      }
    }
  // Local reorder takes precedence only when the order of existing objects actually changed.
  const common = new Set([...b.keys()].filter((id) => l.has(id) && r.has(id)));
  const order = (map) => [...map.keys()].filter((id) => common.has(id));
  if (JSON.stringify(order(b)) !== JSON.stringify(order(l))) {
    const commonNodes = order(l).map((id) => r.get(id));
    let i = 0;
    const ordered = children(root(remote)).map((n) =>
      common.has(n.getAttribute("id")) ? commonNodes[i++] : n,
    );
    ordered.forEach((n) => root(remote).appendChild(n));
  }
  const cell = (n) =>
    n.tagName === "mxCell"
      ? n
      : children(n).find((c) => c.tagName === "mxCell");
  // Delete wins over concurrent descendants and edges; never persist dangling references.
  let removed;
  do {
    removed = false;
    for (const [id, node] of r) {
      if (id === "0" || id === "1") continue;
      const c = cell(node);
      if (
        ["parent", "source", "target"].some(
          (k) => c.hasAttribute(k) && !r.has(c.getAttribute(k)),
        )
      ) {
        node.parentNode.removeChild(node);
        r.delete(id);
        removed = true;
        conflicts.add(`${id}.deleted`);
      }
    }
  } while (removed);
  const meta = r.get("0");
  if (meta?.hasAttribute("dw_meta")) {
    const data = JSON.parse(meta.getAttribute("dw_meta"));
    data.reviewItems = (data.reviewItems || []).filter(
      (item) => !item.objectId || r.has(item.objectId),
    );
    // A remote edit must not leave a stale confirmation attached to changed content.
    for (const item of data.reviewItems)
      if (item.status === "confirmed" && item.objectId) {
        const node = r.get(item.objectId),
          c = cell(node);
        const label =
          node.tagName === "mxCell"
            ? c.getAttribute("value") || ""
            : node.getAttribute("label") || "";
        const hash = JSON.stringify({
          label,
          source: c.getAttribute("source") || undefined,
          target: c.getAttribute("target") || undefined,
        });
        if (item.reviewedContentHash !== hash) {
          item.status = "needsReview";
          delete item.reviewedContentHash;
        }
      }
    meta.setAttribute("dw_meta", JSON.stringify(data));
  }
  // Server validation additionally enforces depth, resource and content limits.
  for (const [id, node] of r) {
    const seen = new Set([id]);
    let parent = cell(node).getAttribute("parent");
    while (parent && r.has(parent)) {
      if (seen.has(parent))
        throw Error("并发分组形成循环，请保存副本后重新载入");
      seen.add(parent);
      parent = cell(r.get(parent)).getAttribute("parent");
    }
  }
  return { xml: serialize(remote), conflicts: [...conflicts] };
}

export function equivalentXml(a, b, Parser = globalThis.DOMParser) {
  const shape = (xml) => {
    const doc = new Parser().parseFromString(xml, "text/xml");
    const walk = (n) => [
      n.tagName,
      Array.from(n.attributes || [])
        .map((a) => [a.name, a.value])
        .sort(),
      Array.from(n.childNodes || [])
        .filter((c) => c.nodeType === 1)
        .map(walk),
    ];
    return JSON.stringify(walk(doc.getElementsByTagName("root")[0]));
  };
  return shape(a) === shape(b);
}
