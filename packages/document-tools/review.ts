import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { compareDocuments } from "./diff.ts";
import { documentModel } from "./model.ts";
import { mergeXml } from "../editor-adapter/collaboration.js";
export type ChangeGroup = {
  id: string;
  label: string;
  ids: string[];
  structural: boolean;
  changes: ReturnType<typeof compareDocuments>["changes"];
};
export function reviewGroups(baseXml: string, candidateXml: string) {
  const diff = compareDocuments(baseXml, candidateXml);
  if (!diff.sameDocument) throw Error("候选属于另一个图稿");
  const a = documentModel(baseXml),
    b = documentModel(candidateXml),
    structural = new Set(
      diff.changes
        .filter((c) => ["新增", "删除", "关系"].includes(c.kind))
        .map((c) => c.id),
    );
  const parent = new Map([...structural].map((id) => [id, id]));
  const find = (id: string): string => {
    const p = parent.get(id)!;
    return p === id ? id : find(p);
  };
  const union = (a: string, b: string) => {
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  };
  for (const model of [a, b])
    for (const id of structural) {
      const cell = model.cells.get(id);
      if (!cell) continue;
      for (const k of ["parent", "source", "target"])
        union(id, cell.getAttribute(k));
    }
  const groups: ChangeGroup[] = [];
  for (const key of [...new Set([...structural].map(find))]) {
    const ids = [...structural].filter((id) => find(id) === key).sort();
    const changes = diff.changes.filter((c) => ids.includes(c.id));
    groups.push({
      id: `structure:${ids.join(",")}`,
      label: `结构调整 · ${ids.length} 个对象`,
      ids,
      structural: true,
      changes,
    });
  }
  for (const change of diff.changes.filter((c) => !structural.has(c.id)))
    groups.push({
      id: `${change.id}:${change.kind}`,
      label: `${change.kind} · ${change.label || change.id}`,
      ids: [change.id],
      structural: false,
      changes: [change],
    });
  return { ...diff, baseXml: a.checked.xml!, groups };
}
export function composeReview(
  baseXml: string,
  candidateXml: string,
  currentXml: string,
  selected: string[],
) {
  if (!Array.isArray(selected) || selected.some((id) => typeof id !== "string"))
    throw Error("操作组选项无效");
  const review = reviewGroups(baseXml, candidateXml),
    a = documentModel(baseXml),
    b = documentModel(candidateXml),
    current = documentModel(currentXml);
  if (current.checked.metadata!.documentId !== review.documentId)
    throw Error("当前图稿已切换");
  if (
    !selected.length ||
    selected.some((id) => !review.groups.some((g) => g.id === id))
  )
    throw Error("请选择有效操作组");
  const picked = review.groups.filter((g) => selected.includes(g.id)),
    changesNow = compareDocuments(baseXml, currentXml).changes;
  const conflicts: Array<{ groupId: string; message: string }> = [];
  const remainingChanges = compareDocuments(candidateXml, currentXml).changes;
  for (const group of picked) {
    const changed = changesNow.some(
      (c) =>
        group.ids.includes(c.id) &&
        (group.structural ||
          c.kind === group.changes[0].kind ||
          ["删除", "关系", "新增"].includes(c.kind)),
    );
    const concurrentDependent =
      group.structural &&
      changesNow.some((change) => {
        const cell = current.cells.get(change.id);
        return (
          cell &&
          ["parent", "source", "target"].some((k) =>
            group.ids.includes(cell.getAttribute(k)),
          )
        );
      });
    // Already matching changes are safe and idempotent.
    const remaining = remainingChanges.some(
      (c) =>
        group.ids.includes(c.id) &&
        (group.structural || c.kind === group.changes[0].kind),
    );
    if ((changed && remaining) || concurrentDependent)
      conflicts.push({
        groupId: group.id,
        message: "此操作组涉及人工修改或新增依赖，请取消勾选后重新预览",
      });
  }
  const patch = documentModel(baseXml);
  for (const group of picked) {
    if (conflicts.some((c) => c.groupId === group.id)) continue;
    for (const id of group.ids) {
      const old = patch.entries.get(id),
        next = b.entries.get(id);
      if (group.structural) {
        if (old) patch.root.removeChild(old);
        if (next) patch.root.appendChild(patch.doc.importNode(next, true));
        continue;
      }
      const kind = group.changes[0].kind,
        cell = patch.cells.get(id),
        source = b.cells.get(id);
      if (!cell || !source) continue;
      if (kind === "样式")
        cell.setAttribute("style", source.getAttribute("style") || "");
      if (kind === "文字") {
        const attr = next.tagName === "mxCell" ? "value" : "label";
        if (next.hasAttribute(attr))
          old.setAttribute(attr, next.getAttribute(attr));
        else old.removeAttribute(attr);
      }
      if (kind === "位置/尺寸/折点") {
        for (const g of Array.from(
          cell.getElementsByTagName("mxGeometry"),
        ) as any[])
          cell.removeChild(g);
        const g = source.getElementsByTagName("mxGeometry")[0];
        if (g) cell.appendChild(patch.doc.importNode(g, true));
      }
    }
  }
  // Ensure partial structural edits cannot create dangling edges, then use the existing attribute merge.
  const partial = documentModel(patch.serialize());
  const merged = mergeXml(
    a.checked.xml!,
    partial.checked.xml!,
    current.checked.xml!,
    DOMParser,
    XMLSerializer,
    true,
  );
  if (merged.conflicts.length && !conflicts.length)
    throw Error("修改存在并发冲突，请重新读取图稿后审阅");
  const diff = compareDocuments(current.checked.xml!, merged.xml);
  return {
    ...diff,
    baseXml: current.checked.xml!,
    groups: review.groups,
    conflicts,
    acceptedGroups: picked
      .filter((g) => !conflicts.some((c) => c.groupId === g.id))
      .map((g) => g.id),
  };
}
