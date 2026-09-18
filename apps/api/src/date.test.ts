import { describe, expect, it } from "vitest";
import { assertDate, weekLabel } from "./date.js";

describe("date helpers", () => {
  it("rejects malformed and impossible dates", () => {
    expect(() => assertDate("2026-02-30")).toThrow();
    expect(() => assertDate("2026/09/07")).toThrow();
  });

  it("handles ISO week boundaries", () => {
    expect(weekLabel("2026-01-01")).toBe("2026-W01");
    expect(weekLabel("2027-01-01")).toBe("2026-W53");
  });
});
