import { DOMParser } from "@xmldom/xmldom";
import {
  validate,
  canonical,
  canonicalGeometry,
  canonicalStyle,
} from "../document-core/index.ts";
export function compareDocuments(baseXml: string, candidateXml: string) {
  const base = validate(baseXml),
    candidate = validate(candidateXml);
  if (!base.ok || !candidate.ok)
    throw Error(
      [...base.errors, ...candidate.errors].map((e) => e.message).join("\n"),
    );
  const changes: Array<{
    id: string;
    kind: string;
    label: string;
    before?: string;
    after?: string;
  }> = [];
  const before = new Map(
    base
      .cells!.filter((c) => c.kind !== "root" && c.kind !== "layer")
      .map((c) => [c.id, c]),
  );
  const after = new Map(
    candidate
      .cells!.filter((c) => c.kind !== "root" && c.kind !== "layer")
      .map((c) => [c.id, c]),
  );
  const geometries = (xml: string) =>
    new Map(
      Array.from(
        new DOMParser()
          .parseFromString(xml, "text/xml")
          .getElementsByTagName("mxCell"),
      ).map((c) => [
        c.getAttribute("id") ||
          (c.parentNode?.nodeType === 1 &&
            (c.parentNode as any).getAttribute("id")),
        Array.from(c.getElementsByTagName("mxGeometry"))
          .map((g) => JSON.stringify(canonical(canonicalGeometry(g))))
          .join(""),
      ]),
    );
  const bg = geometries(base.xml!),
    ag = geometries(candidate.xml!);
  const styles = (s:string)=>JSON.stringify(canonical(canonicalStyle(s)));
  for (const [id, a] of before) {
    const b = after.get(id);
    if (!b) {
      changes.push({ id, kind: "删除", label: a.label });
      continue;
    }
    for (const [kind, x, y] of [
      ["文字", a.label, b.label],
      [
        "关系",
        JSON.stringify([a.kind, a.source, a.target, a.parent]),
        JSON.stringify([b.kind, b.source, b.target, b.parent]),
      ],
      ["位置/尺寸/折点", bg.get(id), ag.get(id)],
      ["样式", styles(a.style), styles(b.style)],
    ] as string[][]) {
      if (x !== y)
        changes.push({ id, kind, label: b.label, before: x, after: y });
    }
  }
  for (const [id, b] of after)
    if (!before.has(id)) changes.push({ id, kind: "新增", label: b.label });
  return {
    baseHash: base.contentHash,
    documentId: base.metadata!.documentId,
    sameDocument: base.metadata!.documentId === candidate.metadata!.documentId,
    candidateXml: candidate.xml,
    changes,
  };
}
