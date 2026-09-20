import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SaxesParser } from "saxes";
import { inflateRawSync } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import {
  LIMITS,
  PROFILE,
  type Validation,
  type Diagnostic,
  type CellSnapshot,
  type Metadata,
} from "./types.ts";
export * from "./types.ts";
export const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
const serializer = new XMLSerializer();
// Canonical values preserve content/child order, while ignoring XML attribute order and numeric spelling.
export function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export function canonicalGeometry(node: any): any {
  return {
    tag: node.tagName,
    attributes: geometryAttributes(
      Object.fromEntries(
        Array.from(node.attributes || []).map((a: any) => [a.name, a.value]),
      ),
    ),
    children: Array.from(node.childNodes || [])
      .filter((n: any) => n.nodeType === 1)
      .map(canonicalGeometry),
  };
}
function geometryAttributes(attrs: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(attrs)
      .filter(
        ([k, v]) => !(["x", "y", "relative"].includes(k) && Number(v) === 0),
      )
      .map(([k, v]) => [
        k,
        ["x", "y", "width", "height", "relative"].includes(k)
          ? String(Number(v))
          : v,
      ]),
  );
}
export function canonicalStyle(style: string) {
  // Named styles can override preceding properties; retain these boundaries.
  const blocks: Array<string | Record<string,string>> = [];
  let properties: Record<string,string> = {};
  const flush=()=>{if(Object.keys(properties).length)blocks.push(properties);properties={};};
  for(const part of style.split(";").filter(Boolean)){
    const i=part.indexOf("=");
    if(i<0){flush();blocks.push(part);}else properties[part.slice(0,i)]=part.slice(i+1);
  }
  flush();return blocks;
}
const allowedTags = new Set([
  "mxfile",
  "diagram",
  "mxGraphModel",
  "root",
  "mxCell",
  "mxGeometry",
  "mxPoint",
  "Array",
  "mxRectangle",
  "object",
  "UserObject",
]);
const shapes = new Set([
  "rectangle",
  "ellipse",
  "rhombus",
  "cylinder",
  "cylinder3",
  "image",
  "label",
  "swimlane",
  "text",
  "line",
  "group",
  "partialRectangle",
]);
const styles = new Set(
  "shape swimlane rounded whiteSpace html fillColor strokeColor strokeWidth fontColor fontSize fontFamily fontStyle align verticalAlign spacing spacingTop spacingBottom spacingLeft spacingRight arcSize dashed dashPattern opacity fillOpacity strokeOpacity shadow glass gradientColor gradientDirection rotation perimeter ellipse rhombus text group image imageWidth imageHeight imageAspect aspect resizable movable editable deletable rotatable connectable locked recursiveResize container collapsible horizontal startSize swimlaneFillColor swimlaneLine swimlaneHead roundedLabel labelBackgroundColor labelBorderColor labelPosition verticalLabelPosition overflow autosize fixedSize part pointerEvents edgeStyle orthogonalLoop jettySize orthogonal curved endArrow endFill endSize startArrow startFill startSize exitX exitY exitDx exitDy exitPerimeter entryX entryY entryDx entryDy entryPerimeter noEdgeStyle elbow segment jumpStyle jumpSize sourcePort targetPort outlineConnect perimeterSpacing sourcePerimeterSpacing targetPerimeterSpacing flipH flipV direction size bendable points metaEdit snapToPoint page".split(
    " ",
  ),
);
const arrows = new Set([
  "none",
  "classic",
  "classicThin",
  "block",
  "blockThin",
  "open",
  "openThin",
  "oval",
  "diamond",
  "diamondThin",
  "async",
  "dash",
  "cross",
]);
function parse(text: string) {
  let depth = 0;
  const p = new SaxesParser();
  p.on("doctype", () => {
    throw new Error("禁止 DTD 和实体声明");
  });
  p.on("opentag", () => {
    if (++depth > LIMITS.xmlDepth) throw new Error("XML 嵌套过深");
  });
  p.on("closetag", () => depth--);
  p.on("error", (e) => {
    throw e;
  });
  p.write(text).close();
  return new DOMParser().parseFromString(text, "text/xml");
}
const elements = (n: any) =>
  Array.from(n.childNodes || []).filter((c: any) => c.nodeType === 1) as any[];
const attr = (n: any, k: string) => n?.getAttribute(k) || "";
export function normalizeInput(input: string): string {
  let doc = parse(input),
    root = doc.documentElement!;
  if (root.tagName === "mxGraphModel") {
    const wrapper = parse(
      '<mxfile><diagram id="page-1" name="画布"/></mxfile>',
    );
    wrapper
      .getElementsByTagName("diagram")[0]
      .appendChild(wrapper.importNode(root, true));
    doc = wrapper;
    root = doc.documentElement!;
  }
  if (root.tagName !== "mxfile")
    throw new Error("文件必须为 mxfile 或 mxGraphModel");
  const pages = Array.from(doc.getElementsByTagName("diagram"));
  if (pages.length !== 1) throw new Error("首版只支持一个画布");
  const page = pages[0];
  if (!elements(page).length) {
    const encoded = (page.textContent || "").trim();
    if (!encoded) throw new Error("图稿为空");
    const raw = inflateRawSync(Buffer.from(encoded, "base64"), {
      maxOutputLength: LIMITS.xmlBytes,
    }).toString("utf8");
    const model = parse(decodeURIComponent(raw)).documentElement!;
    while (page.firstChild) page.removeChild(page.firstChild);
    page.appendChild(doc.importNode(model, true));
  }
  root.setAttribute("compressed", "false");
  return serializer.serializeToString(doc);
}
export function emptyDocument(
  title = "未命名图稿",
  mode: Metadata["generationMode"] = "manual",
): string {
  const m: Metadata = {
    profileVersion: PROFILE,
    documentId: randomUUID(),
    generationMode: mode,
    reviewItems: [],
  };
  const doc = parse(
    '<mxfile compressed="false"><diagram id="page-1" name="画布"><mxGraphModel grid="1" gridSize="10" page="0"><root><object id="0"><mxCell/></object><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>',
  );
  doc.getElementsByTagName("diagram")[0].setAttribute("name", title);
  doc
    .getElementsByTagName("object")[0]
    .setAttribute("dw_meta", JSON.stringify(m));
  return serializer.serializeToString(doc);
}
function imageInfo(data: string) {
  const match =
    /^data:image\/(png|jpeg)(?:;base64)?,([A-Za-z0-9+/=\r\n]+)$/.exec(data);
  if (!match) throw new Error("仅允许内嵌 PNG/JPEG 图片");
  const bytes = Buffer.from(match[2], "base64");
  let width = 0,
    height = 0;
  if (match[1] === "png") {
    if (
      bytes.length < 24 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
      throw new Error("PNG 数据损坏");
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else {
    if (bytes.readUInt16BE(0) !== 0xffd8) throw new Error("JPEG 数据损坏");
    let i = 2;
    while (i + 4 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const len = bytes.readUInt16BE(i + 2);
      if (len < 2) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        height = bytes.readUInt16BE(i + 5);
        width = bytes.readUInt16BE(i + 7);
        break;
      }
      i += 2 + len;
    }
  }
  if (!width || !height) throw new Error("无法解析图片尺寸");
  return { bytes: bytes.length, pixels: width * height };
}
export function validate(input: string): Validation {
  const errors: Diagnostic[] = [],
    warnings: Diagnostic[] = [];
  const out: Validation = {
    ok: false,
    profileVersion: PROFILE,
    fileHash: hash(input),
    contentHash: "",
    errors,
    warnings,
    stats: { nodes: 0, edges: 0, cells: 0 },
  };
  const err = (code: string, message: string, objectId?: string) =>
    errors.push({ code, severity: "error", message, objectId });
  if (Buffer.byteLength(input) > LIMITS.fileBytes) {
    err("RESOURCE_LIMIT", "文件超过 20 MiB");
    return out;
  }
  let xml: string, doc: any;
  try {
    xml = normalizeInput(input);
    if (Buffer.byteLength(xml) > LIMITS.xmlBytes)
      throw new Error("解压 XML 超过限制");
    doc = parse(xml);
  } catch (e) {
    err("XML_INVALID", String((e as Error).message));
    return out;
  }
  const models = doc.getElementsByTagName("mxGraphModel"),
    roots = doc.getElementsByTagName("root");
  if (models.length !== 1 || roots.length !== 1) {
    err("XML_INVALID", "必须存在一个 mxGraphModel/root");
    return out;
  }
  for (const el of Array.from(doc.getElementsByTagName("*")) as any[]) {
    if (attr(el, "math") === "1" || attr(el, "placeholders") === "1")
      err("UNSUPPORTED_FEATURE", "首版禁用数学排版和动态占位符");
    if (attr(el, "tooltip") && !safeLabel(attr(el, "tooltip")))
      err("UNSAFE_CONTENT", "提示文本包含不支持的 HTML");
    if (!allowedTags.has(el.tagName))
      err("UNSUPPORTED_FEATURE", `不支持的 XML 元素 ${el.tagName}`);
    for (const a of Array.from(el.attributes) as any[]) {
      if (
        /^on/i.test(a.name) ||
        ["link", "href", "src"].includes(a.name) ||
        (/javascript:|https?:\/\/|file:\/\//i.test(a.value) &&
          a.name !== "value" &&
          a.name !== "label" &&
          a.name !== "dw_meta")
      )
        err(
          "UNSAFE_CONTENT",
          `属性 ${a.name} 含外部链接或执行内容`,
          attr(el, "id"),
        );
      if (
        ["visible", "collapsed"].includes(a.name) &&
        ((a.name === "visible" && a.value === "0") ||
          (a.name === "collapsed" && a.value === "1"))
      )
        err("UNSUPPORTED_FEATURE", "首版不导入隐藏或折叠内容", attr(el, "id"));
    }
  }
  const cells: CellSnapshot[] = [],
    ids = new Map<string, CellSnapshot>();
  let metadata: Metadata | undefined;
  let imageBytes = 0,
    pixels = 0;
  const entries = elements(roots[0]);
  for (const wrapper of entries) {
    const c =
      wrapper.tagName === "mxCell"
        ? wrapper
        : elements(wrapper).find((n) => n.tagName === "mxCell");
    if (!c) {
      err("XML_INVALID", "对象缺少 mxCell");
      continue;
    }
    const id = attr(wrapper, "id") || attr(c, "id");
    if (!id) {
      err("ID_REQUIRED", "对象缺少 ID");
      continue;
    }
    if (
      id.length > 200 ||
      ["__proto__", "constructor", "prototype"].includes(id)
    )
      err("ID_INVALID", "对象 ID 无效", id);
    if (ids.has(id)) err("DUPLICATE_ID", "对象 ID 重复", id);
    const label = wrapper === c ? attr(c, "value") : attr(wrapper, "label");
    if (/[<>]/.test(label) && !safeLabel(label))
      err(
        "UNSAFE_CONTENT",
        "文字只允许 div/br/b/strong/i/em/u/span/p 等安全格式",
        id,
      );
    const g = elements(c).find((n) => n.tagName === "mxGeometry");
    const geometry: Record<string, string> = {};
    if (g)
      for (const a of Array.from(g.attributes) as any[])
        geometry[a.name] = a.value;
    const cell: CellSnapshot = {
      id,
      parent: attr(c, "parent"),
      kind:
        attr(c, "edge") === "1"
          ? "edge"
          : attr(c, "vertex") === "1"
            ? "node"
            : id === "0"
              ? "root"
              : "layer",
      label,
      style: attr(c, "style"),
      source: attr(c, "source") || undefined,
      target: attr(c, "target") || undefined,
      role: attr(wrapper, "dw_role") || attr(c, "dw_role") || undefined,
      geometry,
    };
    if (attr(c, "edge") === "1" && attr(c, "vertex") === "1")
      err("XML_INVALID", "对象不能同时是节点和边", id);
    if (cell.kind === "node") {
      out.stats.nodes++;
      if (
        !g ||
        Number(geometry.width) <= 0 ||
        Number(geometry.height) <= 0 ||
        !geometry.width ||
        !geometry.height
      )
        err("GEOMETRY_INVALID", "节点必须有正数宽高", id);
    }
    if (cell.kind === "edge") out.stats.edges++;
    for (const geom of [
      g,
      ...(g ? Array.from(g.getElementsByTagName("*")) : []),
    ].filter(Boolean) as any[])
      for (const a of Array.from(geom.attributes) as any[]) {
        if (
          ["x", "y", "width", "height", "relative"].includes(a.name) &&
          (!Number.isFinite(Number(a.value)) ||
            Math.abs(Number(a.value)) > 1_000_000)
        )
          err("GEOMETRY_INVALID", "几何数值无效或超限", id);
      }
    for (const part of cell.style.split(";").filter(Boolean)) {
      const idx = part.indexOf("=");
      const key = idx < 0 ? part : part.slice(0, idx),
        value = idx < 0 ? "" : part.slice(idx + 1);
      if (!styles.has(key)) err("UNSUPPORTED_FEATURE", `不支持样式 ${key}`, id);
      if (
        key === "perimeter" &&
        ![
          "rectanglePerimeter",
          "ellipsePerimeter",
          "rhombusPerimeter",
          "none",
          "",
        ].includes(value)
      )
        err("UNSAFE_CONTENT", "不支持的周界函数", id);
      if (key === "points") {
        try {
          const points = JSON.parse(value);
          if (
            !Array.isArray(points) ||
            points.length > 100 ||
            !points.every(
              (p) =>
                Array.isArray(p) &&
                p.length >= 2 &&
                p.length <= 4 &&
                p.every(
                  (x: any) => typeof x === "number" && Number.isFinite(x),
                ),
            )
          )
            throw Error();
        } catch {
          err("UNSAFE_CONTENT", "连接点必须是有界数值数组", id);
        }
      }
      if (
        [
          "fillColor",
          "strokeColor",
          "fontColor",
          "gradientColor",
          "labelBackgroundColor",
          "labelBorderColor",
          "swimlaneFillColor",
        ].includes(key) &&
        !/^#[a-f0-9]{3}(?:[a-f0-9]{3})?$|^(none|default|inherit)$/i.test(value)
      )
        err("UNSAFE_CONTENT", "颜色必须使用十六进制或 none", id);
      if (
        [
          "fontSize",
          "strokeWidth",
          "opacity",
          "fillOpacity",
          "strokeOpacity",
          "arcSize",
          "spacing",
          "spacingTop",
          "spacingRight",
          "spacingBottom",
          "spacingLeft",
        ].includes(key) &&
        (!Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1000)
      )
        err("STYLE_INVALID", "样式数值无效或超限", id);
      if (key === "shape" && !shapes.has(value))
        err("UNSUPPORTED_FEATURE", `不支持图形 ${value}`, id);
      if (key === "image") {
        try {
          const info = imageInfo(value);
          imageBytes += info.bytes;
          pixels += info.pixels;
          if (info.pixels > LIMITS.singlePixels)
            err("RESOURCE_LIMIT", "单图片解码像素超限", id);
        } catch (e) {
          err("IMAGE_INVALID", (e as Error).message, id);
        }
      }
      if (["endArrow", "startArrow"].includes(key) && !arrows.has(value))
        err("UNSUPPORTED_FEATURE", "不支持的箭头类型", id);
      if (
        ["exitX", "exitY", "entryX", "entryY"].includes(key) &&
        (!Number.isFinite(Number(value)) ||
          Number(value) < 0 ||
          Number(value) > 1)
      )
        err("ANCHOR_INVALID", "锚点应在 0～1 之间", id);
      if (key === "rotation" && Number(value) !== 0)
        err("UNSUPPORTED_FEATURE", "首版不支持旋转", id);
      if (
        key === "edgeStyle" &&
        ![
          "orthogonalEdgeStyle",
          "elbowEdgeStyle",
          "segmentEdgeStyle",
          "none",
          "",
        ].includes(value)
      )
        err("UNSUPPORTED_FEATURE", "不支持该连线路由", id);
      if (key === "fontFamily" && value !== "Noto Sans SC")
        warnings.push({
          code: "FONT_SUBSTITUTED",
          severity: "warning",
          objectId: id,
          message: `字体 ${value} 将替换为 Noto Sans SC`,
        });
    }
    if (id === "0" && attr(wrapper, "dw_meta")) {
      try {
        metadata = JSON.parse(attr(wrapper, "dw_meta"));
        if (
          !metadata ||
          typeof metadata !== "object" ||
          Array.isArray(metadata)
        )
          throw Error("元数据必须是对象");
      } catch {
        err("METADATA_INVALID", "产品元数据不是有效 JSON");
      }
    }
    cells.push(cell);
    ids.set(id, cell);
  }
  out.stats.cells = cells.length;
  if (doc.getElementsByTagName("mxCell").length !== entries.length)
    err("XML_INVALID", "mxCell 必须作为 root 下的对象，不能嵌套在几何中");
  if (ids.get("0")?.kind !== "root" || ids.get("0")?.parent)
    err("XML_INVALID", "根对象无效");
  if (!ids.has("0") || !ids.has("1") || ids.get("1")!.parent !== "0")
    err("XML_INVALID", "必须有根 0 和默认层 1");
  if (cells.filter((c) => c.kind === "layer").length !== 1)
    err("UNSUPPORTED_FEATURE", "首版只支持一个绘图层");
  for (const c of cells) {
    if (c.id !== "0" && !ids.has(c.parent))
      err("PARENT_MISSING", "父对象不存在", c.id);
    if (c.kind === "edge" && c.role !== "decoration")
      for (const endpoint of [c.source, c.target])
        if (!endpoint || ids.get(endpoint)?.kind !== "node")
          err("EDGE_ENDPOINT_MISSING", "关系边必须引用存在的节点", c.id);
    const seen = new Set([c.id]);
    let parent = c.parent,
      depth = 0;
    while (parent && ids.has(parent)) {
      if (seen.has(parent)) {
        err("PARENT_CYCLE", "分组父子关系成环", c.id);
        break;
      }
      seen.add(parent);
      parent = ids.get(parent)!.parent;
      if (++depth > LIMITS.groupDepth + 2) {
        err("RESOURCE_LIMIT", "分组超过 10 层", c.id);
        break;
      }
    }
  }
  if (
    cells.length > LIMITS.cells ||
    out.stats.nodes + out.stats.edges > LIMITS.objects ||
    imageBytes > LIMITS.imageBytes ||
    pixels > LIMITS.totalPixels
  )
    err("RESOURCE_LIMIT", "对象或图片资源超过首版上限");
  if (metadata) {
    if (metadata.profileVersion !== PROFILE)
      err("PROFILE_UNSUPPORTED", `不支持产品版本 ${metadata.profileVersion}`);
    if (
      typeof metadata.documentId !== "string" ||
      !metadata.documentId ||
      !["faithful", "relayout", "manual"].includes(metadata.generationMode)
    )
      err("METADATA_INVALID", "文档身份或生成模式无效");
    if (
      !Array.isArray(metadata.reviewItems) ||
      metadata.reviewItems.length > LIMITS.reviewItems ||
      Buffer.byteLength(JSON.stringify(metadata)) > LIMITS.metadataBytes
    )
      err("METADATA_INVALID", "核对记录无效或超限");
    else {
      const reviewIds = new Set();
      for (const r of metadata.reviewItems) {
        if (
          !r ||
          typeof r.id !== "string" ||
          reviewIds.has(r.id) ||
          typeof r.message !== "string" ||
          !["needsReview", "confirmed"].includes(r.status) ||
          !["text", "relationship", "shape", "region"].includes(r.kind)
        )
          err("METADATA_INVALID", "核对记录字段无效");
        reviewIds.add(r?.id);
        if (r?.objectId && !ids.has(r.objectId))
          err("REVIEW_TARGET_MISSING", "核对对象不存在", r.objectId);
        if (r?.sourceRect) {
          const { x, y, width, height } = r.sourceRect;
          if (
            ![x, y, width, height].every(Number.isFinite) ||
            x < 0 ||
            y < 0 ||
            width <= 0 ||
            height <= 0 ||
            (metadata.source &&
              (x + width > metadata.source.width ||
                y + height > metadata.source.height))
          )
            err("METADATA_INVALID", "来源区域坐标无效");
        }
      }
    }
    if (
      metadata.source &&
      (!/^[a-f0-9]{64}$/.test(metadata.source.sha256) ||
        !Number.isFinite(metadata.source.width) ||
        !Number.isFinite(metadata.source.height) ||
        metadata.source.width <= 0 ||
        metadata.source.height <= 0)
    )
      err("METADATA_INVALID", "原图摘要/尺寸无效");
  } else
    metadata = {
      profileVersion: PROFILE,
      documentId: randomUUID(),
      generationMode: "manual",
      reviewItems: [],
    };
  if (errors.length) return out;
  // Page/root user-object data survives the pinned draw.io codec; no second source format.
  let rootCell = entries.find(
    (n) => (attr(n, "id") || attr(elements(n)[0], "id")) === "0",
  );
  if (rootCell.tagName === "mxCell") {
    const wrapper = doc.createElement("object");
    wrapper.setAttribute("id", "0");
    rootCell.removeAttribute("id");
    rootCell.parentNode.replaceChild(wrapper, rootCell);
    wrapper.appendChild(rootCell);
    rootCell = wrapper;
  }
  rootCell.setAttribute("dw_meta", JSON.stringify(metadata));
  for (const c of Array.from(doc.getElementsByTagName("mxCell")) as any[]) {
    const style = attr(c, "style");
    if (style && /fontFamily=/.test(style))
      c.setAttribute(
        "style",
        style.replace(/fontFamily=[^;]*/g, "fontFamily=Noto Sans SC"),
      );
  }
  for (const cell of cells)
    cell.style = cell.style.replace(
      /fontFamily=[^;]*/g,
      "fontFamily=Noto Sans SC",
    );
  out.xml = serializer.serializeToString(doc);
  out.metadata = metadata;
  out.cells = cells;
  out.ok = true;
  out.contentHash = hash(
    JSON.stringify(
      canonical({
        cells: cells.map((c) => ({
          ...c,
          style: canonicalStyle(c.style),
          geometry: geometryAttributes(c.geometry),
        })),
        metadata,
        geometry: Array.from(doc.getElementsByTagName("mxGeometry")).map(
          canonicalGeometry,
        ),
        // Include object annotations as well as drawing content, but no editor viewport state.
        annotations: entries.map((n: any) =>
          Object.fromEntries(
            Array.from(n.attributes)
              .filter(
                (a: any) =>
                  ![
                    "id",
                    "style",
                    "value",
                    "label",
                    "dw_meta",
                    "parent",
                    "vertex",
                    "edge",
                    "source",
                    "target",
                  ].includes(a.name),
              )
              .map((a: any) => [a.name, a.value]),
          ),
        ),
      }),
    ),
  );
  return out;
}
function safeLabel(s: string): boolean {
  try {
    const d = new DOMParser().parseFromString(
      "<div>" + s + "</div>",
      "text/html",
    );
    for (const el of Array.from(d.getElementsByTagName("*")) as any[]) {
      if (
        !["div", "br", "b", "strong", "i", "em", "u", "span", "p"].includes(
          el.tagName.toLowerCase(),
        )
      )
        return false;
      for (const a of Array.from(el.attributes) as any[]) {
        if (a.name !== "style") return false;
        for (const part of a.value.split(";").filter((v: string) => v.trim())) {
          const pos = part.indexOf(":"),
            key = part.slice(0, pos).trim().toLowerCase(),
            value = part.slice(pos + 1).trim();
          if (
            ![
              "color",
              "background-color",
              "font-size",
              "font-weight",
              "font-family",
              "font-style",
              "text-align",
              "text-decoration",
              "white-space",
            ].includes(key) ||
            /[<>()\\]|url|expression|@/i.test(value)
          )
            return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}
