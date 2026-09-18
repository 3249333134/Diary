import { useEffect, useRef, useState, type RefObject } from "react";
import type { EntityRecord } from "@diary/contracts";
import type { GraphModel, GraphNode } from "./graphModel";
import { memberInkScene } from "./memberInkScene";
import type { InkBounds, InkContour, InkDrop } from "./memberInk";

export function useMemberInk(entities: EntityRecord[], model: GraphModel, nodes: GraphNode[], svg: RefObject<SVGSVGElement | null>, width: number) {
  const workerRef = useRef<Worker | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const bounds = useRef(new Map<string, InkBounds>());
  const [error, setError] = useState("");
  useEffect(() => {
    setError(""); bounds.current.clear();
    positions.current = new Map(model.nodes.map(node => [node.id, { x: node.x, y: node.y }]));
    const root = svg.current;
    if (!root || !model.regions.length) return;
    let worker: Worker;
    try { worker = new Worker(new URL("./memberInk.worker.ts", import.meta.url), { type: "module" }); }
    catch { setError("墨面模拟无法启动，请刷新页面重试。"); return; }
    workerRef.current = worker;
    root.dataset.inkReady = "false";
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const paths = new Map<string, SVGPathElement[]>();
    for (const path of root.querySelectorAll<SVGPathElement>("path[data-ink-region]")) {
      const id = path.dataset.inkRegion!; paths.set(id, [...(paths.get(id) || []), path]);
    }
    const pending = new Map<string, InkContour>();
    let drops: InkDrop[] = [], energy = 0;
    let frame = 0, lastPaint = 0, slowPaints = 0, lastBudget = 0;
    const paint = () => {
      frame = 0;
      const now = performance.now();
      if (root.dataset.inkActive === "true" && pending.size && lastPaint && now-lastPaint > (width < 600 ? 43 : 27)) slowPaints++;
      else slowPaints = Math.max(0, slowPaints-1);
      if (slowPaints >= 3 && now-lastBudget > 500) { worker.postMessage({ type: "budget" }); lastBudget=now; slowPaints=0; }
      lastPaint = now;
      for (const item of pending.values()) {
        for (const path of paths.get(item.id) || []) if (path.getAttribute("d") !== item.path) path.setAttribute("d", item.path);
        bounds.current.set(item.id, item.bounds);
      }
      pending.clear(); root.dataset.inkReady = "true";
      for (const group of root.querySelectorAll<SVGGElement>("[data-ink-drops]")) {
        const matching = drops.filter(drop => drop.region === group.dataset.inkDrops);
        while (group.children.length > matching.length) group.lastElementChild?.remove();
        matching.forEach((drop, index) => {
          let circle = group.children[index];
          if (!circle) { circle = document.createElementNS("http://www.w3.org/2000/svg", "circle"); group.appendChild(circle); }
          circle.setAttribute("cx", String(drop.x)); circle.setAttribute("cy", String(drop.y));
          circle.setAttribute("r", String(drop.radius * Math.min(1, drop.life * 6)));
          circle.setAttribute("opacity", String(Math.min(.7, drop.life * 2)));
        });
      }
      root.style.setProperty("--ink-motion", String(Math.min(1, energy / 350)));
    };
    worker.onmessage = (event: MessageEvent<{ contours: InkContour[]; drops: InkDrop[]; energy: number; active: boolean; elapsed: number; cell: number; quality: number }>) => {
      drops = event.data.drops; energy = event.data.energy;
      for (const item of event.data.contours) pending.set(item.id, item);
      root.dataset.inkActive = String(event.data.active);
      root.dataset.inkFrameMs = event.data.elapsed.toFixed(2);
      root.dataset.inkCell = String(event.data.cell);
      root.dataset.inkQuality = String(event.data.quality);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    worker.onerror = () => { setError("墨面模拟暂时中断，请刷新页面恢复；日记数据不受影响。"); worker.terminate(); workerRef.current = null; };
    const visibility = () => worker.postMessage({ type: "pause", paused: document.hidden });
    const reduce = () => worker.postMessage({ type: "reduce", reduced: reduced.matches });
    document.addEventListener("visibilitychange", visibility); reduced.addEventListener("change", reduce);
    worker.postMessage({ type: "init", regions: memberInkScene(entities, model), mobile: width < 600, reduced: reduced.matches });
    visibility();
    return () => { cancelAnimationFrame(frame); worker.terminate(); workerRef.current = null; document.removeEventListener("visibilitychange", visibility); reduced.removeEventListener("change", reduce); };
  }, [entities, model, svg, width]);
  useEffect(() => {
    const changed: Array<{ id: string; x: number; y: number }> = [];
    for (const node of nodes) {
      const previous = positions.current.get(node.id);
      if (previous && (previous.x !== node.x || previous.y !== node.y)) changed.push({ id: node.id, x: node.x, y: node.y });
      positions.current.set(node.id, { x: node.x, y: node.y });
    }
    if (changed.length && workerRef.current) {
      if (svg.current) svg.current.dataset.inkActive = "true";
      workerRef.current.postMessage({ type: "move", points: changed, time: performance.now() });
    }
  }, [nodes, svg]);
  const move = (points: Array<{ id: string; x: number; y: number }>) => {
    if (workerRef.current) {
      if (svg.current) svg.current.dataset.inkActive = "true";
      for (const point of points) positions.current.set(point.id, point);
      workerRef.current.postMessage({ type: "move", points, time: performance.now() });
    }
  };
  const begin = (id: string) => workerRef.current?.postMessage({ type: "begin", id, time: performance.now() });
  const end = (id: string) => workerRef.current?.postMessage({ type: "end", id, time: performance.now() });
  return { bounds, error, move, begin, end };
}
