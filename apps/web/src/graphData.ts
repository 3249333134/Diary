import { entityKey, type EntityRecord } from "@diary/contracts";
import { paintTerritories } from "./inkTerritories";

type Occurrence = NonNullable<EntityRecord["occurrences"]>[number];
export type GraphEvent = Occurrence & { entities: Set<string>; places: Set<string> };

/** One source of truth for frequency, co-occurrence and place membership. */
export function deriveGraphData(input: EntityRecord[]) {
  const merged = new Map<string, EntityRecord>();
  for (const entity of input) {
    const key = entityKey(entity.type, entity.name);
    const previous = merged.get(key);
    const occurrences = new Map([...(previous?.occurrences || []), ...(entity.occurrences || [])].map(event => [event.key, event]));
    merged.set(key, {
      ...entity, key, name: previous?.name || entity.name,
      mentions: [...new Set([...(previous?.mentions || []), ...entity.mentions])].sort(),
      tags: [...new Set([...(previous?.tags || []), ...entity.tags])],
      occurrences: [...occurrences.values()].sort((a, b) => a.key.localeCompare(b.key)),
    });
  }
  const entities = [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
  const events = new Map<string, GraphEvent>();
  for (const entity of entities) for (const occurrence of entity.occurrences || []) {
    let event = events.get(occurrence.key);
    if (!event) {
      event = { ...occurrence, entities: new Set(), places: new Set() };
      events.set(event.key, event);
    }
    event.entities.add(entity.key);
    if (entity.type === "place") event.places.add(entity.key);
  }
  const frequency = new Map(entities.map(entity => [entity.key, entity.occurrences?.length || 0]));
  const memberships = new Map<string, Map<string, number>>();
  for (const event of events.values()) for (const key of event.entities) {
    const weights = memberships.get(key) || new Map<string, number>();
    for (const place of event.places.size ? event.places : ["unlocated"]) weights.set(place, (weights.get(place) || 0) + 1);
    memberships.set(key, weights);
  }
  return { entities, events, frequency, memberships };
}

export type PlaceRegion = {
  id: string;
  label: string;
  count: number;
  x: number;
  y: number;
  radius: number;
  path: string;
  hue: number;
  paletteHue?: number;
  tone?: number;
  neutral: boolean;
  bounds?: { left: number; right: number; top: number; bottom: number };
  paintedArea?: number;
  parentId?: string;
  ancestorIds?: string[];
  childIds?: string[];
  occurrences?: Occurrence[];
};

function seedFor(key: string) {
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}

// Equal-area normalized outlines: shape variation cannot reverse the count/area order.
function inkPath(seed: number) {
  const points = Array.from({ length: 24 }, (_, i) => {
    const angle = i / 24 * Math.PI * 2;
    const radius = 1 + .13 * Math.sin(angle * 3 + seed % 19) + .09 * Math.cos(angle * 7 + seed % 11);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * .73 };
  });
  const area = Math.abs(points.reduce((sum, p, i) => {
    const next = points[(i + 1) % points.length];
    return sum + p.x * next.y - next.x * p.y;
  }, 0)) / 2;
  const scale = Math.sqrt(Math.PI * .73 / area);
  const p = points.map(point => ({ x: point.x * scale, y: point.y * scale }));
  // A closed uniform quadratic spline has a shape-dependent area; normalize it too.
  const mid = (a: typeof p[number], b: typeof p[number]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const samples = p.flatMap((control, i) => {
    const a = mid(p[(i + 23) % 24], control), b = mid(control, p[(i + 1) % 24]);
    return Array.from({ length: 12 }, (_, j) => {
      const t = j / 12;
      return { x: (1-t)**2*a.x + 2*t*(1-t)*control.x + t*t*b.x, y: (1-t)**2*a.y + 2*t*(1-t)*control.y + t*t*b.y };
    });
  });
  const smoothArea = Math.abs(samples.reduce((sum, a, i) => {
    const b = samples[(i + 1) % samples.length]; return sum + a.x*b.y-b.x*a.y;
  }, 0)) / 2;
  const correction = Math.sqrt(Math.PI * .73 / smoothArea);
  const fmt = (a: typeof p[number]) => `${(a.x*correction).toFixed(5)} ${(a.y*correction).toFixed(5)}`;
  return `M ${fmt(mid(p[23], p[0]))} ` + p.map((point, i) => `Q ${fmt(point)} ${fmt(mid(point, p[(i + 1) % 24]))}`).join(" ") + " Z";
}

export function buildPlaceRegions(data: ReturnType<typeof deriveGraphData>, showPlaces: boolean, width = 1000, height = 640): PlaceRegion[] {
  if (!showPlaces) return [];
  const places = data.entities.filter(entity => entity.type === "place").map(entity => ({ id: entity.key, label: entity.name, count: data.frequency.get(entity.key) || 0, neutral: false }));
  const unlocated = [...data.events.values()].filter(event => !event.places.size).length;
  if (unlocated) places.push({ id: "unlocated", label: "未标注地点", count: unlocated, neutral: true });
  const total = places.reduce((sum, place) => sum + Math.max(1, place.count), 0);
  const columns = Math.max(1, Math.round(Math.sqrt(places.length * width / height)));
  const rows = Math.ceil(places.length / columns);
  const regions = places.map((place, i) => {
    const seed = seedFor(place.id);
    return {
      ...place,
      x: 25 + (i % columns + .5) * (width - 50) / columns,
      y: 120 + (Math.floor(i / columns) + .5) * (height - 175) / rows,
      radius: Math.sqrt(Math.min(1400, width * height * .05 / Math.max(1, places.length)) + width * height * .1 * Math.max(1, place.count) / Math.max(1, total)),
      path: inkPath(seed), hue: [265, 210, 165, 32][seed % 4], tone: 0,
    };
  });
  const byId = new Map(regions.map(region => [region.id, region]));
  const parents = new Map<string, string>();
  for (const entity of data.entities) {
    if (entity.type !== "place" || !entity.parentKey || !byId.has(entity.parentKey)) continue;
    const visited = new Set([entity.key]); let key: string | undefined = entity.parentKey;
    while (key && !visited.has(key)) { visited.add(key); key = data.entities.find(item => item.key === key)?.parentKey; }
    if (!key) parents.set(entity.key, entity.parentKey);
  }
  const children = (id: string) => regions.filter(region => parents.get(region.id) === id);
  const eventUnion = (id: string): Occurrence[] => {
    const own = data.entities.find(entity => entity.key === id)?.occurrences || [];
    return [...new Map([...own, ...children(id).flatMap(child => eventUnion(child.id))].map(event => [event.key, event])).values()];
  };
  const aggregate = (region: PlaceRegion): PlaceRegion => {
    const occurrences = region.neutral ? undefined : eventUnion(region.id);
    return { ...region, count: occurrences?.length ?? region.count, occurrences, childIds: children(region.id).map(child => child.id) };
  };
  const roots = regions.filter(region => !parents.has(region.id)).map(aggregate);
  // Distribute only top-level locations over the full map. Child territories are
  // painted within their parent's bounds and clipped to its irregular outline.
  const rootColumns = Math.max(1, Math.round(Math.sqrt(roots.length * width / height)));
  const rootRows = Math.ceil(roots.length / rootColumns);
  roots.forEach((region, i) => {
    region.x = 25 + (i % rootColumns + .5) * (width - 50) / rootColumns;
    region.y = 120 + (Math.floor(i / rootColumns) + .5) * (height - 175) / rootRows;
  });
  const nest = (painted: PlaceRegion[], ancestors: string[] = []): PlaceRegion[] => painted.flatMap(region => {
    const nested = children(region.id).map(aggregate);
    const parent = { ...region, ancestorIds: ancestors, parentId: ancestors.at(-1) };
    if (!nested.length) return [parent];
    // Narrow territory balancing can leave a root with no sampled cells. Its
    // children still exist and must receive anchors, membership and ink deposits.
    const b = region.bounds || { left: Math.max(18,region.x-width*.4), right: Math.min(width-18,region.x+width*.4), top: Math.max(130,region.y-height*.2), bottom: Math.min(height-28,region.y+height*.2) };
    const inset = Math.min(14, (b.right - b.left) * .08, (b.bottom - b.top) * .08);
    const domain = { left: b.left + inset, top: b.top + 40, width: Math.max(20, b.right - b.left - inset * 2), height: Math.max(20, b.bottom - b.top - 40 - inset) };
    const cols = Math.max(1, Math.round(Math.sqrt(nested.length * domain.width / domain.height)));
    const rows = Math.ceil(nested.length / cols);
    nested.forEach((child, i) => { child.x = domain.left + (i % cols + .5) * domain.width / cols; child.y = domain.top + (Math.floor(i / cols) + .5) * domain.height / rows; });
    const paletteHue = region.paletteHue ?? region.hue;
    const paintedChildren = paintTerritories(nested, width, height, domain).map(child => {
      const seed = seedFor(child.id);
      return { ...child, paletteHue, hue: paletteHue + (seed % 5 - 2) * 5, tone: 1 + (seed >>> 5) % 4 };
    });
    return [parent, ...nest(paintedChildren, [...ancestors, region.id])];
  });
  return nest(paintTerritories(roots, width, height));
}

export function edgeAppearance(count: number, auxiliary = false) {
  const strength = Math.min(1, Math.log2(Math.max(1, count)) / 5);
  // A single shared event must remain visible over the colored ink, too.
  return { strength: .4 + strength * .6, opacity: auxiliary ? .16 + strength * .24 : .55 + strength * .4, width: auxiliary ? .8 + strength * 1.2 : 1.2 + strength * 4 };
}
