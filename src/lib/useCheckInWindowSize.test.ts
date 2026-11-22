import { describe, expect, it } from "vitest";
import { dailyCheckInSize } from "./useCheckInWindowSize";

describe("daily check-in window size", () => {
  const saved = JSON.stringify({ day: "2026-11-22", width: 810, height: 640 });

  it("restores both dimensions on the same local date", () => {
    expect(dailyCheckInSize(saved, "2026-11-22")).toEqual({ width: 810, height: 640 });
  });

  it("fits automatically the next day or with an invalid preference", () => {
    expect(dailyCheckInSize(saved, "2026-11-23")).toBeNull();
    expect(dailyCheckInSize("{", "2026-11-22")).toBeNull();
    expect(dailyCheckInSize('{"day":"2026-11-22","width":810,"height":0}', "2026-11-22")).toBeNull();
  });
});
