import { describe, expect, it } from "vitest";
import { isAfterWeeklyRunTime } from "./weekly.js";

describe("weekly scheduler window", () => {
  it("starts at Monday 08:00 and remains eligible through Sunday", () => {
    expect(isAfterWeeklyRunTime({ weekday: 1, hour: 7 })).toBe(false);
    expect(isAfterWeeklyRunTime({ weekday: 1, hour: 8 })).toBe(true);
    expect(isAfterWeeklyRunTime({ weekday: 3, hour: 2 })).toBe(true);
    expect(isAfterWeeklyRunTime({ weekday: 0, hour: 2 })).toBe(true);
  });
});
