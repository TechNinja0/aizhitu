import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { validate } from "../document-core/index.ts";
export function documentModel(xml: string) {
  const checked = validate(xml);
  if (!checked.ok) throw Error(checked.errors.map((e) => e.message).join("\n"));
  const doc = new DOMParser().parseFromString(checked.xml!, "text/xml");
  const root = doc.getElementsByTagName("root")[0];
  const entries = new Map(
    Array.from(root.childNodes)
      .filter((n): n is any => n.nodeType === 1)
      .map((n: any) => [String(n.getAttribute("id")), n]),
  );
  const cell = (n: any): any =>
    n.tagName === "mxCell" ? n : n.getElementsByTagName("mxCell")[0];
  const cells = new Map([...entries].map(([id, n]) => [id, cell(n)]));
  const serialize = () => new XMLSerializer().serializeToString(doc);
  return { checked, doc, root, entries, cells, cell, serialize };
}
export const styleMap = (s: string) =>
  Object.fromEntries(
    s
      .split(";")
      .filter((s) => s.includes("="))
      .map((s) => {
        const i = s.indexOf("=");
        return [s.slice(0, i), s.slice(i + 1)];
      }),
  );
export function setStyle(cell: any, values: Record<string, string>) {
  const parts = (cell.getAttribute("style") || "")
    .split(";")
    .filter((s: string) => s && !(s.split("=")[0] in values));
  cell.setAttribute(
    "style",
    [...parts, ...Object.entries(values).map(([k, v]) => `${k}=${v}`)].join(
      ";",
    ) + ";",
  );
}
