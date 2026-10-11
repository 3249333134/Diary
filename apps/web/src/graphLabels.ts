import type { GraphNode } from "./graphModel";

type Box = { left: number; right: number; top: number; bottom: number };
type Label = { x: number; y: number; textAnchor: "start" | "end" | "middle" };

/** Move labels only: member coordinates continue to constrain the liquid map. */
export function placeGraphLabels(nodes: GraphNode[], visible: Set<string>, priority?: string | null) {
  const occupied: Box[] = nodes.map(node => node.kind === "place"
    ? { left: node.x - Math.max(46, node.label.length * 7 + 12), right: node.x + Math.max(46, node.label.length * 7 + 12), top: node.y - 23, bottom: node.y + 23 }
    : { left: node.x - node.radius - 3, right: node.x + node.radius + 3, top: node.y - node.radius - 3, bottom: node.y + node.radius + 3 });
  const labels = new Map<string, Label>();
  const ordered = nodes.filter(node => visible.has(node.id) && node.kind !== "place")
    .sort((a, b) => Number(b.id === priority) - Number(a.id === priority) || Number(b.kind === "self") - Number(a.kind === "self") || (b.eventCount || 0) - (a.eventCount || 0) || a.id.localeCompare(b.id));
  for (const node of ordered) {
    const text = node.kind === "event" && node.label.length > 25 ? `${node.label.slice(0, 25)}…` : node.label;
    const width = [...text].reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 14 : 8), 4);
    const gap = node.radius + 8;
    const candidates: Label[] = [
      { x: gap, y: 4, textAnchor: "start" }, { x: -gap, y: 4, textAnchor: "end" },
      { x: 0, y: -gap - 4, textAnchor: "middle" }, { x: 0, y: gap + 12, textAnchor: "middle" },
      { x: gap, y: -gap, textAnchor: "start" }, { x: -gap, y: -gap, textAnchor: "end" },
      { x: gap, y: gap + 12, textAnchor: "start" }, { x: -gap, y: gap + 12, textAnchor: "end" },
    ];
    const scored = candidates.map(label => {
      const left = node.x + label.x - (label.textAnchor === "end" ? width : label.textAnchor === "middle" ? width / 2 : 0);
      const box = { left, right: left + width, top: node.y + label.y - 14, bottom: node.y + label.y + 4 };
      const overlap = occupied.reduce((sum, b) => sum + Math.max(0, Math.min(box.right, b.right) - Math.max(box.left, b.left)) * Math.max(0, Math.min(box.bottom, b.bottom) - Math.max(box.top, b.top)), 0);
      return { label, box, overlap };
    }).sort((a, b) => a.overlap - b.overlap);
    labels.set(node.id, scored[0].label);
    occupied.push(scored[0].box);
  }
  return labels;
}
