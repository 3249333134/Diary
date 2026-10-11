import { describe, expect, it } from "vitest";
import { entityKey, type EntityRecord, type EntityType } from "@diary/contracts";
import { buildGraph } from "./graphModel";
import { edgeAppearance } from "./graphData";

function entity(type: EntityType, name: string, events: string[]): EntityRecord {
  return {
    key: entityKey(type, name), type, name, tags: [], eventRelations: [], dayRelations: [],
    mentions: [...new Set(events.map(event => event.split("|")[1]))],
    occurrences: events.map((key, index) => ({ key, date: key.split("|")[1], time: "12:00", note: key, index })),
  };
}
const first = "event|2026-09-08|a", second = "event|2026-09-08|b", third = "event|2026-09-09|c";
const person = entity("person", "张三", [first, second, third]);
const company = entity("place", "公司", [first, second]);
const home = entity("place", "家", [third]);
const coEdges = (graph: ReturnType<typeof buildGraph>) => graph.edges.filter(edge => edge.kind === "event");

describe("entity ink graph", () => {
  it("nests descendants and deduplicates parent totals without adding co-occurrence edges", () => {
    const root = entity("place", "十所", [first]);
    const child = { ...entity("place", "十所门口", [first, second]), parentKey: root.key };
    const grandchild = { ...entity("place", "门卫室", [third]), parentKey: child.key };
    const graph = buildGraph([root, child, grandchild, person]);
    expect(graph.regions.find(region => region.id === root.key)).toMatchObject({ count: 3, childIds: [child.key], ancestorIds: [] });
    expect(graph.regions.find(region => region.id === grandchild.key)?.ancestorIds).toEqual([root.key, child.key]);
    expect(graph.nodes.find(node => node.id === root.key)?.eventCount).toBe(3);
    const rootRegion = graph.regions.find(region => region.id === root.key)!;
    expect([265, 210, 165, 32]).toContain(rootRegion.hue);
    expect(buildGraph([root]).regions[0].hue).toBe(rootRegion.hue);
    for (const id of [child.key, grandchild.key]) {
      const region = graph.regions.find(region => region.id === id)!;
      expect(region.paletteHue).toBe(rootRegion.hue);
      expect(Math.abs(region.hue - rootRegion.hue)).toBeLessThanOrEqual(10);
      expect(region.tone).toBeGreaterThan(0);
    }
    expect(buildGraph([person, grandchild, child, root]).regions).toEqual(graph.regions);
    const narrow = buildGraph([root, child, grandchild, person],undefined,false,undefined,false,"relation",{width:375,height:832});
    expect(narrow.regions.map(region=>region.id).sort()).toEqual(graph.regions.map(region=>region.id).sort());
    expect(coEdges(graph).find(edge => [edge.source, edge.target].includes(root.key) && [edge.source, edge.target].includes(grandchild.key))).toBeUndefined();
    expect(buildGraph([root, { ...child, parentKey: undefined }]).regions.every(region => !region.parentId)).toBe(true);
  });
  it("defaults to entities and self; same-day events count separately", () => {
    const graph = buildGraph([person, company]);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.some(node => node.kind === "event")).toBe(false);
    expect(coEdges(graph)).toHaveLength(1);
    expect(coEdges(graph)[0].count).toBe(2);
    expect(graph.nodes.find(node => node.id === person.key)?.eventCount).toBe(3);
    expect(graph.edges.find(edge => edge.kind === "self" && edge.target === person.key)?.count).toBe(3);
  });
  it("merges normalized names across time and deduplicates repeated event mentions", () => {
    const graph = buildGraph([entity("person", " Ａ  座 ", [first, first]), entity("person", "a 座", [first, second]), entity("place", "a 座", [first, second])]);
    expect(graph.nodes.filter(node => node.kind === "person")).toHaveLength(1);
    expect(graph.nodes.find(node => node.kind === "person")?.eventCount).toBe(2);
    expect(graph.nodes.filter(node => node.kind === "place")).toHaveLength(1);
    expect(coEdges(graph)[0].count).toBe(2);
    expect(graph.edges.every(edge => edge.source !== edge.target)).toBe(true);
  });
  it("does not connect entities merely sharing a date", () => {
    const graph = buildGraph([entity("person", "张三", [first]), entity("food", "米饭", [second])]);
    expect(coEdges(graph)).toHaveLength(0);
    expect(graph.regions[0]).toMatchObject({ neutral: true, count: 2 });
  });
  it("optional event nodes do not change co-occurrence counts; dates remain archival", () => {
    const graph = buildGraph([person, company], undefined, true, undefined, true);
    expect(graph.nodes.filter(node => node.kind === "event")).toHaveLength(3);
    expect(coEdges(graph)).toEqual(coEdges(buildGraph([person, company])));
    expect(graph.edges.some(edge => edge.source.startsWith("date|") && edge.kind === "mention")).toBe(true);
  });
  it("larger event counts mean larger ink areas, independently of type filters", () => {
    const graph = buildGraph([person, company, home]);
    expect(graph.regions).toEqual(buildGraph([person, company, home], ["place"]).regions);
    expect(graph.regions.find(region => region.id === company.key)!.radius).toBeGreaterThan(graph.regions.find(region => region.id === home.key)!.radius);
    expect(graph.nodes.filter(node => node.id === person.key)).toHaveLength(1);
    expect(coEdges(graph).filter(edge => [edge.source, edge.target].includes(person.key))).toHaveLength(2);
    expect(buildGraph([person, company, home], ["person"]).regions).toEqual([]);
  });
  it("counts multi-place events once per place and recomputes after deletion", () => {
    const graph = buildGraph([entity("person", "张三", [first]), entity("place", "公司", [first]), entity("place", "家", [first])]);
    expect(graph.regions.map(region => region.count)).toEqual([1, 1]);
    expect(coEdges(graph).map(edge => edge.count)).toEqual([1, 1, 1]);
    const updated = buildGraph([entity("person", "张三", [third]), home]);
    expect(updated.regions).toHaveLength(1);
    expect(updated.regions[0].count).toBe(1);
    expect(coEdges(updated)[0].count).toBe(1);
    expect(buildGraph([])).toMatchObject({ regions: [], edges: [] });
    expect(buildGraph([]).nodes).toHaveLength(1);
  });
  it("keeps event-only mode and finite deterministic large layouts", () => {
    const eventGraph = buildGraph([person, company, home], undefined, false, undefined, false, "event");
    expect(eventGraph.nodes.every(node => node.kind === "event")).toBe(true);
    expect(eventGraph.regions).toEqual([]);
    const many = Array.from({ length: 250 }, (_, i) => entity("person", "人物" + i, [i % 2 ? first : second]));
    const graph = buildGraph([...many, company]);
    expect(graph.nodes).toHaveLength(252);
    expect(graph.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
    expect(buildGraph([person, company, home])).toEqual(buildGraph([home, person, company]));
  });
  it("uses monotonic bounded strength and faint auxiliary edges", () => {
    const levels = [1, 2, 4, 8, 16, 32].map(count => edgeAppearance(count));
    expect(levels[0].strength).toBeGreaterThan(0);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].strength).toBeGreaterThan(levels[i - 1].strength);
      expect(levels[i].opacity).toBeGreaterThan(levels[i - 1].opacity);
      expect(levels[i].width).toBeGreaterThan(levels[i - 1].width);
    }
    expect(edgeAppearance(2).opacity).toBeGreaterThan(edgeAppearance(1).opacity);
    expect(edgeAppearance(8).width).toBeGreaterThan(edgeAppearance(2).width);
    expect(edgeAppearance(10000)).toEqual(edgeAppearance(64));
    expect(edgeAppearance(8, true).opacity).toBeLessThan(edgeAppearance(8).opacity);
  });
  it("keeps merged details and frequency in sync when a source event is edited", () => {
    const records = [entity("person", " Ａ ", [first, first]), entity("person", "a", [second, third]), company];
    const before = buildGraph(records);
    const merged = before.nodes.find(node => node.kind === "person")!;
    expect(merged.entity?.occurrences).toHaveLength(3);
    expect(merged.entity?.mentions).toHaveLength(2);
    expect(merged.eventCount).toBe(3);
    expect(coEdges(before)[0].count).toBe(2);
    const after = buildGraph([records[0], entity("person", "a", [third]), company]);
    expect(after.nodes.find(node => node.kind === "person")?.eventCount).toBe(2);
    expect(coEdges(after)[0].count).toBe(1);
    expect(after.regions[0].count).toBe(2);
    expect(buildGraph([entity("thing", "书", [first])]).nodes.map(node => node.kind)).toEqual(["self"]);
  });
  it("reflows place regions for narrow screens", () => {
    const mobile = buildGraph([person, company, home], undefined, false, undefined, false, "relation", { width: 330, height: 520 });
    expect(Math.abs(mobile.regions[0].x - mobile.regions[1].x)).toBeLessThan(35);
    expect(mobile.regions[0].y).not.toBe(mobile.regions[1].y);
    expect(mobile.nodes.every(node => node.x >= 0 && node.x <= 330 && node.y >= 0 && node.y <= 520)).toBe(true);
  });
  it("builds a shared paint field with bounded areas weighted by event counts", () => {
    const graph = buildGraph([person, company, home]);
    const larger = graph.regions.find(region => region.id === company.key)!;
    const smaller = graph.regions.find(region => region.id === home.key)!;
    expect(larger.paintedArea).toBeGreaterThan(smaller.paintedArea!);
    expect(graph.regions.every(region => region.path.includes("Q") && region.bounds && region.paintedArea! > 0)).toBe(true);
    expect(graph.regions.reduce((area, region) => area + region.paintedArea!, 0)).toBeLessThan(1000 * 640);
  });
});
