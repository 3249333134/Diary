import { entityTypes, type EntityRecord, type EntityType, type RecordRef } from "@diary/contracts";
import type { ActionRow } from "./api";
import { shortDate } from "./date";
import { deriveGraphData, buildPlaceRegions, type PlaceRegion } from "./graphData";
export const WIDTH = 1000;
export const HEIGHT = 640;
export const SELF_ID = "self|me";
export type GraphNode = {
  id: string;
  label: string;
  kind: EntityType | "date" | "self" | "event" | 'todo' | 'record';
  reference?: RecordRef;
  x: number;
  y: number;
  radius: number;
  entity?: EntityRecord;
  date?: string;
  eventCount?: number;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: "mention" | "event" | "day" | "self" | 'action';
  count: number;
};

export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[]; regions: PlaceRegion[] };
export type GraphViewport = { width: number; height: number };

export function defaultView() {
  return { scale: 1, x: 0, y: 0 };
}

function addEdge(edges: Map<string, GraphEdge>, source: string, target: string, kind: GraphEdge["kind"], count = 1) {
  const pair = [source, target].sort();
  const id = `${kind}|${pair[0]}|${pair[1]}`;
  if (!edges.has(id)) edges.set(id, { id, source, target, kind, count });
}

export function buildGraph(input: EntityRecord[], enabledTypes: EntityType[] = entityTypes.filter(type => type !== "thing"), showDates = false, actions?: { tasks: ActionRow[]; records: RecordRef[] }, showEvents = false, graphMode: "relation" | "event" = "relation", viewport: GraphViewport = { width: WIDTH, height: HEIGHT }): GraphModel {
  const { width: WIDTH, height: HEIGHT } = viewport;
  const data = deriveGraphData(input);
  const entities = data.entities;
  const enabled = new Set(enabledTypes);
  const visible = entities.filter((entity) => enabled.has(entity.type));

  // 2. 构建事件 → 实体列表 映射（用于计算实体间共同出现次数 / 事件间共享实体）
  const eventEntities = new Map<string, string[]>(); // eventKey → entityKey[]
  const eventMeta = new Map<string, { date: string; time: string; note: string }>();
  // 事件图谱模式下，需要所有类型的实体来计算事件间的共享关系
  const visibleKeys = new Set(visible.map(entity => entity.key));
  for (const event of data.events.values()) {
    const keys = [...event.entities].filter(key => graphMode === "event" || visibleKeys.has(key));
    if (!keys.length) continue;
    eventEntities.set(event.key, keys);
    eventMeta.set(event.key, event);
  }

  // ===== 事件图谱模式：只显示事件节点，事件间共享实体则连边 =====
  if (graphMode === "event") {
    const eventKeys = [...eventEntities.keys()];
    const nodes: GraphNode[] = [];
    eventKeys.forEach((eventKey, index) => {
      const meta = eventMeta.get(eventKey)!;
      const angle = index * 2.399963;
      const radius = 60 + Math.sqrt(index / Math.max(eventKeys.length, 1)) * 210;
      nodes.push({
        id: eventKey,
        kind: "event",
        label: `${meta.date.slice(5)} ${meta.time} · ${meta.note}`,
        date: meta.date,
        x: WIDTH / 2 + Math.cos(angle) * radius,
        y: HEIGHT / 2 + Math.sin(angle) * radius,
        radius: 12,
      });
    });

    // 事件间连边：共享实体越多，count 越大
    const edges = new Map<string, GraphEdge>();
    const eventEntitySets = new Map(eventKeys.map((k) => [k, new Set(eventEntities.get(k)!)]));
    for (let i = 0; i < eventKeys.length; i++) {
      for (let j = i + 1; j < eventKeys.length; j++) {
        const shared = [...eventEntitySets.get(eventKeys[i])!].filter((k) => eventEntitySets.get(eventKeys[j])!.has(k));
        if (shared.length > 0) {
          const pair = [eventKeys[i], eventKeys[j]].sort();
          edges.set(`evt|${pair[0]}|${pair[1]}`, { id: `evt|${pair[0]}|${pair[1]}`, source: pair[0], target: pair[1], kind: "event", count: shared.length });
        }
      }
    }

    const byId = new Map(nodes.map((node) => [node.id, node]));
    const graphEdges = [...edges.values()].filter((edge) => byId.has(edge.source) && byId.has(edge.target));
    return runLayout(nodes, graphEdges, [], undefined, viewport);
  }

  // ===== 关系图谱模式：self + 实体节点 =====
  const nodes: GraphNode[] = [{ id: SELF_ID, label: "我", kind: "self", x: WIDTH / 2, y: HEIGHT / 2, radius: 23 }];
  const entityCount = Math.max(visible.length, 1);

  // 1. 构建实体节点（重复出现的实体已在 EntityRecord 层合并，这里每个实体只一个节点）
  visible.forEach((entity, index) => {
    const angle = index * 2.399963;
    const radius = 55 + Math.sqrt(index / entityCount) * 205;
    nodes.push({
      id: entity.key,
      label: entity.name,
      kind: entity.type,
      x: WIDTH / 2 + Math.cos(angle) * radius,
      y: HEIGHT / 2 + Math.sin(angle) * radius,
      radius: 9 + Math.min(7, Math.log2(1 + (data.frequency.get(entity.key) || 0)) * 2),
      eventCount: data.frequency.get(entity.key) || 0,
      entity,
    });
  });

  // 3. 实体间连边：共同出现在同一事件的实体两两连边，count = 共同出现次数
  const edges = new Map<string, GraphEdge>();
  for (const [, entityKeys] of eventEntities) {
    const unique = [...new Set(entityKeys)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const pair = [unique[i], unique[j]].sort();
        const id = `co|${pair[0]}|${pair[1]}`;
        const existing = edges.get(id);
        if (existing) existing.count++;
        else edges.set(id, { id, source: pair[0], target: pair[1], kind: "event", count: 1 });
      }
    }
  }

  // 4. 我 → 每个实体 连边（表示"我记录过这个实体"）
  for (const entity of visible) {
    addEdge(edges, SELF_ID, entity.key, "self", data.frequency.get(entity.key) || 0);
  }

  // 5. 可选：显示事件节点
  if (showEvents) {
    for (const [eventKey, entityKeys] of eventEntities) {
      const meta = eventMeta.get(eventKey)!;
      const angle = nodes.length * 2.399963;
      nodes.push({
        id: eventKey,
        kind: "event",
        label: `${meta.date.slice(5)} ${meta.time} · ${meta.note}`,
        date: meta.date,
        x: WIDTH / 2 + Math.cos(angle) * 220,
        y: HEIGHT / 2 + Math.sin(angle) * 220,
        radius: 13,
      });
      for (const ek of [...new Set(entityKeys)]) {
        addEdge(edges, eventKey, ek, "mention");
      }
      addEdge(edges, SELF_ID, eventKey, "self");
    }
  }

  // 日期节点（可选）
  if (showDates) {
    const dates = [...new Set(visible.flatMap((entity) => entity.mentions))].sort();
    dates.forEach((date, index) => {
      const angle = (index / Math.max(dates.length, 1)) * Math.PI * 2 - Math.PI / 2;
      nodes.push({ id: `date|${date}`, label: shortDate(date), kind: "date", x: WIDTH / 2 + Math.cos(angle) * 275, y: HEIGHT / 2 + Math.sin(angle) * 255, radius: 8, date });
      for (const entity of visible.filter(entity => entity.mentions.includes(date))) addEdge(edges, `date|${date}`, entity.key, "mention");
    });
  }

  if (actions) {
    const key = (ref: RecordRef) => `${ref.kind === 'facts' ? 'event' : ref.kind}|${ref.date}|${ref.id}`;
    const addRecord = (ref: RecordRef) => {
      const id = key(ref); const existing = nodes.find(n => n.id === id);
      if (existing) existing.reference = ref;
      else { const angle = nodes.length * 2.399963; nodes.push({ id, label: ref.summary, kind: ref.kind === 'todo' ? 'todo' : ref.kind === 'facts' ? 'event' : 'record', reference: ref, date: ref.date, radius: 12, x: WIDTH / 2 + Math.cos(angle) * 230, y: HEIGHT / 2 + Math.sin(angle) * 210 }); }
      return id;
    };
    for (const row of actions.tasks) {
      const taskId = addRecord({ date: row.date, kind: 'todo', id: row.task.id, summary: `${row.task.done ? '已完成' : '待办'} · ${row.task.title}` });
      for (const ref of [row.task.source, row.task.completion]) {
        if (!ref) continue;
        const record = actions.records.find(r => r.date === ref.date && r.kind === ref.kind && r.id === ref.id);
        if (record) addEdge(edges, taskId, addRecord(record), 'action');
      }
    }
  }

  const regions = buildPlaceRegions(data, enabled.has("place"), WIDTH, HEIGHT);
  for (const region of regions) {
    const node = nodes.find(node => node.id === region.id);
    if (node?.entity && region.occurrences) {
      node.eventCount = region.count;
      node.entity = { ...node.entity, occurrences: region.occurrences, mentions: [...new Set(region.occurrences.map(event => event.date))].sort() };
    }
  }
  return runLayout(nodes, [...edges.values()], regions, data, viewport);
}

function runLayout(nodes: GraphNode[], edges: GraphEdge[], regions: PlaceRegion[] = [], data?: ReturnType<typeof deriveGraphData>, viewport: GraphViewport = { width: WIDTH, height: HEIGHT }): GraphModel {
  const { width: WIDTH, height: HEIGHT } = viewport;
  const regionById = new Map(regions.map(region => [region.id, region]));
  const anchors = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const place = regionById.get(node.id);
    if (place) { node.x = place.x; node.y = place.childIds?.length && place.bounds ? place.bounds.top + 22 : place.y + place.radius * .5; continue; }
    const weights = data?.memberships.get(node.id) || (node.kind === "event" ? new Map([...(data?.events.get(node.id)?.places || [])].map(id => [id, 1])) : undefined);
    let x = 0, y = 0, total = 0;
    for (const [id, count] of weights || []) {
      const region = regionById.get(id);
      if (region) { x += region.x * count; y += region.y * count; total += count; }
    }
    if (total) {
      const anchor = { x: x / total, y: y / total - 15 };
      anchors.set(node.id, anchor);
      node.x = anchor.x + (node.x - WIDTH / 2) * .18;
      node.y = anchor.y + (node.y - HEIGHT / 2) * .18;
    }
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const graphEdges = edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target));
  const iterations = nodes.length > 180 ? 30 : 150;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const cooling = 1 - iteration / (iterations + 20);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]; const b = nodes[j];
        let dx = b.x - a.x; let dy = b.y - a.y;
        const distanceSquared = Math.max(dx * dx + dy * dy, 64);
        const distance = Math.sqrt(distanceSquared);
        dx /= distance; dy /= distance;
        const push = (a.kind === "date" || b.kind === "date" ? 750 : 1150) / distanceSquared * 9 * cooling;
        a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
      }
    }
    for (const edge of graphEdges) {
      const a = byId.get(edge.source)!; const b = byId.get(edge.target)!;
      const dx = b.x - a.x; const dy = b.y - a.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const desired = edge.kind === "event" ? 105 : edge.kind === "day" ? 155 : edge.kind === "self" ? 185 : 125;
      const pull = (distance - desired) * (edge.kind === "event" ? .022 : edge.kind === "self" ? .018 : .012) * cooling;
      const px = dx / distance * pull; const py = dy / distance * pull;
      a.x += px; a.y += py; b.x -= px; b.y -= py;
    }
    for (const node of nodes) {
      if (node.id === SELF_ID) { node.x = WIDTH / 2; node.y = HEIGHT / 2; continue; }
      const place = regionById.get(node.id);
      if (place) { node.x = place.x; node.y = place.childIds?.length && place.bounds ? place.bounds.top + 22 : place.y + place.radius * .5; continue; }
      const anchor = anchors.get(node.id);
      node.x += ((anchor?.x ?? WIDTH / 2) - node.x) * (anchor ? .07 : .0025);
      node.y += ((anchor?.y ?? HEIGHT / 2) - node.y) * (anchor ? .07 : .0025);
      node.x = Math.max(38, Math.min(WIDTH - 38, node.x));
      node.y = Math.max(38, Math.min(HEIGHT - 38, node.y));
    }
  }
  const surrounding = nodes.filter((node) => node.id !== SELF_ID);
  if (surrounding.length && !regions.length) {
    const maxX = Math.max(...surrounding.map((node) => Math.abs(node.x - WIDTH / 2)), 1);
    const maxY = Math.max(...surrounding.map((node) => Math.abs(node.y - HEIGHT / 2)), 1);
    const spread = Math.min(2.15, (WIDTH / 2 - 45) / maxX, (HEIGHT / 2 - 80) / maxY);
    for (const node of surrounding) {
      node.x = WIDTH / 2 + (node.x - WIDTH / 2) * spread;
      node.y = HEIGHT / 2 + (node.y - HEIGHT / 2) * spread;
    }
  }
  return { nodes: nodes.map((node) => ({ ...node })), edges: graphEdges, regions };
}
