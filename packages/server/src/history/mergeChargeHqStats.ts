import type { StatsResponse } from "@chargeha/shared";
import type {
  HistoryDetailedStatsRow,
  HistoryStatsRow,
} from "../db/repositories/HistoryRepository.ts";

export type ChargeHqStatsPeriod = "day" | "month" | "year";

type ChargeHqStatsRow = HistoryStatsRow | HistoryDetailedStatsRow;

function rowBucketIndex(
  row: ChargeHqStatsRow,
  period: ChargeHqStatsPeriod,
): number {
  const raw = Number(row.bucket);
  return period === "day" ? raw : raw - 1;
}

/**
 * Merge archived vehicle charging into the native response. Solar.web history
 * contributes home charging only; vehicle-attributed sources may also carry
 * away charging. HistoryRepository has already removed rows that overlap native
 * E.V Solar readings. Historical tariff values are intentionally left at zero.
 *
 * `totalWh` is always rebuilt from the four source components. This keeps the
 * public Stats invariant exact even when an imported archive contains small
 * source/total rounding differences.
 */
export function mergeChargeHqStats(
  response: StatsResponse,
  historyRows: readonly ChargeHqStatsRow[],
  period: ChargeHqStatsPeriod,
): StatsResponse {
  const buckets = response.buckets.map((bucket) => ({
    ...bucket,
    totalWh: bucket.solarWh + bucket.batteryWh + bucket.gridWh + bucket.awayWh,
  }));

  historyRows.forEach((row) => {
    const index = rowBucketIndex(row, period);
    if (!Number.isInteger(index) || index < 0 || index >= buckets.length) {
      return;
    }
    const bucket = buckets[index];
    bucket.solarWh += row.solarWh;
    bucket.batteryWh += row.batteryWh;
    bucket.gridWh += row.gridWh;
    bucket.awayWh += row.awayWh;
    bucket.totalWh = bucket.solarWh + bucket.batteryWh + bucket.gridWh +
      bucket.awayWh;
  });

  const totalSolarWh = buckets.reduce((sum, row) => sum + row.solarWh, 0);
  const totalBatteryWh = buckets.reduce((sum, row) => sum + row.batteryWh, 0);
  const totalGridWh = buckets.reduce((sum, row) => sum + row.gridWh, 0);
  const totalAwayWh = buckets.reduce((sum, row) => sum + row.awayWh, 0);
  const totalChargedWh = totalSolarWh + totalBatteryWh + totalGridWh +
    totalAwayWh;
  const homeChargedWh = totalSolarWh + totalBatteryWh + totalGridWh;
  const selfPoweredPercent = homeChargedWh > 0
    ? Math.round(((totalSolarWh + totalBatteryWh) / homeChargedWh) * 100)
    : 0;
  const totalCostCents = buckets.reduce(
    (sum, row) => sum + (row.costCents ?? 0),
    0,
  );

  return {
    ...response,
    buckets,
    totalSolarWh,
    totalBatteryWh,
    totalGridWh,
    totalAwayWh,
    totalChargedWh,
    selfPoweredPercent,
    totalCostCents,
  };
}
