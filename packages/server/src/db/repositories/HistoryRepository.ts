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

  /**
   * Import installation-level EV charging history. Solar.web Wattpilot rows
   * belong here because they describe energy delivered to EVs without knowing
   * which vehicle received it.
   */
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
    const archive = this.archiveRows(vehicleId);
    const rows = await this.db.all<RawHistoryStatsRow>(sql`
      WITH archive AS (${archive})
      SELECT
        substr(start_time_local, 12, 2) AS bucket,
        SUM(solar_wh) AS solar_wh,
        SUM(battery_wh) AS battery_wh,
        SUM(grid_wh) AS grid_wh,
        SUM(away_wh) AS away_wh,
        SUM(charged_wh) AS total_wh
      FROM archive
      WHERE substr(start_time_local, 1, 10) = ${date}
      GROUP BY bucket ORDER BY bucket
    `);
    return rows.map((row) => this.mapStatsRow(row));
  }

  async getChargeHqStatsDayDetailed(
    date: string,
    vehicleId?: string,
  ): Promise<HistoryDetailedStatsRow[]> {
    const archive = this.archiveRows(vehicleId);
    const rows = await this.db.all<RawHistoryStatsRow>(sql`
      WITH archive AS (${archive})
      SELECT
        CAST(substr(start_time_local, 12, 2) AS INTEGER) * 4
          + CAST(substr(start_time_local, 15, 2) AS INTEGER) / 15 AS bucket,
        SUM(solar_wh) AS solar_wh,
        SUM(battery_wh) AS battery_wh,
        SUM(grid_wh) AS grid_wh,
        SUM(away_wh) AS away_wh,
        SUM(charged_wh) AS total_wh
      FROM archive
      WHERE substr(start_time_local, 1, 10) = ${date}
      GROUP BY bucket ORDER BY bucket
    `);
    return rows.map((row) => ({ ...this.mapStatsRow(row), bucket: Number(row.bucket) }));
  }

  async getChargeHqStatsMonth(
    year: number,
    month: number,
    vehicleId?: string,
  ): Promise<HistoryStatsRow[]> {
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const archive = this.archiveRows(vehicleId);
    const rows = await this.db.all<RawHistoryStatsRow>(sql`
      WITH archive AS (${archive})
      SELECT
        substr(start_time_local, 9, 2) AS bucket,
        SUM(solar_wh) AS solar_wh,
        SUM(battery_wh) AS battery_wh,
        SUM(grid_wh) AS grid_wh,
        SUM(away_wh) AS away_wh,
        SUM(charged_wh) AS total_wh
      FROM archive
      WHERE substr(start_time_local, 1, 7) = ${yearMonth}
      GROUP BY bucket ORDER BY bucket
    `);
    return rows.map((row) => this.mapStatsRow(row));
  }

  async getChargeHqStatsYear(
    year: number,
    vehicleId?: string,
  ): Promise<HistoryStatsRow[]> {
    const archive = this.archiveRows(vehicleId);
    const rows = await this.db.all<RawHistoryStatsRow>(sql`
      WITH archive AS (${archive})
      SELECT
        substr(start_time_local, 6, 2) AS bucket,
        SUM(solar_wh) AS solar_wh,
        SUM(battery_wh) AS battery_wh,
        SUM(grid_wh) AS grid_wh,
        SUM(away_wh) AS away_wh,
        SUM(charged_wh) AS total_wh
      FROM archive
      WHERE substr(start_time_local, 1, 4) = ${String(year)}
      GROUP BY bucket ORDER BY bucket
    `);
    return rows.map((row) => this.mapStatsRow(row));
  }

  /**
   * Per-vehicle Stats only use vehicle-attributed archives. Global Stats also
   * add Solar.web's installation-level Wattpilot history. ChargeHQ away energy
   * is always retained, while ChargeHQ home intervals are suppressed whenever
   * an overlapping Solar.web interval exists so the same home charge is not
   * counted twice.
   */
  private archiveRows(vehicleId?: string) {
    if (vehicleId) {
      return sql`
        SELECT h.start_time_utc, h.start_time_local, h.interval_seconds,
          h.charged_wh, h.solar_wh, h.battery_wh, h.grid_wh, h.away_wh, h.at_home_wh
        FROM vehicle_charge_history h
        WHERE h.source = 'chargehq'
          AND h.vehicle_id = ${vehicleId}
          ${this.nativeVehiclePriorityFilter()}
      `;
    }
    return sql`
      SELECT h.start_time_utc, h.start_time_local, h.interval_seconds,
        h.charged_wh, h.solar_wh, h.battery_wh, h.grid_wh, h.away_wh, h.at_home_wh
      FROM vehicle_charge_history h
      WHERE h.source = 'chargehq'
        ${this.nativeVehiclePriorityFilter()}
        AND (
          h.away_wh > 0
          OR NOT EXISTS (
            SELECT 1 FROM aggregate_ev_charge_history sw
            WHERE sw.source = 'solarweb'
              AND datetime(sw.start_time_utc) < datetime(
                h.start_time_utc, '+' || h.interval_seconds || ' seconds'
              )
              AND datetime(
                sw.start_time_utc, '+' || sw.interval_seconds || ' seconds'
              ) > datetime(h.start_time_utc)
          )
        )
      UNION ALL
      SELECT a.start_time_utc, a.start_time_local, a.interval_seconds,
        a.charged_wh, a.solar_wh, a.battery_wh, a.grid_wh, a.away_wh, a.at_home_wh
      FROM aggregate_ev_charge_history a
      WHERE a.source = 'solarweb'
        ${this.nativeAggregatePriorityFilter()}
    `;
  }

  private nativeVehiclePriorityFilter() {
    return sql`
      AND datetime(h.start_time_utc) < COALESCE(
        (SELECT datetime(MIN(v.timestamp)) FROM vehicle_charge_readings v
         WHERE v.vehicle_id = h.vehicle_id),
        datetime('9999-12-31 23:59:59')
      )
    `;
  }

  private nativeAggregatePriorityFilter() {
    return sql`
      AND datetime(a.start_time_utc) < COALESCE(
        (SELECT datetime(MIN(v.timestamp)) FROM vehicle_charge_readings v),
        datetime('9999-12-31 23:59:59')
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
