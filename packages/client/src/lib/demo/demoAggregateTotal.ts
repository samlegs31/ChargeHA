import type { EnergyBucket, StatsBucket, StatsResponse } from "@chargeha/shared";
import { aggregateYear } from "./demoAggregate.ts";
import { dateForOffset, parseDateKey } from "./demoDates.ts";
import type { DemoSeries } from "./series.ts";

export type DemoTotalStatsResponse = Omit<StatsResponse, "period"> & {
  period: "total";
};

function emptyEnergyBucket(label: string): EnergyBucket {
  return {
    label,
    solarProductionWh: 0,
    solarWh: 0,
    batteryChargeWh: 0,
    batteryDischargeWh: 0,
    solarToBatteryWh: 0,
    gridToBatteryWh: 0,
    gridWh: 0,
    totalWh: 0,
    costCents: 0,
    solarSavingsCents: 0,
  };
}

export function aggregateTotal(
  series: DemoSeries,
  vehicleId?: string,
  now?: Date,
): DemoTotalStatsResponse {
  const years = [...new Set(
    series.days.map((day) =>
      parseDateKey(dateForOffset(day.offset, now)).getFullYear()
    ),
  )].sort((a, b) => a - b);
  const annual = years.map((year) => aggregateYear(series, year, vehicleId, now));
  const buckets: StatsBucket[] = annual.map((stats, index) => ({
    label: String(years[index]),
    solarWh: stats.totalSolarWh,
    batteryWh: stats.totalBatteryWh,
    gridWh: stats.totalGridWh,
    awayWh: 0,
    totalWh: stats.totalSolarWh + stats.totalBatteryWh + stats.totalGridWh,
    costCents: stats.totalCostCents ?? 0,
  }));
  const totalSolarWh = buckets.reduce((sum, row) => sum + row.solarWh, 0);
  const totalBatteryWh = buckets.reduce((sum, row) => sum + row.batteryWh, 0);
  const totalGridWh = buckets.reduce((sum, row) => sum + row.gridWh, 0);
  const totalChargedWh = totalSolarWh + totalBatteryWh + totalGridWh;
  const selfPoweredWh = totalSolarWh + totalBatteryWh;
  const evSolarSavingsCents = annual.reduce(
    (sum, stats) => sum + (stats.evSolarSavingsCents ?? 0),
    0,
  );
  return {
    period: "total",
    startDate: years[0] ? `${years[0]}-01-01` : "",
    endDate: years.length > 0 ? `${years[years.length - 1]}-12-31` : "",
    energyBuckets: buckets.map((row) => emptyEnergyBucket(row.label)),
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
    totalChargedWh,
    totalSolarWh,
    totalBatteryWh,
    totalGridWh,
    totalAwayWh: 0,
    selfPoweredPercent: totalChargedWh > 0
      ? Math.round((selfPoweredWh / totalChargedWh) * 100)
      : 0,
    totalCostCents: buckets.reduce(
      (sum, row) => sum + (row.costCents ?? 0),
      0,
    ),
    solarSavingsCents: evSolarSavingsCents,
    evSolarSavingsCents,
    currencySymbol: annual[0]?.currencySymbol ?? "$",
    currencyCode: annual[0]?.currencyCode ?? "AUD",
  };
}
