import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { CalendarDays, Check, Filter, Focus, Link2, Maximize2, Minus, Move, Palette, Plus, Search, X } from "lucide-react";
import { entityTypes, type EntityRecord, type EntityType, type RecordRef } from "@diary/contracts";
import { shortDate } from "./date";
import { api, type ActionRow } from "./api";

import { buildGraph, defaultView, type GraphNode, type GraphEdge } from "./graphModel";
import { edgeAppearance } from "./graphData";
import { placeGraphLabels } from "./graphLabels";
import { useMemberInk } from "./useMemberInk";
import { InkOcean } from "./InkOcean";
import { memberInkScene } from "./memberInkScene";
import { inkBlooms } from "./inkBlooms";
import { defaultInkColors, INK_COLOR_KEY, readInkColors, regionInkColor } from "./inkColors";
import "./ink-ocean.css";
export { buildGraph } from "./graphModel";
const TYPE_LABEL: Record<EntityType, string> = { person: "人物", place: "地点", activity: "活动", food: "食物", thing: "事物" };
const nodeTypeLabel = (kind: GraphNode["kind"]) => kind === 'todo' ? '待办行动' : kind === 'record' ? '来源记录' : kind === "event" ? "事实事件" : kind === "date" ? "日记" : kind === "self" ? "日记主人" : TYPE_LABEL[kind];

type RelationGraphProps = {
  entities: EntityRecord[];
  selected: EntityRecord | null;
  onSelect: (entity: EntityRecord) => void;
  onOpenDate: (date: string) => void;
  onOpenRecord?: (ref: RecordRef) => void;
};

export function RelationGraph({ entities: sourceEntities, selected, onSelect, onOpenDate, onOpenRecord }: RelationGraphProps) {
  const [entities, setEntities] = useState(sourceEntities);
  useEffect(() => { setEntities(sourceEntities); }, [sourceEntities]);
  const [viewport, setViewport] = useState({ width: 1000, height: 640 });
  const { width: WIDTH, height: HEIGHT } = viewport;
  const [actions, setActions] = useState<{ tasks: ActionRow[]; records: RecordRef[] }>();
  const [showActions, setShowActions] = useState(false);
  useEffect(() => { let cancelled = false; void api.actions().then(data => { if (!cancelled) setActions(data); }).catch(() => {}); return () => { cancelled = true; }; }, [entities]);
  const [query, setQuery] = useState("");
  const [enabledTypes, setEnabledTypes] = useState<EntityType[]>(["person", "place", "activity", "food"]);
  const [showDates, setShowDates] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [graphMode, setGraphMode] = useState<"relation" | "event">("relation");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [inkColors, setInkColors] = useState(readInkColors);
  const [colorError, setColorError] = useState("");
  useEffect(() => {
    try { localStorage.setItem(INK_COLOR_KEY, JSON.stringify(inkColors)); setColorError(""); }
    catch { setColorError("当前浏览器无法保存配色；本次修改仍可预览。"); }
  }, [inkColors]);
  const [selectedId, setSelectedId] = useState<string | null>(selected?.key || null);
  const [view, setView] = useState(defaultView);
  const model = useMemo(() => buildGraph(entities, enabledTypes, showDates, showActions ? actions : undefined, showEvents, graphMode, viewport), [entities, enabledTypes, showDates, showActions, actions, showEvents, graphMode, viewport]);
  const bloomMembers = useMemo(() => memberInkScene(entities,model),[entities,model]);
  const [nodes, setNodes] = useState(model.nodes);
  const liveNodes = useRef(nodes);
  const svgRef = useRef<SVGSVGElement>(null);
  const liquid = useMemberInk(entities, model, nodes, svgRef, WIDTH);
  useEffect(() => {
    if (!svgRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width), height = Math.round(entry.contentRect.height);
      if (width < 100 || height < 100) return;
      setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setView(defaultView()); }, [viewport]);
  const gesture = useRef<{ mode: "pan" | "drag"; pointerId: number; lastX: number; lastY: number; nodeId?: string; moved: boolean; dragged?: Array<{ node: GraphNode; element: SVGGElement | undefined }>; links?: Array<{ lines: SVGLineElement[]; source: GraphNode; target: GraphNode }> } | null>(null);

  useEffect(() => { setNodes(model.nodes); }, [model]);
  useEffect(() => { if (selected) setSelectedId(selected.key); }, [selected]);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const blooms = useMemo(() => inkBlooms(bloomMembers,nodeById,WIDTH),[bloomMembers,nodeById,WIDTH]);
  const selectedNode = selectedId ? nodeById.get(selectedId) : undefined;
  const selectedEntity = selectedNode?.entity;
  const selectedDate = selectedNode?.date;
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const matches = new Set(nodes.filter((node) => normalizedQuery && node.label.toLocaleLowerCase("zh-CN").includes(normalizedQuery)).map((node) => node.id));
  const neighbors = new Set<string>();
  const highlightedId = draggedId || hoveredId || focusedId || (selectedNode ? selectedId : null);
  const visibleLabels = new Set(nodes.filter(node => node.kind === "self" || node.kind === "place" || !node.entity || (node.eventCount || 0) >= 2 || draggedId === node.id || hoveredId === node.id || focusedId === node.id || selectedId === node.id || matches.has(node.id)).map(node => node.id));
  const labelPositions = placeGraphLabels(nodes, visibleLabels, highlightedId);
  const descendants = new Set(model.regions.filter(region => highlightedId && region.ancestorIds?.includes(highlightedId)).map(region => region.id));
  descendants.forEach(id => neighbors.add(id));
  if (highlightedId) for (const edge of model.edges) {
    if (edge.source === highlightedId) neighbors.add(edge.target);
    if (edge.target === highlightedId) neighbors.add(edge.source);
    if (descendants.has(edge.source)) neighbors.add(edge.target);
    if (descendants.has(edge.target)) neighbors.add(edge.source);
  }

  const svgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint(); point.x = clientX; point.y = clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: transformed.x, y: transformed.y };
  };

  const selectNode = (node: GraphNode) => {
    setSelectedId(node.id);
    if (node.entity) onSelect(node.entity);
  };

  const activateNode = (node: GraphNode) => {
    if (selectedId === node.id && node.reference && onOpenRecord) onOpenRecord(node.reference);
    else if (selectedId === node.id && node.date) onOpenDate(node.date);
    else selectNode(node);
  };

  const startPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const point = svgPoint(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { mode: "pan", pointerId: event.pointerId, lastX: point.x, lastY: point.y, moved: false };
  };

  const startDrag = (event: ReactPointerEvent<SVGGElement>, node: GraphNode) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    liquid.begin(node.id);
    setDraggedId(node.id);
    const point = svgPoint(event.clientX, event.clientY);
    svgRef.current?.setPointerCapture(event.pointerId);
    liveNodes.current = nodes.map(item => ({ ...item }));
    const draggedIds = new Set([node.id]);
    const elements = new Map([...svgRef.current!.querySelectorAll<SVGGElement>(".graph-node")].map(element => [element.dataset.nodeId, element]));
    const edgeElements = new Map([...svgRef.current!.querySelectorAll<SVGGElement>(".graph-link")].map(element => [element.dataset.edgeId, element]));
    const byId = new Map(liveNodes.current.map(item => [item.id, item]));
    const dragged = liveNodes.current.filter(item => draggedIds.has(item.id)).map(item => ({ node: item, element: elements.get(item.id) }));
    const links = model.edges.filter(edge => draggedIds.has(edge.source) || draggedIds.has(edge.target)).map(edge => ({ lines: [...(edgeElements.get(edge.id)?.querySelectorAll<SVGLineElement>("line") || [])], source: byId.get(edge.source)!, target: byId.get(edge.target)! }));
    gesture.current = { mode: "drag", pointerId: event.pointerId, lastX: point.x, lastY: point.y, nodeId: node.id, moved: false, dragged, links };
  };

  const movePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const point = svgPoint(event.clientX, event.clientY);
    const dx = point.x - current.lastX; const dy = point.y - current.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 1) current.moved = true;
    if (current.mode === "pan") setView((value) => ({ ...value, x: value.x + dx, y: value.y + dy }));
    else if (current.nodeId) {
      for (const item of current.dragged || []) {
        item.node.x += dx / view.scale; item.node.y += dy / view.scale;
        item.element?.setAttribute("transform", `translate(${item.node.x} ${item.node.y})`);
      }
      for (const link of current.links || []) for (const line of link.lines) {
        line.setAttribute("x1", String(link.source.x)); line.setAttribute("y1", String(link.source.y));
        line.setAttribute("x2", String(link.target.x)); line.setAttribute("y2", String(link.target.y));
      }
      liquid.move((current.dragged || []).map(item => ({ id: item.node.id, x: item.node.x, y: item.node.y })));
    }
    current.lastX = point.x; current.lastY = point.y;
  };

  const endPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = gesture.current;
    if (current?.nodeId) liquid.end(current.nodeId);
    setDraggedId(null);
    if (current?.mode === "drag" && current.moved) setNodes([...liveNodes.current]);
    if (event.type !== "pointercancel" && current?.pointerId === event.pointerId && !current.moved) {
      const node = current.nodeId ? nodeById.get(current.nodeId) : undefined;
      if (node) activateNode(node);
      else {
        const point=svgPoint(event.clientX,event.clientY);
        const x=(point.x-view.x)/view.scale,y=(point.y-view.y)/view.scale;
        const hit=inkBlooms(bloomMembers,nodeById,WIDTH).map(bloom=>{
          const dx=x-bloom.x,dy=y-bloom.y,c=Math.cos(bloom.angle),s=Math.sin(bloom.angle);
          const distance=((dx*c+dy*s)/bloom.rx)**2+((-dx*s+dy*c)/bloom.ry)**2;
          return {id:bloom.id,strength:distance<.8?(1-distance)*bloom.opacity:0};
        }).sort((a,b)=>b.strength-a.strength)[0];
        const anchor=hit && hit.strength>.08 ? nodeById.get(hit.id) : undefined;
        if(anchor) selectNode(anchor); else setSelectedId(null);
      }
    }
    if (gesture.current?.pointerId === event.pointerId) gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const zoomAt = (nextScale: number, anchor = { x: WIDTH / 2, y: HEIGHT / 2 }) => setView((current) => {
    const scale = Math.max(.45, Math.min(4.5, nextScale));
    const worldX = (anchor.x - current.x) / current.scale; const worldY = (anchor.y - current.y) / current.scale;
    return { scale, x: anchor.x - worldX * scale, y: anchor.y - worldY * scale };
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = svgPoint(event.clientX, event.clientY);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? HEIGHT : 1);
      zoomAt(view.scale * Math.exp(-delta * .0014), point);
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [view.scale]);

  const toggleType = (type: EntityType) => setEnabledTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  const activeEdge = (edge: GraphEdge) => Boolean(highlightedId && (edge.source === highlightedId || edge.target === highlightedId || descendants.has(edge.source) || descendants.has(edge.target)));
  const clipId = (id: string) => `place-clip-${encodeURIComponent(id).replace(/%/g, "_")}`;
  const fitCanvas = () => {
    const bounds = nodes.map(node => ({ left: node.x - 35, right: node.x + Math.max(35, node.label.length * 7 + 25), top: node.y - 30, bottom: node.y + 30 }));
    for (const mapBounds of liquid.bounds.current.values()) bounds.push(mapBounds);
    if (!bounds.length) { setView(defaultView()); return; }
    const left = Math.min(...bounds.map(b => b.left)), right = Math.max(...bounds.map(b => b.right));
    const top = Math.min(...bounds.map(b => b.top)), bottom = Math.max(...bounds.map(b => b.bottom));
    const toolbar = window.matchMedia("(max-width: 899px)").matches ? 125 : 80;
    const scale = Math.max(.45, Math.min(1.4, (WIDTH - 32) / Math.max(1, right - left), (HEIGHT - toolbar - 40) / Math.max(1, bottom - top)));
    setView({ scale, x: WIDTH / 2 - (left + right) / 2 * scale, y: toolbar + (HEIGHT - toolbar - 25) / 2 - (top + bottom) / 2 * scale });
  };

  return <section className="panel-section graph-section" aria-labelledby="lookup-title">
    <div className="section-heading graph-heading"><div><Link2 /><div><h2 id="lookup-title">关系图谱</h2><p>节点撑起地点墨面，拖动向外扩张，松手自然收圆。</p></div></div><span className="graph-count">{nodes.length} 个节点 · {model.edges.length} 条关系</span></div>
    {normalizedQuery && <div className="graph-result-buttons" aria-label="搜索结果">{nodes.filter((node) => matches.has(node.id)).map((node) => <button type="button" key={node.id} onClick={() => { selectNode(node); setQuery(""); setView((current) => ({ ...current, x: WIDTH / 2 - node.x * current.scale, y: HEIGHT / 2 - node.y * current.scale })); }}>{node.label}<small>{nodeTypeLabel(node.kind)}</small></button>)}</div>}
    <div className="graph-frame">
      
      <div className="graph-toolbar">
        <label className="graph-search"><Search size={18} /><span className="sr-only">搜索图谱节点</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={graphMode === "event" ? "搜索事件" : "搜索实体名称"} />{query && <button type="button" onClick={() => setQuery("")} aria-label="清除搜索"><X size={16} /></button>}</label>
        <div className="graph-actions" aria-label="图谱工具">
          <button type="button" onClick={() => zoomAt(view.scale * 1.2)} aria-label="放大图谱"><Plus /></button>
          <button type="button" onClick={() => zoomAt(view.scale / 1.2)} aria-label="缩小图谱"><Minus /></button>
          <button type="button" onClick={fitCanvas} aria-label="适应画布"><Maximize2 /></button>
          <button type="button" className={showColors ? "active" : ""} onClick={() => { setShowColors(value => !value); setShowFilters(false); }} aria-expanded={showColors} aria-label="地图配色"><Palette /></button>
          <button type="button" className={showFilters ? "active" : ""} onClick={() => { setShowFilters((value) => !value); setShowColors(false); }} aria-expanded={showFilters} aria-label="筛选图谱"><Filter /></button>
        </div>
      </div>
      {showColors && <section className="ink-color-panel" aria-label="地图配色" onKeyDown={event => { if (event.key === "Escape") { setShowColors(false); event.stopPropagation(); } }}>
        <header><strong>墨滴配色</strong><button type="button" aria-label="关闭配色" onClick={() => setShowColors(false)}><X size={18} /></button></header>
        <p>选择主色，墨色浓淡会随水流变化。配色保存在此浏览器。</p>
        <label><span>纯色背景</span><input type="color" aria-label="背景颜色" value={inkColors.sea} onChange={event => setInkColors(value => ({ ...value, sea: event.target.value }))} /></label>
        <div className="ink-place-colors">{model.regions.map(region => <label key={region.id}><span>{region.parentId ? "↳ " : ""}{region.label}</span><input type="color" aria-label={`${region.label}颜色`} value={regionInkColor(region, model.regions, inkColors)} onChange={event => setInkColors(value => ({ ...value, places: { ...value.places, [region.id]: event.target.value } }))} /></label>)}</div>
        {colorError && <p role="status">{colorError}</p>}
        <button type="button" className="quiet-button" onClick={() => setInkColors(defaultInkColors())}>恢复默认配色</button>
      </section>}
      {showFilters && <div className="graph-filter-panel"><div className="graph-mode-switch" role="tablist" aria-label="图谱模式"><button type="button" role="tab" aria-selected={graphMode === "relation"} className={graphMode === "relation" ? "active" : ""} onClick={() => { setGraphMode("relation"); setSelectedId(null); }}>实体关系</button><button type="button" role="tab" aria-selected={graphMode === "event"} className={graphMode === "event" ? "active" : ""} onClick={() => { setGraphMode("event"); setSelectedId(null); }}>事件图谱</button></div><strong>显示节点</strong><div>{entityTypes.map((type) => <button type="button" key={type} className={enabledTypes.includes(type) ? "active" : ""} aria-pressed={enabledTypes.includes(type)} onClick={() => toggleType(type)}><span className={`legend-dot node-${type}`} />{TYPE_LABEL[type]}{enabledTypes.includes(type) && <Check />}</button>)}<button type="button" className={showDates ? "active" : ""} aria-pressed={showDates} onClick={() => setShowDates((value) => !value)}><span className="legend-dot node-date" />日记{showDates && <Check />}</button><button type="button" className={showEvents ? "active" : ""} aria-pressed={showEvents} onClick={() => setShowEvents((value) => !value)}><span className="legend-dot node-event" />显示事件节点{showEvents && <Check />}</button><button type="button" className={showActions ? "active" : ""} aria-pressed={showActions} onClick={() => setShowActions(value => !value)}>行动关联{showActions && <Check />}</button></div></div>}
      <div className={`graph-canvas-wrap${graphMode === "relation" ? " ink-ocean-scene" : ""}`} style={{ "--sea-color": inkColors.sea === defaultInkColors().sea ? "var(--surface-2)" : inkColors.sea } as CSSProperties}>
        {graphMode === "relation" && <InkOcean svg={svgRef} regions={model.regions} members={bloomMembers} colors={inkColors} width={WIDTH} height={HEIGHT} view={view} />}
        <svg ref={svgRef} className="graph-canvas" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" tabIndex={0} aria-label="日记关系图谱，可拖动节点和画布，滚轮缩放" onPointerDown={startPan} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer} onKeyDown={(event) => { const delta = event.shiftKey ? 100 : 30; if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "Escape"].includes(event.key)) { event.preventDefault(); if (event.key === "Escape") setSelectedId(null); else if (event.key === "+" || event.key === "=") zoomAt(view.scale * 1.2); else if (event.key === "-") zoomAt(view.scale / 1.2); else setView((v) => ({ ...v, x: v.x + (event.key === "ArrowLeft" ? delta : event.key === "ArrowRight" ? -delta : 0), y: v.y + (event.key === "ArrowUp" ? delta : event.key === "ArrowDown" ? -delta : 0) })); } }}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {graphMode === "relation" && <g className="ink-bloom-fallback" aria-hidden="true">{blooms.map(bloom => {
              const region=model.regions.find(region=>region.id===bloom.id)!;
              const id=`bloom-${encodeURIComponent(bloom.id).replace(/%/g,"_")}`;
              const color=regionInkColor(region,model.regions,inkColors);
              return <g key={bloom.id}><defs><radialGradient id={id}><stop offset="0" stopColor={color} stopOpacity={Math.min(.85,bloom.opacity*1.4)} /><stop offset=".45" stopColor={color} stopOpacity={bloom.opacity} /><stop offset="1" stopColor={color} stopOpacity="0" /></radialGradient></defs><ellipse cx={bloom.x} cy={bloom.y} rx={bloom.rx} ry={bloom.ry} transform={`rotate(${bloom.angle*180/Math.PI} ${bloom.x} ${bloom.y})`} fill={`url(#${id})`} /></g>;
            })}</g>}
            <defs>{model.regions.map(region => <clipPath key={region.id} id={clipId(region.id)} clipPathUnits="userSpaceOnUse"><path data-ink-region={region.id} d="" clipRule="evenodd" /></clipPath>)}</defs>
            <g className="graph-regions">{model.regions.map(region => {
              const anchor = nodeById.get(region.id);
              const dimmed = Boolean(highlightedId && highlightedId !== region.id && !neighbors.has(region.id));
              let painted = <g key={region.id} className={`graph-region${region.neutral ? " neutral" : ""}${region.childIds?.length ? " parent-region" : ""}${region.parentId ? " child-region" : ""}${highlightedId === region.id ? " active" : ""}${dimmed ? " dimmed" : ""}`} style={{ "--ink-hue": region.hue, "--ink-tone": region.tone ?? 0, "--pigment-color": regionInkColor(region, model.regions, inkColors) } as CSSProperties}>
                <path className="graph-ink" data-ink-region={region.id} d="" onPointerDown={anchor ? event => startDrag(event, anchor) : undefined} onPointerEnter={anchor ? () => setHoveredId(region.id) : undefined} onPointerLeave={() => setHoveredId(null)} />
                <path className="graph-ink-sheen" data-ink-region={region.id} d="" aria-hidden="true" />
                <g className="graph-ink-drops" data-ink-drops={region.id} aria-hidden="true" />
                {region.neutral && <text className="graph-region-neutral-label" x={region.x} y={region.y + 25} textAnchor="middle">未标注地点 · {region.count} 次</text>}
              </g>;
              for (const ancestor of [...(region.ancestorIds || [])].reverse()) painted = <g key={region.id} clipPath={`url(#${clipId(ancestor)})`}>{painted}</g>;
              return painted;
            })}</g>
            <g>{model.edges.map((edge) => {
              const source = nodeById.get(edge.source); const target = nodeById.get(edge.target);
              if (!source || !target) return null;
              const dimmed = Boolean(highlightedId && !activeEdge(edge));
              const appearance = edgeAppearance(edge.count, edge.kind !== "event");
              const label = graphMode === "event" ? `共享 ${edge.count} 个实体` : edge.kind === "event" ? `共同出现于 ${edge.count} 个事件` : edge.kind === "self" ? `记录 ${edge.count} 个事件` : "来源记录关联";
              return <g key={edge.id} className="graph-link" data-edge-id={edge.id}><line aria-hidden="true" className={`graph-edge graph-edge-${edge.kind}${activeEdge(edge) ? " active" : ""}${dimmed ? " dimmed" : ""}`} style={{ "--edge-opacity": appearance.opacity, "--edge-width": appearance.width, "--edge-strength": `${Math.round(appearance.strength * 100)}%` } as CSSProperties} x1={source.x} y1={source.y} x2={target.x} y2={target.y} /><line className="graph-edge-hit" x1={source.x} y1={source.y} x2={target.x} y2={target.y}><title>{source.label} — {target.label}：{label}</title></line></g>;
            })}</g>
            {nodes.map((node) => {
              const isSelected = selectedId === node.id; const isMatch = matches.has(node.id); const isNeighbor = neighbors.has(node.id);
              const dimmed = Boolean((highlightedId && highlightedId !== node.id && !isNeighbor) || (normalizedQuery && !isMatch));
              const showLabel = visibleLabels.has(node.id);
              const labelPosition = labelPositions.get(node.id);
              return <g key={node.id} data-node-id={node.id} role="button" tabIndex={0} aria-label={`${node.label}，${nodeTypeLabel(node.kind)}${node.entity ? `，出现 ${node.eventCount || 0} 次，跨 ${node.entity.mentions.length} 天` : ""}`} aria-pressed={isSelected} className={`graph-node node-${node.kind}${isSelected ? " selected" : ""}${isMatch ? " match" : ""}${dimmed ? " dimmed" : ""}`} transform={`translate(${node.x} ${node.y})`} onFocus={() => setFocusedId(node.id)} onBlur={() => setFocusedId(null)} onPointerEnter={() => setHoveredId(node.id)} onPointerLeave={() => setHoveredId(null)} onPointerDown={(event) => startDrag(event, node)} onContextMenu={(event) => { event.preventDefault(); selectNode(node); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!event.repeat) activateNode(node); } }}>
                {node.kind === "place" ? <><rect className="graph-hit-area" x={-Math.max(38, node.label.length * 7 + 8)} y={-22} width={Math.max(76, node.label.length * 14 + 16)} height={44} rx={7} /><rect className="graph-place-anchor" x={-Math.max(38, node.label.length * 7 + 8)} y={-18} width={Math.max(76, node.label.length * 14 + 16)} height={36} rx={7} /></> : <><circle className="graph-hit-area" r={26} /><circle r={node.radius + (isSelected ? 3 : 0)} /></>}
                {showLabel && <text textAnchor={node.kind === "place" ? "middle" : labelPosition?.textAnchor} x={node.kind === "place" ? 0 : labelPosition?.x} y={node.kind === "place" ? -3 : labelPosition?.y}>{node.kind === "event" && node.label.length > 25 ? `${node.label.slice(0, 25)}…` : node.label}</text>}{node.kind === "place" && <text className="graph-place-count" textAnchor="middle" y={14}>{node.eventCount || 0} 个事件</text>}<title>{node.label}</title>
              </g>;
            })}
          </g>
        </svg>
        {!nodes.some(node => node.kind !== "self") && <div className="graph-empty"><Link2 /><strong>{graphMode === "event" ? "还没有事件记录" : '"我"已经在图谱中心'}</strong><span>{graphMode === "event" ? "记录事件后，它们会按照共享的人物、地点或活动建立连接。" : "记录人物、地点、活动或食物后，这里会铺开你的关系地图。"}</span></div>}
        <div className="graph-hint"><Move />拖动 · 滚轮缩放</div>
        {normalizedQuery && <div className="graph-search-count" role="status">找到 {matches.size} 个节点</div>}
      </div>
      {liquid.error && <p role="alert">{liquid.error}</p>}
      {graphMode === "event" ? <div className="graph-legend" aria-label="图谱图例"><span><i className="edge-event" />共享实体（线越深=共享的人/地/事越多）</span></div> : <div className="graph-legend" aria-label="图谱图例"><span><i className="edge-self" />我记录的实体</span><span><i className="edge-event" />共同出现（线越深=次数越多）</span><span><i className="legend-ink" />墨迹越大，地点事件越多</span></div>}
      {selectedNode && <aside className="graph-inspector" aria-label="节点详情">
        {selectedNode.reference && <button className="quiet-button" onClick={() => onOpenRecord?.(selectedNode.reference!)}>打开这条记录</button>}
        <button type="button" className="inspector-close" onClick={() => setSelectedId(null)} aria-label="关闭节点详情"><X /></button>
        <div className="inspector-title"><span className={`inspector-mark node-${selectedNode.kind}`}>{selectedNode.kind === "date" ? <CalendarDays /> : <Focus />}</span><div><strong>{selectedNode.label}</strong><small>{nodeTypeLabel(selectedNode.kind)}</small></div></div>
        {selectedEntity && <><p className="date-node-copy">{selectedNode.eventCount || 0} 个事件 · {selectedEntity.mentions.length} 天</p>
          {selectedEntity.type === "place" && <PlaceParentEditor key={`${selectedEntity.key}|${selectedEntity.parentKey || ""}`} entity={selectedEntity} entities={entities} onSaved={setEntities} />}
          {selectedEntity.tags.length > 0 && <div className="inspector-tags">{selectedEntity.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
          <GraphGroup title="点击日期查看日记" items={selectedEntity.mentions.map((date) => ({ id: date, label: shortDate(date), meta: date, action: () => onOpenDate(date) }))} />
          <GraphGroup title="来源事件" items={(selectedEntity.occurrences || []).map((event) => ({ id: event.key, label: event.note, meta: `${event.date} ${event.time}`, action: () => onOpenDate(event.date) }))} />
        </>}
        {selectedDate && <><p className="date-node-copy">{selectedNode.kind === "event" ? "连线仅表示这条事件明确记录的实体，不推断实体之间的关系。" : "日期仅用于归档，不表示同一天的事件彼此相关。"}</p><button type="button" className="open-diary-button" onClick={() => onOpenDate(selectedDate)}><CalendarDays />打开 {selectedDate} 的日记</button></>}
        {selectedNode.kind === "self" && <p className="date-node-copy">这是你的中心节点，淡线连接你记录过的实体。实体间的深色连线表示同一事件中的共同出现，次数越多，线越深。地点墨迹面积表示在那里发生的事件数量。</p>}
      </aside>}
    </div>
  </section>;
}

function GraphGroup({ title, items }: { title: string; items: Array<{ id: string; label: string; meta: string; action: () => void }> }) {
  return <div className="graph-detail-group"><h3>{title}</h3>{items.length ? <div>{items.slice(0, 12).map((item) => <button type="button" key={item.id} onClick={item.action}><span>{item.label}</span><small>{item.meta}</small></button>)}</div> : <p>暂无</p>}</div>;
}
function PlaceParentEditor({ entity, entities, onSaved }: { entity: EntityRecord; entities: EntityRecord[]; onSaved: (entities: EntityRecord[]) => void }) {
  const [parent, setParent] = useState(entity.parentKey || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const places = entities.filter(item => item.type === "place");
  const eligible = places.filter(item => {
    const visited = new Set([entity.key]);
    let candidate: EntityRecord | undefined = item;
    while (candidate) {
      if (visited.has(candidate.key)) return false;
      visited.add(candidate.key);
      candidate = places.find(place => place.key === candidate!.parentKey);
    }
    return true;
  });
  const children = places.filter(place => place.parentKey === entity.key);
  return <div className="place-parent-editor">
    <label>所属地点<select value={parent} onChange={event => setParent(event.target.value)} disabled={saving}>
      <option value="">独立地点（无上级）</option>
      {eligible.map(place => <option key={place.key} value={place.key}>{place.name}</option>)}
    </select></label>
    <button type="button" className="quiet-button" disabled={saving || parent === (entity.parentKey || "")} onClick={async () => {
      setSaving(true); setError("");
      try { const response = await api.setPlaceParent(entity.key, parent || null); onSaved(response.entities); }
      catch (error) { setError(error instanceof Error ? error.message : "保存失败，请重试"); }
      finally { setSaving(false); }
    }}>{saving ? "保存中…" : "保存所属关系"}</button>
    {children.length > 0 && <p>包含：{children.map(place => place.name).join("、")}。上方次数含所有下级地点，同一事件只计一次。</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
