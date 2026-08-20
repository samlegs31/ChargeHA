import { sql } from "drizzle-orm";
import type { DayOfWeek, StatsResponse } from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
import { getApplicablePeriodForTime } from "../lib/Tariffs.ts";

interface HistoricalChargeRow {
  startTimeLocal: string;
  intervalSeconds: number;
  gridWh: number;
  solarWh: number;
}

const DAY_ABBRS: DayOfWeek[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function parseLocalTimestamp(value: string): number | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) return null;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  );
}

function rateAtLocalWallClock(
  timestampMs: number,
  periods: Awaited<ReturnType<AppDatabase["getTariffPeriods"]>>,
  defaultRate: number,
): number {
  const date = new Date(timestampMs);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const day = DAY_ABBRS[date.getUTCDay()];
  const period = getApplicablePeriodForTime(minutes, day, periods);
  return period?.ratePerKwh ?? defaultRate;
}

function weightedRates(
  startTimeLocal: string,
  intervalSeconds: number,
  periods: Awaited<ReturnType<AppDatabase["getTariffPeriods"]>>,
  defaultRate: number,
): Map<number, number> {
  const startMs = parseLocalTimestamp(startTimeLocal);
  if (startMs === null || intervalSeconds <= 0) return new Map();

  const rates = new Map<number, number>();
  let cursorMs = startMs;
  let remaining = intervalSeconds;

  while (remaining > 0) {
    const date = new Date(cursorMs);
    const secondsIntoMinute = date.getUTCSeconds();
    const seconds = Math.min(remaining, 60 - secondsIntoMinute);
    const rate = rateAtLocalWallClock(cursorMs, periods, defaultRate);
    rates.set(rate, (rates.get(rate) ?? 0) + seconds);
    cursorMs += seconds * 1000;
    remaining -= seconds;
  }

  return rates;
}

function bucketIndex(
  response: StatsResponse,
  startTimeLocal: string,
): number | null {
  const match = startTimeLocal.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/,
  );
  if (!match) return null;

  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (response.period === "year") return month - 1;
  if (response.period === "month") return day - 1;
  if (response.period === "day") {
    const detailed = response.buckets.some((bucket) => bucket.label.includes(":"));
    return detailed ? hour * 4 + Math.floor(minute / 15) : hour;
  }
  return null;
}

async function selectedChargeHqRows(
  db: AppDatabase,
  startDate: string,
  endDate: string,
  vehicleId?: string,
): Promise<HistoricalChargeRow[]> {
  const startLocal = `${startDate} 00:00:00`;
  const endExclusive = `${nextDate(endDate)} 00:00:00`;
  const vehicleFilter = vehicleId
    ? sql`AND h.vehicle_id = ${vehicleId}`
    : sql``;
  const aggregateSolarWebExclusion = vehicleId
    ? sql``
    : sql`
      AND NOT EXISTS (
        SELECT 1 FROM aggregate_ev_charge_history sw
        WHERE sw.source = 'solarweb'
          AND sw.start_time_utc < datetime(
            h.start_time_utc, '+' || h.interval_seconds || ' seconds'
          )
          AND datetime(
            sw.start_time_utc, '+' || sw.interval_seconds || ' seconds'
          ) > h.start_time_utc
      )
    `;

  const rows = await db.db.all<{
    start_time_local: string;
    interval_seconds: number;
    grid_wh: number;
    solar_wh: number;
  }>(sql`
    SELECT
      h.start_time_local,
      h.interval_seconds,
      h.grid_wh,
      h.solar_wh
    FROM vehicle_charge_history h
    WHERE h.source = 'chargehq'
      AND h.at_home_wh > 0
      AND h.start_time_local >= ${startLocal}
      AND h.start_time_local < ${endExclusive}
      ${vehicleFilter}
      AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = h.vehicle_id)
      AND h.start_time_utc < COALESCE(
        (SELECT MIN(r.timestamp) FROM vehicle_charge_readings r
         WHERE r.vehicle_id = h.vehicle_id),
        '9999-12-31 23:59:59'
      )
      AND (
        (SELECT v.home_charging_source FROM vehicles v WHERE v.id = h.vehicle_id)
          = 'chargehq'
        OR (
          (SELECT v.home_charging_source FROM vehicles v WHERE v.id = h.vehicle_id)
            IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM vehicle_charge_history sw
            WHERE sw.source = 'solarweb'
              AND sw.vehicle_id = h.vehicle_id
              AND sw.at_home_wh > 0
              AND sw.start_time_utc < datetime(
                h.start_time_utc, '+' || h.interval_seconds || ' seconds'
              )
              AND datetime(
                sw.start_time_utc, '+' || sw.interval_seconds || ' seconds'
              ) > h.start_time_utc
          )
          ${aggregateSolarWebExclusion}
        )
      )
    ORDER BY h.start_time_local
  `);

  return rows.map((row) => ({
    startTimeLocal: row.start_time_local,
    intervalSeconds: Number(row.interval_seconds),
    gridWh: Number(row.grid_wh ?? 0),
    solarWh: Number(row.solar_wh ?? 0),
  }));
}

/**
 * Apply today's configured tariff schedule retrospectively to selected
 * ChargeHQ home-history intervals. ChargeHQ has real 15-minute local timestamps,
 * so peak/off-peak boundaries can be reconstructed. Solar.web is deliberately
 * excluded because its Wattpilot archive is only a daily aggregate anchored at
 * noon and therefore has no trustworthy charging time.
 */
export async function applyHistoricalChargeHqTariffs(
  db: AppDatabase,
  response: StatsResponse,
  vehicleId?: string,
): Promise<StatsResponse> {
  if (response.period === "total" || !response.startDate || !response.endDate) {
    return response;
  }

  const [rows, periods, defaultRateRaw] = await Promise.all([
    selectedChargeHqRows(db, response.startDate, response.endDate, vehicleId),
    db.getTariffPeriods(),
    db.getConfig("default_rate_per_kwh"),
  ]);
  const defaultRate = Number(defaultRateRaw ?? 0) || 0;
  if (rows.length === 0 || (periods.length === 0 && defaultRate === 0)) {
    return response;
  }

  const buckets = response.buckets.map((bucket) => ({ ...bucket }));
  let historicalSolarSavingsCents = 0;

  for (const row of rows) {
    const index = bucketIndex(response, row.startTimeLocal);
    if (index === null || index < 0 || index >= buckets.length) continue;

    const rates = weightedRates(
      row.startTimeLocal,
      row.intervalSeconds,
      periods,
      defaultRate,
    );
    const secondsTotal = [...rates.values()].reduce((sum, seconds) => sum + seconds, 0);
    if (secondsTotal <= 0) continue;

    let costCents = 0;
    let solarSavingsCents = 0;
    for (const [rate, seconds] of rates) {
      const share = seconds / secondsTotal;
      costCents += row.gridWh * share / 1000 * rate * 100;
      solarSavingsCents += row.solarWh * share / 1000 * rate * 100;
    }

    buckets[index].costCents = (buckets[index].costCents ?? 0) + costCents;
    historicalSolarSavingsCents += solarSavingsCents;
  }

  return {
    ...response,
    buckets,
    totalCostCents: buckets.reduce(
      (sum, bucket) => sum + (bucket.costCents ?? 0),
      0,
    ),
    solarSavingsCents: (response.solarSavingsCents ?? 0) +
      historicalSolarSavingsCents,
    evSolarSavingsCents: (response.evSolarSavingsCents ?? 0) +
      historicalSolarSavingsCents,
  };
}
