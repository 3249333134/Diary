import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDiary } from "@diary/contracts";

const storage = vi.hoisted(() => ({ documents: [] as ReturnType<typeof emptyDiary>[], parents: {} as Record<string, string> }));
vi.mock("./vault.js", () => ({
  listDiaryDates: async () => storage.documents.map(document => document.date),
  loadDiary: async (date: string) => ({ document: storage.documents.find(document => document.date === date)! }),
  readJson: async (path: string) => path.endsWith("place-parents.json") ? { ...storage.parents } : {},
  writeJson: async (_path: string, parents: Record<string, string>) => { storage.parents = { ...parents }; },
  withVaultLock: async (work: () => Promise<unknown>) => work(),
}));
import { EntityIndex } from "./entities.js";

describe("entity event index", () => {
  beforeEach(() => { storage.documents = []; storage.parents = {}; });
  it("persists manual parents, rejects cycles and supports detaching", async () => {
    const document = emptyDiary("2026-09-08");
    document.facts.events = [{ id: "a", time: "12:00", note: "地点", remark: "", people: [], activities: [], foods: [], places: ["十所", "十所门口"].map(name => ({ type: "place", name, tags: [] })) }];
    storage.documents = [document];
    const index = new EntityIndex(); await index.rebuild();
    await index.setPlaceParent("place|十所门口", "place|十所");
    await index.rebuild();
    expect(index.get("place", "十所门口")?.parentKey).toBe("place|十所");
    await expect(index.setPlaceParent("place|十所", "place|十所门口")).rejects.toMatchObject({ statusCode: 400 });
    await expect(index.setPlaceParent("place|十所", "place|不存在")).rejects.toMatchObject({ statusCode: 400 });
    await index.setPlaceParent("place|十所门口", null);
    expect(index.get("place", "十所门口")?.parentKey).toBeUndefined();
  });
  it("counts same-day events, preserves unique dates, merges names and rebuilds on deletion", async () => {
    const document = emptyDiary("2026-09-08");
    document.facts.events = ["a", "b"].map(id => ({
      id, time: "12:00", note: "一起吃饭", remark: "",
      people: [{ type: "person", name: id === "a" ? " Ａ " : "a", tags: [] }],
      places: [{ type: "place", name: "公司", tags: [] }, { type: "place", name: "公司", tags: [] }],
      activities: [], foods: [],
    }));
    storage.documents = [document];
    const index = new EntityIndex();
    await index.rebuild();
    expect(index.list()).toHaveLength(2);
    expect(index.get("person", "a")?.eventRelations[0]).toMatchObject({ count: 2, dates: [document.date] });
    expect(index.get("person", "a")?.occurrences).toHaveLength(2);
    document.facts.events.pop();
    await index.rebuild();
    expect(index.get("person", "a")?.eventRelations[0].count).toBe(1);
    document.facts.events = [];
    await index.rebuild();
    expect(index.list()).toEqual([]);
  });
});
