import { describe, expect, it } from "vitest";
import { MemberInkSimulation, type InkRegion } from "./memberInk";
import { memberInkScene } from "./memberInkScene";
import { buildGraph } from "./graphModel";
import type { EntityRecord } from "@diary/contracts";

const scene: InkRegion[] = [
  { id: "十所", count: 3, points: [{ id: "十所", x: 200, y: 100, weight: 3 }] },
  { id: "南院", parentId: "十所", count: 2, points: [{ id: "南院", x: 200, y: 200, weight: 2 }, { id: "a", x: 240, y: 220, weight: 2 }, { id: "b", x: 190, y: 250, weight: 1 }] },
  { id: "家", count: 1, points: [{ id: "家", x: -450, y: -400, weight: 1 }, { id: "c", x: -420, y: -420, weight: 1 }] },
];
describe("member-constrained liquid map", () => {
  it("fills the interior between widely separated members instead of drawing a tube network", () => {
    const sim = new MemberInkSimulation([{ id: "area", count: 3, points: [
      { id: "a", x: 0, y: 0, weight: 1 }, { id: "b", x: 400, y: 0, weight: 1 }, { id: "c", x: 200, y: 400, weight: 1 },
    ] }]);
    sim.render();
    for (const [x, y] of [[120, 100], [200, 180], [280, 100]]) expect(sim.contains("area", x, y)).toBe(true);
    sim.move("c", 200, 700, true); sim.render();
    expect(sim.contains("area", 200, 400)).toBe(true);
    expect(sim.contains("area", 0, 0)).toBe(true);
  });
  it("retains a filled initial territory and handles empty data", () => {
    expect(new MemberInkSimulation([]).render()).toEqual([]);
    const sim = new MemberInkSimulation([{ id: "area", count: 1, points: [{ id: "a", x: 200, y: 200, weight: 1 }], footprint: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }] }]);
    sim.render();
    expect(sim.contains("area", 50, 50)).toBe(true);
    expect(sim.contains("area", 350, 350)).toBe(true);
  });
  it("extends the right region and ancestors, retains all members and a connected bridge", () => {
    const sim = new MemberInkSimulation(scene, 4);
    const initial = sim.render();
    sim.move("a", 600, 300);
    sim.step(1 / 60); sim.render();
    expect(sim.contains("南院", 600, 300)).toBe(true);
    expect(sim.contains("十所", 600, 300)).toBe(true);
    sim.settle(); const final = sim.render();
    expect(final.find(contour => contour.id === "家")).toBeUndefined();
    expect(initial.find(contour => contour.id === "家")!.path).toContain("Q");
    expect(sim.contains("南院", 190, 250)).toBe(true);
    for (let t = 0; t <= 1; t += .1) expect(sim.contains("南院", 200 + 400 * t, 200 + 100 * t)).toBe(true);
    expect(final.find(contour => contour.id === "南院")!.path.match(/M /g)).toHaveLength(1);
    expect(final.find(contour => contour.id === "十所")!.path.match(/M /g)).toHaveLength(1);
    expect(sim.render()).toEqual([]);
  });
  it("supports multiple directions, reversals, settle and ignores self", () => {
    const sim = new MemberInkSimulation(scene); sim.render();
    sim.move("a", 700, 300, true); sim.move("b", 150, 650, true); sim.render();
    expect(sim.contains("十所", 150, 650)).toBe(true);
    expect(sim.contains("南院", 700, 300)).toBe(true);
    sim.move("a", 240, 220, true); const returned = sim.render();
    expect(returned.find(contour => contour.id === "南院")!.bounds.right).toBeLessThan(400);
    sim.move("self|me", 5000, 5000); expect(sim.render()).toEqual([]);
    sim.move("a", -1000, 1000); let active = true;
    for (let i = 0; i < 600; i++) { active = sim.step(1 / 60); sim.render(); }
    expect(active).toBe(false);
    expect(sim.render().every(contour => !/NaN|Infinity/.test(contour.path))).toBe(true);
  });
  it("preserves weighted cross-place membership independently of screen distance", () => {
    const event = (key: string) => ({ key, date: "2026-09-15", time: "12:00", note: "", index: 0 });
    const record = (key: string, type: EntityRecord["type"], occurrences: string[]): EntityRecord => ({ key, name: key.split("|")[1], type, mentions: ["2026-09-15"], tags: [], eventRelations: [], dayRelations: [], occurrences: occurrences.map(event) });
    const entities = [record("person|朋友", "person", ["a", "b", "c"]), record("place|家", "place", ["a"]), record("place|公司", "place", ["b", "c"])];
    const regions = memberInkScene(entities, buildGraph(entities));
    expect(regions.find(region => region.id === "place|家")!.points.find(point => point.id === "person|朋友")!.weight).toBe(1);
    expect(regions.find(region => region.id === "place|公司")!.points.find(point => point.id === "person|朋友")!.weight).toBe(2);
    expect(regions.flatMap(region => region.points).some(point => point.id === "self|me")).toBe(false);
  });
  it("renders a 500-member graph within a bounded raster budget", () => {
    const regions = Array.from({ length: 10 }, (_, place) => ({ id: `p${place}`, count: 50, points: Array.from({ length: 50 }, (_, i) => ({ id: `n${place}-${i}`, x: place * 180 + i % 7 * 13, y: (place % 2) * 220 + Math.floor(i / 7) * 13, weight: 1 })) }));
    const sim = new MemberInkSimulation(regions, 5);
    const start = performance.now(); const first = sim.render();
    sim.move("n0-1", -300, 100); sim.step(1 / 60); const changed = sim.render();
    console.info(`500 members: initial + changed render ${(performance.now() - start).toFixed(1)}ms; ${changed.length}/${first.length} regions updated`);
    expect(first).toHaveLength(10); expect(changed.length).toBeLessThan(10);
    expect(changed.every(contour => !/NaN|Infinity/.test(contour.path))).toBe(true);
  });
});
