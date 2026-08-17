import { sql } from "drizzle-orm";
import type {
  EnergyBucket,
  StatsBucket,
  StatsResponse,
} from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
import { HistoryRepository } from "../db/repositories/HistoryRepository.ts";
import { sqliteTimezoneOffset } from "../db/repositories/sqliteHelpers.ts";
import type { StatsService } from "../services/StatsService.ts";
import { mergeChargeHqStats } from "./mergeChargeHqStats.ts";

export type TotalStatsResponse = Omit<StatsResponse, "period"> & {
  period: "total";
};

function aggregateYearsQuery(vehicleId?: string) {
  if (vehicleId) return sql``;
  return sql`
    UNION
    SELECT substr(start_time_local, 1, 4) AS year
    FROM aggregate_ev_charge_history
    WHERE source = 'solarweb' AND at_home_wh > 0
  `;
}

async function availableYears(
  db: AppDatabase,
  tz: number,
  vehicleId?: string,
): Promise<number[]> {
  const offset = sqliteTimezoneOffset(tz);
  const nativeVehicle = vehicleId
    ? sql`AND vehicle_id = ${vehicleId}`
    : sql``;
  const archiveVehicle = vehicleId
    ? sql`AND vehicle_id = ${vehicleId}`
    : sql``;
  const rows = await db.db.all<{ year: string | null }>(sql`
    SELECT year FROM (
      SELECT strftime('%Y', timestamp, ${offset}) AS year
      FROM vehicle_charge_readings
      WHERE is_home = 1 ${nativeVehicle}
      UNION
      SELECT substr(start_time_local, 1, 4) AS year
      FROM vehicle_charge_history
      WHERE source = 'chargehq' AND at_home_wh > 0 ${archiveVehicle}
      ${aggregateYearsQuery(vehicleId)}
    )
    WHERE year IS NOT NULL AND length(year) = 4
    ORDER BY year
  `);
  return rows
    .map((row) => Number(row.year))
    .filter((year) => Number.isInteger(year) && year > 1900);
}

async function annualStats(
  db: AppDatabase,
  statsService: StatsService,
  year: number,
  tz: number,
  vehicleId?: string,
): Promise<StatsResponse> {
  const history = new HistoryRepository(db.db);
  const [native, historyRows] = await Promise.all([
    statsService.buildYearStats(year, tz, vehicleId),
    history.getChargeHqStatsYear(year, vehicleId),
  ]);
  return mergeChargeHqStats(native, historyRows, "year");
}

function chargingBucket(year: number, stats: StatsResponse): StatsBucket {
  return {
    label: String(year),
    solarWh: stats.totalSolarWh,
    batteryWh: stats.totalBatteryWh,
    gridWh: stats.totalGridWh,
    awayWh: 0,
    totalWh: stats.totalChargedWh,
    costCents: stats.totalCostCents ?? 0,
  };
}

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

export async function buildTotalStats(
  db: AppDatabase,
  statsService: StatsService,
  tz: number,
  vehicleId?: string,
): Promise<TotalStatsResponse> {
  const years = await availableYears(db, tz, vehicleId);
  const annual = await Promise.all(
    years.map((year) => annualStats(db, statsService, year, tz, vehicleId)),
  );
  const buckets = annual.map((stats, index) => chargingBucket(years[index], stats));
  const totalSolarWh = buckets.reduce((sum, row) => sum + row.solarWh, 0);
  const totalBatteryWh = buckets.reduce((sum, row) => sum + row.batteryWh, 0);
  const totalGridWh = buckets.reduce((sum, row) => sum + row.gridWh, 0);
  const totalChargedWh = totalSolarWh + totalBatteryWh + totalGridWh;
  const selfPoweredWh = totalSolarWh + totalBatteryWh;
  const selfPoweredPercent = totalChargedWh > 0
    ? Math.round((selfPoweredWh / totalChargedWh) * 100)
    : 0;
  const totalCostCents = buckets.reduce(
    (sum, row) => sum + (row.costCents ?? 0),
    0,
  );
  const evSolarSavingsCents = annual.reduce(
    (sum, stats) => sum + (stats.evSolarSavingsCents ?? 0),
    0,
  );
  const [currencySymbol, currencyCode] = await Promise.all([
    db.getConfig("currency_symbol"),
    db.getConfig("currency_code"),
  ]);
  const firstYear = years[0];
  const lastYear = years[years.length - 1];

  return {
    period: "total",
    startDate: firstYear ? `${firstYear}-01-01` : "",
    endDate: lastYear ? `${lastYear}-12-31` : "",
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
    selfPoweredPercent,
    totalCostCents,
    solarSavingsCents: evSolarSavingsCents,
    evSolarSavingsCents,
    currencySymbol: currencySymbol ?? "$",
    currencyCode: currencyCode ?? "AUD",
  };
}
