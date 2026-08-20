import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { StatsBucket, StatsResponse } from "@chargeha/shared";
import { mergeChargeHqStats } from "./mergeChargeHqStats.ts";

describe("mergeChargeHqStats", () => {
  function responseWithBuckets(buckets: StatsBucket[]): StatsResponse {
    return {
      period: "day",
      startDate: "2025-01-15",
      endDate: "2025-01-15",
      energyBuckets: [],
      homeSolarProductionWh: 0,
      homeConsumedWh: 0,
      homeSolarWh: 0,
      homeBatteryChargeWh: 0,
      homeBatteryDischargeWh: 0,
      homeSolarToBatteryWh: 0,
      homeGridToBatteryWh: 0,
      homeGridWh: 0,
      homeSelfPoweredPercent: 0,
      solarProductionLine: [],
      buckets,
      totalChargedWh: 0,
      totalSolarWh: 0,
      totalBatteryWh: 0,
      totalGridWh: 0,
      totalAwayWh: 0,
      selfPoweredPercent: 0,
      totalCostCents: buckets.reduce(
        (sum, bucket) => sum + (bucket.costCents ?? 0),
        0,
      ),
      solarSavingsCents: 123,
      evSolarSavingsCents: 45,
    };
  }

  function emptyBuckets(count: number): StatsBucket[] {
    return Array.from({ length: count }, (_, index) => ({
      label: String(index),
      solarWh: 0,
      batteryWh: 0,
      gridWh: 0,
      awayWh: 0,
      totalWh: 0,
      costCents: 0,
    }));
  }

  it("adds exact home archive Wh without inventing historical costs", () => {
    const buckets = emptyBuckets(24);
    buckets[13] = {
      ...buckets[13],
      solarWh: 100,
      gridWh: 200,
      totalWh: 300,
      costCents: 7,
    };
    const original = responseWithBuckets(buckets);

    const merged = mergeChargeHqStats(original, [{
      bucket: "13",
      solarWh: 400,
      batteryWh: 100,
      gridWh: 500,
      awayWh: 0,
      totalWh: 1000,
      costCents: 0,
      solarSavingsCents: 0,
    }], "day");

    expect(merged.buckets[13]).toEqual({
      label: "13",
      solarWh: 500,
      batteryWh: 100,
      gridWh: 700,
      awayWh: 0,
      totalWh: 1300,
      costCents: 7,
    });
    expect(merged.totalChargedWh).toBe(1300);
    expect(merged.totalSolarWh).toBe(500);
    expect(merged.totalBatteryWh).toBe(100);
    expect(merged.totalGridWh).toBe(700);
    expect(merged.totalAwayWh).toBe(0);
    expect(merged.totalCostCents).toBe(7);
    expect(merged.solarSavingsCents).toBe(123);
    expect(merged.evSolarSavingsCents).toBe(45);
  });

  it("rebuilds totals from source components when archive totals disagree", () => {
    const response = responseWithBuckets(emptyBuckets(24));
    const merged = mergeChargeHqStats(response, [{
      bucket: "12",
      solarWh: 700,
      batteryWh: 100,
      gridWh: 200,
      awayWh: 50,
      totalWh: 999999,
      costCents: 0,
      solarSavingsCents: 0,
    }], "day");

    expect(merged.buckets[12].totalWh).toBe(1050);
    expect(merged.totalChargedWh).toBe(1050);
    expect(merged.totalChargedWh).toBe(
      merged.totalSolarWh + merged.totalBatteryWh + merged.totalGridWh +
        merged.totalAwayWh,
    );
  });

  it("preserves native away charging", () => {
    const buckets = emptyBuckets(24);
    buckets[8] = {
      ...buckets[8],
      solarWh: 200,
      gridWh: 300,
      awayWh: 1500,
      totalWh: 2000,
    };

    const merged = mergeChargeHqStats(responseWithBuckets(buckets), [], "day");
    expect(merged.buckets[8].awayWh).toBe(1500);
    expect(merged.buckets[8].totalWh).toBe(2000);
    expect(merged.totalAwayWh).toBe(1500);
    expect(merged.totalChargedWh).toBe(2000);
  });

  it("merges attributed away archive energy", () => {
    const response = responseWithBuckets(emptyBuckets(24));
    const merged = mergeChargeHqStats(response, [{
      bucket: "18",
      solarWh: 0,
      batteryWh: 0,
      gridWh: 0,
      awayWh: 1250,
      totalWh: 1250,
      costCents: 0,
      solarSavingsCents: 0,
    }], "day");

    expect(merged.buckets[18].awayWh).toBe(1250);
    expect(merged.totalAwayWh).toBe(1250);
    expect(merged.totalChargedWh).toBe(1250);
  });

  it("maps month and year bucket numbers to zero-based response positions", () => {
    const monthResponse = responseWithBuckets(emptyBuckets(31));
    const monthMerged = mergeChargeHqStats(monthResponse, [{
      bucket: "15",
      solarWh: 0,
      batteryWh: 0,
      gridWh: 750,
      awayWh: 0,
      totalWh: 750,
      costCents: 0,
      solarSavingsCents: 0,
    }], "month");
    expect(monthMerged.buckets[14].gridWh).toBe(750);

    const yearResponse = responseWithBuckets(emptyBuckets(12));
    const yearMerged = mergeChargeHqStats(yearResponse, [{
      bucket: "10",
      solarWh: 250,
      batteryWh: 0,
      gridWh: 0,
      awayWh: 0,
      totalWh: 250,
      costCents: 0,
      solarSavingsCents: 0,
    }], "year");
    expect(yearMerged.buckets[9].solarWh).toBe(250);
  });

  it("uses numeric 15-minute day buckets directly", () => {
    const response = responseWithBuckets(emptyBuckets(96));
    const merged = mergeChargeHqStats(response, [{
      bucket: 9,
      solarWh: 1000,
      batteryWh: 500,
      gridWh: 1500,
      awayWh: 0,
      totalWh: 3000,
      costCents: 0,
      solarSavingsCents: 0,
    }], "day");

    expect(merged.buckets[9].totalWh).toBe(3000);
    expect(merged.selfPoweredPercent).toBe(50);
  });
});
