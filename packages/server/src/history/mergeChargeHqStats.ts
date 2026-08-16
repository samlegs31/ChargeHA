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
 * Merge exact Wh from the ChargeHQ archive into an already-built StatsResponse.
 *
 * HistoryRepository has already removed rows that overlap native E.V Solar
 * readings. ChargeHQ has no historical tariff price, so cost/savings values are
 * intentionally left untouched instead of being reconstructed with today's
 * tariff configuration.
 */
export function mergeChargeHqStats(
  response: StatsResponse,
  historyRows: readonly ChargeHqStatsRow[],
  period: ChargeHqStatsPeriod,
): StatsResponse {
  if (historyRows.length === 0) return response;

  const buckets = response.buckets.map((bucket) => ({ ...bucket }));
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
    bucket.totalWh += row.totalWh;
  });

  const totalSolarWh = buckets.reduce((sum, row) => sum + row.solarWh, 0);
  const totalBatteryWh = buckets.reduce((sum, row) => sum + row.batteryWh, 0);
  const totalGridWh = buckets.reduce((sum, row) => sum + row.gridWh, 0);
  const totalAwayWh = buckets.reduce((sum, row) => sum + row.awayWh, 0);
  const totalChargedWh = buckets.reduce((sum, row) => sum + row.totalWh, 0);
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
