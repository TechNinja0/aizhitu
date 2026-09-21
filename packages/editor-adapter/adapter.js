import { mergeXml, equivalentXml } from "./collaboration.js";
/* Local, versioned integration. Upstream bundles remain unmodified. */
(function () {
  "use strict";
  const parentOrigin =
    new URLSearchParams(location.search).get("parentOrigin") || location.origin;
  if (!["http:", "https:"].includes(new URL(parentOrigin).protocol) || new URL(parentOrigin).hostname !== location.hostname)
    throw Error("Invalid parent origin");
  let ui,
    graph,
    revision = 0,
    loading = false,
    readOnly = false,
    notifyTimer,
    maxTimer,
    panHeld = false;
  const setPanMode = (active) => {
    panHeld = !!active;
    graph.container.classList.toggle("workbench-pan", panHeld);
    if (!panHeld) graph.container.classList.remove("workbench-panning");
  };
  const send = (message) => {
    if (window.parent !== window)
      parent.postMessage(
        { channel: "diagram-workbench", ...message },
        parentOrigin,
      );
  };
  const meta = () => {
    const v = graph.model.root.value;
    return v && v.getAttribute
      ? JSON.parse(v.getAttribute("dw_meta") || "{}")
      : {};
  };
  const writeMeta = (data) => {
    let v = graph.model.root.value;
    v =
      v && v.cloneNode
        ? v.cloneNode(true)
        : mxUtils.createXmlDocument().createElement("object");
    v.setAttribute("dw_meta", JSON.stringify(data));
    graph.model.setValue(graph.model.root, v);
  };
  const content = (cell) =>
    JSON.stringify({
      label: graph.convertValueToString(cell),
      source: cell.source?.id,
      target: cell.target?.id,
    });
  const collaboration = { active: false, before: '', undo: [], redo: [] };
  const xmlData = () => ui.getFileData(true, null, null, null, true, true, null, false, null, true);
  const replaceCollaborative = (xml) => {
    const parsed = mxUtils.parseXml(xml), model = new mxGraphModel();
    new mxCodec(parsed).decode(parsed.getElementsByTagName('mxGraphModel')[0], model);
    const selection = graph.getSelectionCells().map(c => c.id);
    const scale = graph.view.scale, translate = graph.view.translate.clone();
    loading = true;
    try {
      graph.model.setRoot(model.root);
      ui.editor.undoManager.clear();
      graph.setSelectionCells(selection.map(id => graph.model.getCell(id)).filter(Boolean));
      graph.view.scaleAndTranslate(scale, translate.x, translate.y);
      graph.refresh();
      revision++;
      collaboration.before = xmlData();
    } finally { loading = false; }
  };
  const collaborativeUndo = (redo) => {
    const from = redo ? collaboration.redo : collaboration.undo;
    const to = redo ? collaboration.undo : collaboration.redo;
    const entry = from.at(-1);
    if (!entry) return;
    const current = xmlData();
    const next = mergeXml(redo ? entry.before : entry.after, redo ? entry.after : entry.before, current, undefined, undefined, true).xml;
    replaceCollaborative(next);
    from.pop();
    to.push(redo ? {before: current, after: xmlData()} : {before: xmlData(), after: current});
    schedule();
  };
  const snapshot = () => {
    // Even with no active cell editor, stopEditing emits EDITING_STOPPED and
    // draw.io's typing shim can steal focus from inputs in the parent page.
    if (graph.isEditing()) graph.stopEditing(false);
    return {
      xml: ui.getFileData(
        true,
        null,
        null,
        null,
        true,
        true,
        null,
        false,
        null,
        true,
      ),
      zoom: graph.view.scale,
      revision,
      selection: graph.getSelectionCells().map((c) => c.id),
      metadata: meta(),
      counts: {
        nodes: Object.values(graph.model.cells).filter((c) => c.vertex).length,
        edges: Object.values(graph.model.cells).filter((c) => c.edge).length,
      },
      canUndo: collaboration.active ? collaboration.undo.length > 0 : ui.editor.undoManager.canUndo(),
      canRedo: collaboration.active ? collaboration.redo.length > 0 : ui.editor.undoManager.canRedo(),
    };
  };
  const changed = () => {
    clearTimeout(notifyTimer);
    clearTimeout(maxTimer);
    maxTimer = undefined;
    send({ event: "changed", ...snapshot() });
  };
  const schedule = () => {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(changed, 350);
    if (!maxTimer) maxTimer = setTimeout(changed, 1500);
  };
  const descendants = (cells) => {
    const out = new Set();
    const walk = (c) => {
      if (out.has(c)) return;
      out.add(c);
      (c.children || []).forEach(walk);
    };
    cells.forEach(walk);
    return [...out];
  };
  function configure() {
    Editor.defaultCompressed = false;
    Editor.enableServiceWorker = false;
    Editor.initMath = function () {};
    Editor.enableCustomLibraries = false;
    mxConstants.DEFAULT_FONTFAMILY = "Noto Sans SC";
    EditorUi.prototype.menubarHeight = 0;
    EditorUi.prototype.footerHeight = 0;
    EditorUi.prototype.isOffline = function () {
      return true;
    };
    EditorUi.prototype.isRemoteExportEnabled = function () {
      return false;
    };
    // P0 uses only built-in mxGraph primitives; optional stencil/ELK/Mermaid bundles are intentionally not loaded.
    const load = App.loadScripts;
    App.loadScripts = function (urls, done, error) {
      const remaining = urls.filter(
        (u) =>
          ![
            "js/shapes-14-6-5.min.js",
            "js/stencils.min.js",
            "js/extensions.min.js",
          ].includes(u),
      );
      if (remaining.length) load.call(this, remaining, done, error);
      else done();
    };
    // Only the origin-checked workbench protocol is exposed; disable the upstream broad embed command handler.
    App.prototype.initializeEmbedMode = function () {};
    EditorUi.prototype.createShapesPanel = function () {};
    Sidebar.prototype.createMoreShapes = function () {
      return document.createElement("div");
    };
    Sidebar.prototype.init = function () {
      this.thumbWidth = 60;
      this.thumbHeight = 42;
      this.sidebarTitles = true;
      this.addPalette("workbench", "基础图形", true, (content) => {
        const entries = [
          ["矩形", "rounded=0;", 120, 60],
          ["圆角矩形", "rounded=1;", 120, 60],
          ["椭圆", "ellipse;", 110, 65],
          ["判断", "rhombus;", 110, 80],
          ["数据库", "shape=cylinder;", 95, 85],
          ["文本", "text;fillColor=none;strokeColor=none;", 120, 40],
          [
            "容器",
            "swimlane;horizontal=1;startSize=32;container=1;collapsible=0;",
            250,
            180,
          ],
        ];
        for (const [name, style, w, h] of entries)
          content.appendChild(
            this.createVertexTemplate(
              "whiteSpace=wrap;html=1;fontFamily=Noto Sans SC;fontSize=14;fillColor=#ffffff;strokeColor=#546c60;" +
                style,
              w,
              h,
              name,
              name,
              false,
              true,
            ),
          );
      });
    };
  }
  const methods = {
    collaborationMode: ({value, client}) => {
      graph.stopEditing(false);
      collaboration.active = !!value;
      collaboration.undo = []; collaboration.redo = [];
      collaboration.before = xmlData();
      // IDs are allocated locally and remain unique across tabs and offline edits.
      if (value) graph.model.prefix = 'co-' + client + '-';
      ui.editor.undoManager.clear();
      return snapshot();
    },
    collaborationApply: ({base, xml}) => {
      // Do not end IME composition, text editing or an active pointer gesture for remote sync.
      if (graph.isEditing() || graph.isMouseDown) return { deferred: true };
      const current = xmlData();
      const merged = mergeXml(base, current, xml);
      if (!equivalentXml(current, merged.xml)) replaceCollaborative(merged.xml);
      const result = snapshot();
      return {...result, dirty: !equivalentXml(result.xml, xml), conflicts: merged.conflicts};
    },
    setReadOnly: ({ value }) => { readOnly = !!value; graph.stopEditing(false); graph.setEnabled(!readOnly); document.body.classList.toggle("workbench-readonly", readOnly); return { readOnly }; },
    capabilities: () => ({ version: "1.0.0", kernel: "31.4.6" }),
    load: ({ xml }) => {
      loading = true;
      clearTimeout(notifyTimer);
      clearTimeout(maxTimer);
      try {
        ui.setCurrentFile(new LocalFile(ui, xml, "图稿.drawio"));
        ui.setFileData(xml);
        ui.setGraphEnabled(true);
        graph.setEnabled(!readOnly);
        ui.updateUi();
        graph.pageVisible = false;
        ui.editor.undoManager.clear();
        revision = 0;
        graph.clearSelection();
        graph.view.scaleAndTranslate(1, 0, 0);
        graph.refresh();
        ui.editor.setModified(false);
        ui.spinner.stop();
        if (ui.tabContainer) ui.tabContainer.style.display = "none";
        ui.refresh();
        ui.fitDiagramToWindow(1, new mxRectangle(35, 35, 35, 35));
        return snapshot();
      } finally {
        loading = false;
      }
    },
    beautify: () => {
      graph.stopEditing(false);
      graph.view.validate();
      const cells = Object.values(graph.model.cells);
      const chosen = graph.getSelectionCells();
      const selected = new Set(descendants(chosen).map(c=>c.id));
      const nodes = cells.filter(c=>c.vertex).map(c=>{
        const view = graph.view.getState(c);
        if(!view) return null;
        const ancestors=[];
        for(let p=c.parent;p;p=p.parent) ancestors.push(p.id);
        return {id:c.id,x:view.x,y:view.y,width:view.width,height:view.height,ancestors,locked:graph.isCellLocked(c),decoration:graph.getCellStyle(c).shape==='text'};
      }).filter(Boolean);
      const edges = cells.filter(c=>c.edge && (!chosen.length || selected.has(c.id) || (selected.has(c.source?.id)&&selected.has(c.target?.id)))).map(c=>({id:c.id,source:c.source?.id,target:c.target?.id,locked:graph.isCellLocked(c)}));
      const planned = DiagramBeautify.plan(nodes, edges);
      let count=0;
      graph.model.beginUpdate();
      try {
        for(const route of planned) {
          const cell=graph.model.getCell(route.id);
          const values={edgeStyle:'orthogonalEdgeStyle',curved:'0',rounded:'0',exitX:String(route.exitX),exitY:String(route.exitY),entryX:String(route.entryX),entryY:String(route.entryY),exitDx:'0',exitDy:'0',entryDx:'0',entryDy:'0',exitPerimeter:'1',entryPerimeter:'1'};
          const style=graph.getCellStyle(cell);
          const geom=cell.geometry;
          if(!geom?.points?.length && Object.entries(values).every(([k,v])=>String(style[k]??'')===v)) continue;
          for(const [key,value] of Object.entries(values)) graph.setCellStyles(key,value,[cell]);
          if(geom?.points?.length){const copy=geom.clone();copy.points=null;graph.model.setGeometry(cell,copy);}
          count++;
        }
      } finally {graph.model.endUpdate();}
      return {...snapshot(), beautified:count, examined:edges.length};
    },
    applyCandidate: ({xml,expectedRevision,documentId}) => {
      graph.stopEditing(false);
      if(revision!==expectedRevision || meta().documentId!==documentId) throw Error("当前图稿已变化，候选基线过期，请重新比较");
      const parsed=mxUtils.parseXml(xml);
      const element=parsed.getElementsByTagName('mxGraphModel')[0];
      if(!element || parsed.getElementsByTagName('diagram').length!==1)throw Error("候选画布无效");
      const model=new mxGraphModel();new mxCodec(parsed).decode(element,model);
      graph.clearSelection();
      // A complete candidate already defines edge parents and relative geometry.
      // mxGraphModel.add normally reparents edges to their lowest common ancestor.
      const maintainEdgeParent=graph.model.maintainEdgeParent;
      graph.model.maintainEdgeParent=false;graph.model.beginUpdate();
      try {
        graph.model.setValue(graph.model.root,model.root.value);
        for(const old of [...(graph.model.root.children||[])])graph.model.remove(old);
        for(const layer of [...(model.root.children||[])])graph.model.add(graph.model.root,layer);
      } finally {graph.model.maintainEdgeParent=maintainEdgeParent;graph.model.endUpdate();}
      return snapshot();
    },
    zoom: ({ action }) => {
      if (action === "fit") graph.fit(30);
      else graph.zoomTo(action === "reset" ? 1 : Math.min(4, Math.max(.1, graph.view.scale * (action === "in" ? 1.2 : 1/1.2))), true);
      if (graph.view.scale < .1 || graph.view.scale > 4) graph.zoomTo(Math.min(4,Math.max(.1,graph.view.scale)),true);
      return { scale: graph.view.scale };
    },
    panMode: ({ active }) => {
      setPanMode(active && !graph.isEditing());
      if (panHeld) graph.container.focus({ preventScroll: true });
      return { active: panHeld };
    },
    editing: () => ({ editing: graph.isEditing() }),
    snapshot: () => snapshot(),
    focus: ({ ids }) => {
      const cells = ids.map((id) => graph.model.getCell(id)).filter(Boolean);
      graph.setSelectionCells(cells);
      if (cells[0]) graph.scrollCellToVisible(cells[0], true);
      return snapshot();
    },
    review: ({ id, status }) => {
      graph.model.beginUpdate();
      try {
        const data = meta();
        const item = data.reviewItems.find((i) => i.id === id);
        if (!item) throw Error("核对项不存在");
        item.status = status;
        item.reviewedContentHash =
          status === "confirmed" && item.objectId
            ? content(graph.model.getCell(item.objectId))
            : undefined;
        writeMeta(data);
      } finally {
        graph.model.endUpdate();
      }
      return snapshot();
    },
    action: ({ name }) => {
      const allowed = [
        "undo",
        "redo",
        "delete",
        "copy",
        "paste",
        "cut",
        "duplicate",
        "selectAll",
        "group",
        "ungroup",
        "toFront",
        "toBack",
        "lockUnlock",
        "zoomIn",
        "zoomOut",
        "fitWindow",
        "actualSize",
      ];
      if (!allowed.includes(name)) throw Error("不支持的编辑命令");
      graph.stopEditing(false);
      const a = ui.actions.get(name);
      if (!a) throw Error("内核未提供该命令");
      a.funct();
      return snapshot();
    },
    preset: ({ name, all = false }) => {
      const t = DiagramThemes.find(t=>t.id===name)?.colors;
      if (!t) throw Error("未知预设");
      const cells = (
        all ? Object.values(graph.model.cells) : descendants(graph.getSelectionCells())
      ).filter((c) => (c.vertex || c.edge) && !graph.isCellLocked(c));
      graph.model.beginUpdate();
      try {
        for (const c of cells) {
          const style=graph.getCellStyle(c), plainText=style.shape==="text";
          if(!plainText && style.shape!=="image" && !graph.isSwimlane(c) && c.children?.length) continue;
          if(!plainText && style.shape!=="image") {
            graph.setCellStyles("fillColor", c.edge ? "none" : t[0], [c]);
            graph.setCellStyles("strokeColor", t[1], [c]);
          }
          graph.setCellStyles("fontColor", t[2], [c]);
          graph.setCellStyles("fontFamily", "Noto Sans SC", [c]);
        }
      } finally {
        graph.model.endUpdate();
      }
      return snapshot();
    },
    color: ({ key, value }) => {
      if(!["fillColor","strokeColor","fontColor"].includes(key)||!/^#[a-f0-9]{6}$|^none$/i.test(value))throw Error("颜色无效");
      graph.stopEditing(false);
      const cells=descendants(graph.getSelectionCells()).filter(c=>(c.vertex||c.edge)&&!graph.isCellLocked(c)&&(key!=="fillColor"||!c.edge));
      if(!cells.length)throw Error("请先选择可编辑对象");
      graph.model.beginUpdate();try{graph.setCellStyles(key,value,cells);}finally{graph.model.endUpdate();}
      return snapshot();
    },
    copyAppearance: () => {
      const c=graph.getSelectionCell();if(!c)throw Error("请先选择样式来源对象");
      const style=graph.getCellStyle(c);
      const keys=["fillColor","strokeColor","fontColor","fontSize","fontStyle","strokeWidth","dashed","dashPattern","opacity","fillOpacity","strokeOpacity","rounded","shadow","align","verticalAlign"];
      return { values:Object.fromEntries(keys.map(k=>[k,style[k]??null])), label:graph.convertValueToString(c) };
    },
    pasteAppearance: ({ values }) => {
      const keys=["fillColor","strokeColor","fontColor","fontSize","fontStyle","strokeWidth","dashed","dashPattern","opacity","fillOpacity","strokeOpacity","rounded","shadow","align","verticalAlign"];
      if(!values||Object.keys(values).some(k=>!keys.includes(k)))throw Error("样式无效");
      graph.stopEditing(false);
      const cells=graph.getSelectionCells().filter(c=>(c.vertex||c.edge)&&!graph.isCellLocked(c));
      if(!cells.length)throw Error("请先选择目标对象");
      graph.model.beginUpdate();try{for(const key of keys)graph.setCellStyles(key,values[key]??null,cells);}finally{graph.model.endUpdate();}
      return snapshot();
    },
    arrange: ({ action }) => {
      const cells=graph.getSelectionCells().filter(c=>c.vertex&&!graph.isCellLocked(c));
      if(new Set(cells.map(c=>c.parent)).size>1)throw Error("请选取同一容器中的对象进行排列");
      const align={left:mxConstants.ALIGN_LEFT,center:mxConstants.ALIGN_CENTER,right:mxConstants.ALIGN_RIGHT,top:mxConstants.ALIGN_TOP,middle:mxConstants.ALIGN_MIDDLE,bottom:mxConstants.ALIGN_BOTTOM};
      const distribute=action==="horizontal"||action==="vertical";
      if(cells.length<(distribute?3:2))throw Error(distribute?"等间距排列至少选择 3 个节点":"对齐至少选择 2 个节点");
      if(!distribute&&!align[action])throw Error("排列方式无效");
      graph.stopEditing(false);graph.model.beginUpdate();
      try{if(distribute)graph.distributeCells(action==="horizontal",cells);else graph.alignCells(align[action],cells);}finally{graph.model.endUpdate();}
      return snapshot();
    },
    deleteSelection: ({ mode }) => {
      graph.model.beginUpdate();
      try {
        if (mode === "ungroup") graph.ungroupCells(graph.getSelectionCells());
        else if (mode === "all")
          graph.removeCells(
            graph
              .getDeletableCells(graph.getSelectionCells())
              .filter((c) => !graph.isCellLocked(c)),
            true,
          );
        else throw Error("未知删除方式");
      } finally {
        graph.model.endUpdate();
      }
      return snapshot();
    },
    image: ({ data, width, height }) => {
      if (!/^data:image\/(png|jpeg);base64,/.test(data))
        throw Error("只支持 PNG/JPEG");
      graph.model.beginUpdate();
      try {
        const c = graph.insertVertex(
          graph.getDefaultParent(),
          null,
          "",
          40,
          40,
          Math.min(width, 240),
          (Math.min(width, 240) * height) / width,
          "shape=image;imageAspect=1;image=" +
            data.replace(";base64,", ",") +
            ";",
        );
        graph.setSelectionCell(c);
      } finally {
        graph.model.endUpdate();
      }
      return snapshot();
    },
    svg: ({ selection = [], background = "#ffffff", margin = 20 }) => {
      graph.stopEditing(false);
      const chosen = selection.length
        ? descendants(
            selection.map((id) => graph.model.getCell(id)).filter(Boolean),
          )
        : null;
      if (chosen && chosen.length === 0) throw Error("选区为空");
      if (!Object.values(graph.model.cells).some((c) => c.vertex || c.edge))
        throw Error("图稿为空");
      const old = graph.getSelectionCells();
      if (chosen) graph.setSelectionCells(chosen);
      try {
        const node = graph.getSvg(
          background === "transparent" ? null : background,
          1,
          margin,
          false,
          true,
          !chosen,
          true,
          null,
          null,
          true,
          false,
          null,
          null,
          chosen,
          true,
          true,
          false,
        );
        return {
          svg: mxUtils.getXml(node),
          width: parseFloat(node.getAttribute("width")),
          height: parseFloat(node.getAttribute("height")),
        };
      } finally {
        graph.setSelectionCells(old);
      }
    },
  };
  function ready(instance) {
    ui = instance;
    graph = ui.editor.graph;
    ui.editor.undoManager.size = 100;
    document.addEventListener("input", e => { if (!readOnly && e.target.closest?.(".mxCellEditor")) send({ event: "editing" }); });
    const viewport = () => send({ event: "viewport", scale: graph.view.scale });
    graph.view.addListener(mxEvent.SCALE, viewport);
    graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, viewport);
    graph.container.addEventListener("wheel", e => {
      if (graph.isEditing()) return;
      // Keep plain wheel/trackpad scrolling native; block upstream Space+wheel zoom.
      e.stopImmediatePropagation();
      if (!(e.metaKey || (!mxClient.IS_MAC && e.ctrlKey)) || !e.deltaY) return;
      e.preventDefault();
      const old = graph.view.scale, rect = graph.container.getBoundingClientRect();
      const x = e.clientX-rect.left, y = e.clientY-rect.top;
      const next = Math.min(4,Math.max(.1, old * Math.exp(-Math.max(-100,Math.min(100,e.deltaY * (e.deltaMode === 1 ? 16 : 1))) * .002)));
      const left = graph.container.scrollLeft, top = graph.container.scrollTop;
      const tx = graph.view.translate.x, ty = graph.view.translate.y;
      graph.zoomTo(next, false);
      graph.container.scrollLeft = (left+x-old*tx)/old*next+next*graph.view.translate.x-x;
      graph.container.scrollTop = (top+y-old*ty)/old*next+next*graph.view.translate.y-y;
    }, { passive:false, capture:true });
    graph.container.tabIndex = 0;
    const editableTarget = target => target instanceof Element &&
      (target.closest("input, textarea, select, [role=textbox], [role=dialog], .geDialog") || target.isContentEditable);
    document.addEventListener("keydown", e => {
      if (e.code !== "Space" || e.isComposing || graph.isEditing() || editableTarget(e.target)) return;
      // Do not activate toolbar buttons or scroll the browser when panning the canvas.
      e.preventDefault(); e.stopImmediatePropagation();
      setPanMode(true);
      ui.hoverIcons?.reset();
    }, true);
    document.addEventListener("keyup", e => {
      if (e.code !== "Space" || !panHeld) return;
      e.preventDefault(); e.stopImmediatePropagation();
      setPanMode(false);
    }, true);
    window.addEventListener("blur", () => setPanMode(false));
    document.addEventListener("visibilitychange", () => { if (document.hidden) setPanMode(false); });
    const forcePan = graph.panningHandler.isForcePanningEvent;
    graph.panningHandler.isForcePanningEvent = function(event) {
      return (panHeld && mxEvent.isLeftMouseButton(event.getEvent()) && !graph.isEditing()) || forcePan.apply(this, arguments);
    };
    graph.container.addEventListener("mousedown", e => {
      if (panHeld && e.button === 0) graph.container.classList.add("workbench-panning");
    }, true);
    document.addEventListener("mouseup", () => graph.container.classList.remove("workbench-panning"), true);
    graph.getStylesheet().getDefaultVertexStyle().fontFamily = "Noto Sans SC";
    graph.getStylesheet().getDefaultEdgeStyle().fontFamily = "Noto Sans SC";
    // Initialize toolbar defaults before a selection change can refer to empty icon URLs.
    ui.fireEvent(
      new mxEventObject("styleChanged", "cells", [], "keys", [], "values", []),
    );
    if (ui.tabContainer) {
      ui.tabContainer.style.display = "none";
      ui.tabContainerHeight = 0;
    }
    ui.refresh();
    graph.isCellRotatable = function () {
      return false;
    };
    graph.foldingEnabled = false;
    graph.setAllowDanglingEdges(false);
    graph.setDisconnectOnMove(false);
    // Structural/semantic changes invalidate a confirmation in the same edit, including undo/redo.
    graph.model.addListener(mxEvent.BEFORE_UNDO, () => {
      if (loading) return;
      const data = meta();
      if (!Array.isArray(data.reviewItems)) return;
      let dirty = false;
      const items = [];
      for (const item of data.reviewItems) {
        const c = item.objectId ? graph.model.getCell(item.objectId) : null;
        if (item.objectId && !c) {
          dirty = true;
          continue;
        }
        if (
          item.status === "confirmed" &&
          c &&
          item.reviewedContentHash !== content(c)
        ) {
          item.status = "needsReview";
          delete item.reviewedContentHash;
          dirty = true;
        }
        items.push(item);
      }
      if (dirty) {
        data.reviewItems = items;
        writeMeta(data);
      }
    });
    graph.model.addListener(mxEvent.CHANGE, () => {
      if (!loading) {
        revision++;
        if (collaboration.active) {
          const after = xmlData();
          collaboration.undo.push({before: collaboration.before, after});
          if (collaboration.undo.length > 100) collaboration.undo.shift();
          collaboration.redo = []; collaboration.before = after;
        }
        schedule();
      }
    });
    graph.getSelectionModel().addListener(mxEvent.CHANGE, () => {
      if (!loading)
        send({
          event: "selection",
          ids: graph.getSelectionCells().map((c) => c.id),
        });
    });
    for (const name of ['undo', 'redo']) {
      const action = ui.actions.get(name), original = action.funct;
      action.funct = function (...args) {
        if (collaboration.active) return collaborativeUndo(name === 'redo');
        return original.apply(this, args);
      };
      const enabled = action.isEnabled;
      action.isEnabled = function () {
        return collaboration.active ? !readOnly && collaboration[name].length > 0 : enabled.call(this);
      };
    }
    // Block native menu/keyboard editing as well as host commands in read-only mode.
    for (const action of Object.values(ui.actions.actions)) {
      const original = action.funct;
      action.funct = function (...args) { if (readOnly) return; return original.apply(this, args); };
    }
    const remove = ui.actions.get("delete");
    remove.funct = function () {
      if (readOnly) return;
      if (graph.getSelectionCells().some((c) => (c.children || []).length)) {
        send({ event: "deleteRequested" });
        return;
      }
      return methods.deleteSelection({ mode: "all" });
    };
    const save = ui.actions.get("save");
    if (save) save.funct = () => send({ event: "saveRequested" });
    if (ui.actions.get("saveAs"))
      ui.actions.get("saveAs").funct = () => send({ event: "saveRequested" });
    // Disable unsupported remote and multi-document actions; host owns file/import/export.
    [
      "new",
      "open",
      "import",
      "export",
      "exportAs",
      "editDiagram",
      "pageSetup",
      "plugins",
      "insertLink",
      "image",
      "insertImage",
      "editLink",
      "addImage",
      "insertTemplate",
      "mathematicalTypesetting",
      "formatPanel",
    ].forEach((n) => {
      const a = ui.actions.get(n);
      if (a && n !== "formatPanel") a.setEnabled(false);
    });
    window.onbeforeunload = null;
    window.workbench = {
      invoke: async (method, args = {}) => {
        if (!Object.prototype.hasOwnProperty.call(methods, method))
          throw Error("未知操作");
        if (readOnly && !["capabilities", "setReadOnly", "load", "collaborationMode", "collaborationApply", "editing", "snapshot", "zoom", "select", "focus", "find", "panMode", "svg", "copyAppearance"].includes(method)) throw Error("当前为只读，请先获取编辑权");
        return methods[method](args);
      },
    };
    // Keep host overlays inside the visible drawing area, clear of panels and scrollbars.
    const reportViewport = () => {
      const container = graph.container, rect = container.getBoundingClientRect();
      const sidebar = ui.sidebarContainer.getBoundingClientRect();
      send({event: "viewportBounds",
        sidebar: {left: sidebar.left, width: sidebar.height > 0 ? sidebar.width : 0, bottom: Math.max(0, innerHeight - sidebar.bottom)},
        right: Math.max(0, innerWidth - rect.left - container.clientLeft - container.clientWidth),
        bottom: Math.max(0, innerHeight - rect.top - container.clientTop - container.clientHeight)});
    };
    new ResizeObserver(reportViewport).observe(graph.container);
    window.addEventListener("resize", reportViewport);
    reportViewport();
    send({ event: "ready" });
  }
  addEventListener("message", async (event) => {
    if (
      event.source !== parent ||
      event.origin !== parentOrigin ||
      event.data?.channel !== "diagram-workbench" ||
      !ui
    )
      return;
    const { id, method, args } = event.data;
    if (typeof id !== "string" || id.length > 100) return;
    try {
      const result = await window.workbench.invoke(method, args);
      send({ id, result });
    } catch (e) {
      send({ id, error: String(e.message || e) });
    }
  });
  window.checkAllLoaded = function () {
    if (mxScriptsLoaded && mxWinLoaded && !App.isMainCalled) {
      configure();
      App.main(ready);
    }
  };
  addEventListener("load", () => {
    mxWinLoaded = true;
    checkAllLoaded();
  });
})();
