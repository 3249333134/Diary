import { describe, expect, it } from "vitest";
import { splitSentence } from "./sentence.js";

describe("local quick capture splitter", () => {
  it("extracts known entities and carries their tags", () => {
    const result = splitSentence("和小王在滨江公园散步，喝了咖啡", [
      { key: "person|小王", type: "person", name: "小王", tags: ["朋友"], mentions: [], eventRelations: [], dayRelations: [] },
      { key: "place|滨江公园", type: "place", name: "滨江公园", tags: ["户外"], mentions: [], eventRelations: [], dayRelations: [] },
      { key: "activity|散步", type: "activity", name: "散步", tags: ["运动"], mentions: [], eventRelations: [], dayRelations: [] },
      { key: "food|咖啡", type: "food", name: "咖啡", tags: ["饮品"], mentions: [], eventRelations: [], dayRelations: [] },
    ]);

    expect(result.people[0]).toMatchObject({ name: "小王", tags: ["朋友"] });
    expect(result.places[0]?.name).toBe("滨江公园");
    expect(result.activities[0]?.name).toBe("散步");
    expect(result.foods[0]?.name).toBe("咖啡");
  });

  it("removes the Chinese aspect particle from inferred values", () => {
    const result = splitSentence("喝了豆浆，看了电影", []);
    expect(result.foods.map((item) => item.name)).toContain("豆浆");
    expect(result.activities.map((item) => item.name)).toContain("电影");
  });
});
