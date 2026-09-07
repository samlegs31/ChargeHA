import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  activeOccurrence,
  BatteryScheduleMemory,
} from "./BatteryScheduleMemory.ts";
import type { EngineSchedule } from "@chargeha/shared/engine";

describe("Battery schedule memory", () => {
  const schedule: EngineSchedule = {
    id: "night",
    vehicleId: "V1",
    scheduleType: "charge",
    startTime: "22:00",
    endTime: "06:00",
    days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    chargeAmps: 16,
    chargeLimitPct: 80,
    enabled: true,
  };

  it("restores a block after restart but not on the next night's occurrence", async () => {
    const values = new Map<string, string>();
    const repository = {
      getConfig: (key: string) => Promise.resolve(values.get(key) ?? null),
      setConfig: (key: string, value: string) => {
        values.set(key, value);
        return Promise.resolve();
      },
    };
    const key = "V1\u0000night";
    await new BatteryScheduleMemory(repository).persist(
      new Set([key]),
      [schedule],
      new Date("2026-09-07T21:00:00Z"),
      "Europe/Paris",
    );
    const restored = new Set<string>();
    await new BatteryScheduleMemory(repository).restore(
      restored,
      [schedule],
      new Date("2026-09-08T01:00:00Z"),
      "Europe/Paris",
    );
    expect(restored.has(key)).toBe(true);
    const tomorrow = new Set<string>();
    await new BatteryScheduleMemory(repository).restore(
      tomorrow,
      [schedule],
      new Date("2026-09-08T21:00:00Z"),
      "Europe/Paris",
    );
    expect(tomorrow.size).toBe(0);
  });
  it("keeps the same occurrence across the repeated hour at daylight saving end", () => {
    expect(
      activeOccurrence(
        schedule,
        new Date("2026-10-25T00:30:00Z"),
        "Europe/Paris",
      ),
    )
      .toBe(
        activeOccurrence(
          schedule,
          new Date("2026-10-25T01:30:00Z"),
          "Europe/Paris",
        ),
      );
  });
  it("drops disabled or edited schedules", () => {
    const now = new Date("2026-09-07T21:00:00Z");
    expect(
      activeOccurrence({ ...schedule, enabled: false }, now, "Europe/Paris"),
    ).toBeNull();
    expect(
      activeOccurrence({ ...schedule, endTime: "05:00" }, now, "Europe/Paris"),
    ).not.toBe(activeOccurrence(schedule, now, "Europe/Paris"));
  });
});
