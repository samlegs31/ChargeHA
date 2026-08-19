import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, sql } from "drizzle-orm";
import {
  aggregateEvChargeHistory,
  vehicleChargeHistory,
} from "../HistorySchema.ts";
import type { ChargeHqHistoryRow } from "../../history/ChargeHqCsv.ts";

export interface VehicleChargeHistoryRowInput {
  source: string;
  externalId: string;
  startTimeUtc: string;
  startTimeLocal: string;
  intervalSeconds: number;
  chargedWh: number;
  solarWh: number;
  batteryWh: number;
  gridWh: number;
  awayWh: number;
  atHomeWh: number;
}

export interface HistoryImportResult {
  insertedRows: number;
  skippedRows: number;
  duplicateRows: number;
  overlapRows: number;
}

export interface HistoryCoverage {
  rowCount: number;
  firstStartTimeLocal: string | null;
  lastStartTimeLocal: string | null;
  chargedWh: number;
}

export interface HistoryStatsRow {
  bucket: string;
  solarWh: number;
  batteryWh: number;
  gridWh: number;
  awayWh: number;
  totalWh: number;
  costCents: number;
  solarSavingsCents: number;
}

export interface HistoryDetailedStatsRow
  extends Omit<HistoryStatsRow, "bucket"> {
  bucket: number;
}

interface RawHistoryStatsRow {
  bucket: string;
  solar_wh: number | null;
  battery_wh: number | null;
  grid_wh: number | null;
  away_wh: number | null;
  total_wh: number | null;
}

interface LocalRange {
  start: string;
  endExclusive: string;
}

function dayRange(date: string): LocalRange {
  const end = new Date(`${date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    start: `${date} 00:00:00`,
    endExclusive: `${end.toISOString().slice(0, 10)} 00:00:00`,
  };
}

function monthRange(year: number, month: number): LocalRange {
  const start = `${year}-${String(month).padStart(2, "0")}-01 00:00:00`;
  const end = new Date(Date.UTC(year, month, 1));
  return {
    start,
    endExclusive: `${end.toISOString().slice(0, 10)} 00:00:00`,
  };
}

function yearRange(year: number): LocalRange {
  return {
    start: `${year}-01-01 00:00:00`,
    endExclusive: `${year + 1}-01-01 00:00:00`,
  };
}

export class HistoryRepository {
  constructor(private db: BetterSQLite3Database) {}

  /** Import archived history that is attributable to a specific vehicle. */
  async importRows(
    vehicleId: string,
    rows: readonly VehicleChargeHistoryRowInput[],
  ): Promise<HistoryImportResult> {
    const cutoffRows = await this.db.all<{ timestamp: string | null }>(sql`
      SELECT MIN(timestamp) AS timestamp
      FROM vehicle_charge_readings
      WHERE vehicle_id = ${vehicleId}
    `);
    const nativeCutoff = cutoffRows[0]?.timestamp ?? null;
    const importableRows = this.beforeNativeCutoff(rows, nativeCutoff);
    const overlapRows = rows.length - importableRows.length;
    const insertedRows = this.db.transaction((tx) =>
      importableRows.reduce((inserted, row) => {
        const result = tx.insert(vehicleChargeHistory).values({
          ...row,
          vehicleId,
        }).onConflictDoNothing().run();
        return inserted + result.changes;
      }, 0)
    );
    return this.importResult(rows.length, importableRows.length, insertedRows, overlapRows);
  }

  async importChargeHqRows(
    vehicleId: string,
    rows: readonly ChargeHqHistoryRow[],
  ): Promise<HistoryImportResult> {
    return await this.importRows(vehicleId, rows);
  }

  /** Legacy installation-level archive kept for previously imported data. */
  async importAggregateRows(
    rows: readonly VehicleChargeHistoryRowInput[],
  ): Promise<HistoryImportResult> {
    const cutoffRows = await this.db.all<{ timestamp: string | null }>(sql`
      SELECT MIN(timestamp) AS timestamp FROM vehicle_charge_readings
    `);
    const nativeCutoff = cutoffRows[0]?.timestamp ?? null;
    const importableRows = this.beforeNativeCutoff(rows, nativeCutoff);
    const overlapRows = rows.length - importableRows.length;
    const insertedRows = this.db.transaction((tx) =>
      importableRows.reduce((inserted, row) => {
        const result = tx.insert(aggregateEvChargeHistory).values(row)
          .onConflictDoNothing().run();
        return inserted + result.changes;
      }, 0)
    );
    return this.importResult(rows.length, importableRows.length, insertedRows, overlapRows);
  }

  async getCoverage(
    source: string,
    vehicleId: string,
  ): Promise<HistoryCoverage> {
    const rows = await this.db.select({
      rowCount: sql<number>`count(*)`,
      firstStartTimeLocal: sql<string | null>`min(${vehicleChargeHistory.startTimeLocal})`,
      lastStartTimeLocal: sql<string | null>`max(${vehicleChargeHistory.startTimeLocal})`,
      chargedWh: sql<number>`coalesce(sum(${vehicleChargeHistory.chargedWh}), 0)`,
    }).from(vehicleChargeHistory).where(and(
      eq(vehicleChargeHistory.source, source),
      eq(vehicleChargeHistory.vehicleId, vehicleId),
    ));
    return this.coverageRow(rows[0]);
  }

  async getAggregateCoverage(source: string): Promise<HistoryCoverage> {
    const rows = await this.db.select({
      rowCount: sql<number>`count(*)`,
      firstStartTimeLocal: sql<string | null>`min(${aggregateEvChargeHistory.startTimeLocal})`,
      lastStartTimeLocal: sql<string | null>`max(${aggregateEvChargeHistory.startTimeLocal})`,
      chargedWh: sql<number>`coalesce(sum(${aggregateEvChargeHistory.chargedWh}), 0)`,
    }).from(aggregateEvChargeHistory).where(
      eq(aggregateEvChargeHistory.source, source),
    );
    return this.coverageRow(rows[0]);
  }

  async getChargeHqStatsDay(
    date: string,
    vehicleId?: string,
  ): Promise<HistoryStatsRow[]> {
    const archive = this.archiveRows(vehicleId, dayRange(date));
    const rows = await this.db.all<RawHistoryStatsRow>(sql`
      WITH archive AS (${archive})
      SELECT substr(start_time_local, 12, 2) AS bucket,
        SUM(solar_wh) AS solar_wh, SUM(battery_wh) AS battery_wh,
        SUM(grid_wh) AS grid_wh, SUM(away_wh) AS away_wh,
        SUM(charged_wh) AS total_wh
      FROM archive GROUP BY bucket ORDER BY bucket
    `);
    return rows.map((row) => this.mapStatsRow(row));
  }

  async getChargeHqStatsDayDetailed(
    date: string,
    vehicleId?: string,
  ): Promise<HistoryDetailedStatsRow[]> {
    const archive = this.archiveRows(vehicleId, dayRange(date));
    const rows = await this.db.all<RawHistoryStatsRow>(sql`
      WITH archive AS (${archive})
      SELECT CAST(substr(start_time_local, 12, 2) AS INTEGER) * 4
          + CAST(substr(start_time_local, 15, 2) AS INTEGER) / 15 AS bucket,
        SUM(solar_wh) AS solar_wh, SUM(battery_wh) AS battery_wh,
        SUM(grid_wh) AS grid_wh, SUM(away_wh) AS away_wh,
        SUM(charged_wh) AS total_wh
      FROM archive GROUP BY bucket ORDER BY bucket
    `);
    return rows.map((row) => ({ ...this.mapStatsRow(row), bucket: Number(row.bucket) }));
  }

  async getChargeHqStatsMonth(
    year: number,
    month: number,
    vehicleId?: string,
  ): Promise<HistoryStatsRow[]> {
    const archive = this.archiveRows(vehicleId, monthRange(year, month));
    const rows = await this.db.all<RawHistoryStatsRow>(sql`
      WITH archive AS (${archive})
      SELECT substr(start_time_local, 9, 2) AS bucket,
        SUM(solar_wh) AS solar_wh, SUM(battery_wh) AS battery_wh,
        SUM(grid_wh) AS grid_wh, SUM(away_wh) AS away_wh,
        SUM(charged_wh) AS total_wh
      FROM archive GROUP BY bucket ORDER BY bucket
    `);
    return rows.map((row) => this.mapStatsRow(row));
  }

  async getChargeHqStatsYear(
    year: number,
    vehicleId?: string,
  ): Promise<HistoryStatsRow[]> {
    const archive = this.archiveRows(vehicleId, yearRange(year));
    const rows = await this.db.all<RawHistoryStatsRow>(sql`
      WITH archive AS (${archive})
      SELECT substr(start_time_local, 6, 2) AS bucket,
        SUM(solar_wh) AS solar_wh, SUM(battery_wh) AS battery_wh,
        SUM(grid_wh) AS grid_wh, SUM(away_wh) AS away_wh,
        SUM(charged_wh) AS total_wh
      FROM archive GROUP BY bucket ORDER BY bucket
    `);
    return rows.map((row) => this.mapStatsRow(row));
  }

  private archiveRows(vehicleId: string | undefined, range: LocalRange) {
    return vehicleId
      ? this.vehicleArchiveRows(vehicleId, range)
      : this.globalArchiveRows(range);
  }

  private vehicleArchiveRows(vehicleId: string, range: LocalRange) {
    return sql`
      ${this.vehicleHomeRows(vehicleId, range)}
      UNION ALL
      ${this.vehicleAwayRows(vehicleId, range)}
    `;
  }

  private globalArchiveRows(range: LocalRange) {
    return sql`
      ${this.globalHomeRows(range)}
      UNION ALL
      ${this.globalAwayRows(range)}
      UNION ALL
      ${this.legacyAggregateRows(range)}
    `;
  }

  /**
   * Home rows follow the vehicle's explicit source selection. Vehicles created
   * before this setting existed keep the historical behaviour: Solar.web wins
   * only where it overlaps ChargeHQ, otherwise ChargeHQ remains a fallback.
   */
  private vehicleHomeRows(vehicleId: string, range: LocalRange) {
    return sql`
      SELECT h.start_time_utc, h.start_time_local, h.interval_seconds,
        h.at_home_wh AS charged_wh, h.solar_wh, h.battery_wh, h.grid_wh,
        0.0 AS away_wh, h.at_home_wh
      FROM vehicle_charge_history h
      WHERE h.vehicle_id = ${vehicleId}
        AND h.source IN ('chargehq', 'solarweb')
        AND h.start_time_local >= ${range.start}
        AND h.start_time_local < ${range.endExclusive}
        AND h.at_home_wh > 0
        ${this.nativeVehiclePriorityFilter()}
        AND (
          (SELECT v.home_charging_source FROM vehicles v WHERE v.id = h.vehicle_id) IS NULL
          OR h.source = (
            SELECT v.home_charging_source FROM vehicles v WHERE v.id = h.vehicle_id
          )
        )
        AND (
          (SELECT v.home_charging_source FROM vehicles v WHERE v.id = h.vehicle_id) IS NOT NULL
          OR h.source = 'solarweb'
          OR NOT EXISTS (
            SELECT 1 FROM vehicle_charge_history sw
            WHERE sw.source = 'solarweb' AND sw.vehicle_id = h.vehicle_id
              ${this.vehicleOverlapFilter()}
          )
        )
    `;
  }

  private vehicleAwayRows(vehicleId: string, range: LocalRange) {
    return sql`
      SELECT h.start_time_utc, h.start_time_local, h.interval_seconds,
        h.away_wh AS charged_wh, 0.0 AS solar_wh, 0.0 AS battery_wh,
        0.0 AS grid_wh, h.away_wh, 0.0 AS at_home_wh
      FROM vehicle_charge_history h
      WHERE h.vehicle_id = ${vehicleId}
        AND h.source IN ('chargehq', 'vehicle-history')
        AND h.start_time_local >= ${range.start}
        AND h.start_time_local < ${range.endExclusive}
        AND h.away_wh > 0
        ${this.nativeVehiclePriorityFilter()}
        ${this.selectedHomeOverlapExclusion()}
        AND (h.source = 'vehicle-history' OR NOT EXISTS (
          SELECT 1 FROM vehicle_charge_history vh
          WHERE vh.source = 'vehicle-history' AND vh.vehicle_id = h.vehicle_id
            AND vh.start_time_utc < datetime(
              h.start_time_utc, '+' || h.interval_seconds || ' seconds'
            )
            AND datetime(
              vh.start_time_utc, '+' || vh.interval_seconds || ' seconds'
            ) > h.start_time_utc
        ))
    `;
  }

  private globalHomeRows(range: LocalRange) {
    return sql`
      SELECT h.start_time_utc, h.start_time_local, h.interval_seconds,
        h.at_home_wh AS charged_wh, h.solar_wh, h.battery_wh, h.grid_wh,
        0.0 AS away_wh, h.at_home_wh
      FROM vehicle_charge_history h
      WHERE h.source IN ('chargehq', 'solarweb')
        AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = h.vehicle_id)
        AND h.start_time_local >= ${range.start}
        AND h.start_time_local < ${range.endExclusive}
        AND h.at_home_wh > 0
        ${this.nativeVehiclePriorityFilter()}
        AND (
          (SELECT v.home_charging_source FROM vehicles v WHERE v.id = h.vehicle_id) IS NULL
          OR h.source = (
            SELECT v.home_charging_source FROM vehicles v WHERE v.id = h.vehicle_id
          )
        )
        AND (
          (SELECT v.home_charging_source FROM vehicles v WHERE v.id = h.vehicle_id) IS NOT NULL
          OR h.source = 'solarweb'
          OR (
            NOT EXISTS (
              SELECT 1 FROM vehicle_charge_history sw
              WHERE sw.source = 'solarweb' AND sw.vehicle_id = h.vehicle_id
                ${this.vehicleOverlapFilter()}
            )
            AND NOT EXISTS (
              SELECT 1 FROM aggregate_ev_charge_history sw
              WHERE sw.source = 'solarweb'
                ${this.aggregateOverlapWithVehicleFilter()}
            )
          )
        )
    `;
  }

  private globalAwayRows(range: LocalRange) {
    return sql`
      SELECT h.start_time_utc, h.start_time_local, h.interval_seconds,
        h.away_wh AS charged_wh, 0.0 AS solar_wh, 0.0 AS battery_wh,
        0.0 AS grid_wh, h.away_wh, 0.0 AS at_home_wh
      FROM vehicle_charge_history h
      WHERE h.source IN ('chargehq', 'vehicle-history')
        AND h.start_time_local >= ${range.start}
        AND h.start_time_local < ${range.endExclusive}
        AND h.away_wh > 0
        ${this.nativeVehiclePriorityFilter()}
        AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = h.vehicle_id)
        ${this.selectedHomeOverlapExclusion()}
        AND (h.source = 'vehicle-history' OR NOT EXISTS (
          SELECT 1 FROM vehicle_charge_history vh
          WHERE vh.source = 'vehicle-history' AND vh.vehicle_id = h.vehicle_id
            AND vh.start_time_utc < datetime(
              h.start_time_utc, '+' || h.interval_seconds || ' seconds'
            )
            AND datetime(
              vh.start_time_utc, '+' || vh.interval_seconds || ' seconds'
            ) > h.start_time_utc
        ))
    `;
  }

  private legacyAggregateRows(range: LocalRange) {
    return sql`
      SELECT a.start_time_utc, a.start_time_local, a.interval_seconds,
        a.charged_wh, a.solar_wh, a.battery_wh, a.grid_wh,
        0.0 AS away_wh, a.at_home_wh
      FROM aggregate_ev_charge_history a
      WHERE a.source = 'solarweb'
        AND a.start_time_local >= ${range.start}
        AND a.start_time_local < ${range.endExclusive}
        ${this.nativeAggregatePriorityFilter()}
        AND NOT EXISTS (
          SELECT 1 FROM vehicle_charge_history h
          WHERE h.source IN ('chargehq', 'solarweb')
            AND h.at_home_wh > 0
            AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = h.vehicle_id)
            AND (
              (SELECT v.home_charging_source FROM vehicles v WHERE v.id = h.vehicle_id) IS NULL
              OR h.source = (
                SELECT v.home_charging_source FROM vehicles v WHERE v.id = h.vehicle_id
              )
            )
            AND h.start_time_utc < datetime(
              a.start_time_utc, '+' || a.interval_seconds || ' seconds'
            )
            AND datetime(
              h.start_time_utc, '+' || h.interval_seconds || ' seconds'
            ) > a.start_time_utc
        )
    `;
  }

  private vehicleOverlapFilter() {
    return sql`
      AND sw.start_time_utc < datetime(
        h.start_time_utc, '+' || h.interval_seconds || ' seconds'
      )
      AND datetime(
        sw.start_time_utc, '+' || sw.interval_seconds || ' seconds'
      ) > h.start_time_utc
    `;
  }

  private aggregateOverlapWithVehicleFilter() {
    return sql`
      AND sw.start_time_utc < datetime(
        h.start_time_utc, '+' || h.interval_seconds || ' seconds'
      )
      AND datetime(
        sw.start_time_utc, '+' || sw.interval_seconds || ' seconds'
      ) > h.start_time_utc
    `;
  }

  /**
   * Tesla/vehicle archive rows are External only when they do not overlap the
   * selected home source for that same VIN. Before a source is configured,
   * either recognised home source may suppress an external duplicate.
   */
  private selectedHomeOverlapExclusion() {
    return sql`
      AND (
        h.source <> 'vehicle-history'
        OR NOT EXISTS (
          SELECT 1 FROM vehicle_charge_history home
          WHERE home.vehicle_id = h.vehicle_id
            AND home.source IN ('chargehq', 'solarweb')
            AND home.at_home_wh > 0
            AND (
              (SELECT v.home_charging_source FROM vehicles v WHERE v.id = h.vehicle_id) IS NULL
              OR home.source = (
                SELECT v.home_charging_source FROM vehicles v WHERE v.id = h.vehicle_id
              )
            )
            AND home.start_time_utc < datetime(
              h.start_time_utc, '+' || h.interval_seconds || ' seconds'
            )
            AND datetime(
              home.start_time_utc, '+' || home.interval_seconds || ' seconds'
            ) > h.start_time_utc
        )
      )
    `;
  }

  private nativeVehiclePriorityFilter() {
    return sql`
      AND h.start_time_utc < COALESCE(
        (SELECT MIN(v.timestamp) FROM vehicle_charge_readings v
         WHERE v.vehicle_id = h.vehicle_id),
        '9999-12-31 23:59:59'
      )
    `;
  }

  private nativeAggregatePriorityFilter() {
    return sql`
      AND a.start_time_utc < COALESCE(
        (SELECT MIN(v.timestamp) FROM vehicle_charge_readings v),
        '9999-12-31 23:59:59'
      )
    `;
  }

  private beforeNativeCutoff(
    rows: readonly VehicleChargeHistoryRowInput[],
    nativeCutoff: string | null,
  ): VehicleChargeHistoryRowInput[] {
    if (nativeCutoff === null) return [...rows];
    const cutoffMs = Date.parse(this.asUtcIso(nativeCutoff));
    return rows.filter((row) =>
      Date.parse(this.asUtcIso(row.startTimeUtc)) < cutoffMs
    );
  }

  private asUtcIso(value: string): string {
    if (value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value)) return value;
    return `${value.replace(" ", "T")}Z`;
  }

  private importResult(
    totalRows: number,
    importableRows: number,
    insertedRows: number,
    overlapRows: number,
  ): HistoryImportResult {
    const duplicateRows = importableRows - insertedRows;
    return {
      insertedRows,
      duplicateRows,
      overlapRows,
      skippedRows: totalRows - insertedRows,
    };
  }

  private coverageRow(row: {
    rowCount: number;
    firstStartTimeLocal: string | null;
    lastStartTimeLocal: string | null;
    chargedWh: number;
  } | undefined): HistoryCoverage {
    return {
      rowCount: Number(row?.rowCount ?? 0),
      firstStartTimeLocal: row?.firstStartTimeLocal ?? null,
      lastStartTimeLocal: row?.lastStartTimeLocal ?? null,
      chargedWh: Number(row?.chargedWh ?? 0),
    };
  }

  private mapStatsRow(row: RawHistoryStatsRow): HistoryStatsRow {
    return {
      bucket: String(row.bucket),
      solarWh: Number(row.solar_wh ?? 0),
      batteryWh: Number(row.battery_wh ?? 0),
      gridWh: Number(row.grid_wh ?? 0),
      awayWh: Number(row.away_wh ?? 0),
      totalWh: Number(row.total_wh ?? 0),
      costCents: 0,
      solarSavingsCents: 0,
    };
  }
}
