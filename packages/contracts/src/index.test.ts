import { describe, expect, it } from "vitest";
import { entityKey } from "./index.js";

describe("entity composite key", () => {
  it("keeps same-name entities of different types separate", () => {
    expect(entityKey("person", "张三")).not.toBe(entityKey("thing", "张三"));
  });

  it("normalizes compatible width and whitespace", () => {
    expect(entityKey("place", "  Ａ 座  ")).toBe(entityKey("place", "A 座"));
  });
});
