import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, sql } from "drizzle-orm";
import { vehicleChargeHistory } from "../HistorySchema.ts";
import type { ChargeHqHistoryRow } from "../../history/ChargeHqCsv.ts";

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

  /**
   * Import ChargeHQ archive rows without overwriting native E.V Solar history.
   *
   * If native one-minute readings already exist for this vehicle, imported rows
   * at or after the first native timestamp are intentionally ignored. This
   * makes the migration boundary stable even if native retention later prunes
   * old one-minute readings.
   */
  async importChargeHqRows(
    vehicleId: string,
    rows: readonly ChargeHqHistoryRow[],
  ): Promise<HistoryImportResult> {
    const cutoffRows = await this.db.all<{ timestamp: string | null }>(sql`
      SELECT MIN(timestamp) AS timestamp
      FROM vehicle_charge_readings
      WHERE vehicle_id = ${vehicleId}
    `);
    const nativeCutoff = cutoffRows[0]?.timestamp ?? null;
    const importableRows = nativeCutoff === null
      ? rows
      : rows.filter((row) => row.startTimeUtc < nativeCutoff);
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
    const duplicateRows = importableRows.length - insertedRows;

    return {
      insertedRows,
      duplicateRows,
      overlapRows,
      skippedRows: duplicateRows + overlapRows,
    };
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

    const row = rows[0];
    return {
      rowCount: Number(row?.rowCount ?? 0),
      firstStartTimeLocal: row?.firstStartTimeLocal ?? null,
      lastStartTimeLocal: row?.lastStartTimeLocal ?? null,
      chargedWh: Number(row?.chargedWh ?? 0),
    };
  }

  /** ChargeHQ archive grouped by local hour. */
  async getChargeHqStatsDay(
    date: string,
    vehicleId?: string,
  ): Promise<HistoryStatsRow[]> {
    const vehicleFilter = this.vehicleFilter(vehicleId);
    const rows = await this.db.all<RawHistoryStatsRow>(sql`
      SELECT
        substr(h.start_time_local, 12, 2) AS bucket,
        SUM(h.solar_wh) AS solar_wh,
        SUM(h.battery_wh) AS battery_wh,
        SUM(h.grid_wh) AS grid_wh,
        SUM(h.away_wh) AS away_wh,
        SUM(h.charged_wh) AS total_wh
      FROM vehicle_charge_history h
      WHERE h.source = 'chargehq'
        AND substr(h.start_time_local, 1, 10) = ${date}
        ${vehicleFilter}
        ${this.nativePriorityFilter()}
      GROUP BY bucket
      ORDER BY bucket
    `);
    return rows.map((row) => this.mapStatsRow(row));
  }

  /** ChargeHQ archive grouped by its native 15-minute local intervals. */
  async getChargeHqStatsDayDetailed(
    date: string,
    vehicleId?: string,
  ): Promise<HistoryDetailedStatsRow[]> {
    const vehicleFilter = this.vehicleFilter(vehicleId);
    const rows = await this.db.all<RawHistoryStatsRow>(sql`
      SELECT
        CAST(substr(h.start_time_local, 12, 2) AS INTEGER) * 4
          + CAST(substr(h.start_time_local, 15, 2) AS INTEGER) / 15 AS bucket,
        SUM(h.solar_wh) AS solar_wh,
        SUM(h.battery_wh) AS battery_wh,
        SUM(h.grid_wh) AS grid_wh,
        SUM(h.away_wh) AS away_wh,
        SUM(h.charged_wh) AS total_wh
      FROM vehicle_charge_history h
      WHERE h.source = 'chargehq'
        AND substr(h.start_time_local, 1, 10) = ${date}
        ${vehicleFilter}
        ${this.nativePriorityFilter()}
      GROUP BY bucket
      ORDER BY bucket
    `);
    return rows.map((row) => ({
      ...this.mapStatsRow(row),
      bucket: Number(row.bucket),
    }));
  }

  /** ChargeHQ archive grouped by local day for a month. */
  async getChargeHqStatsMonth(
    year: number,
    month: number,
    vehicleId?: string,
  ): Promise<HistoryStatsRow[]> {
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const vehicleFilter = this.vehicleFilter(vehicleId);
    const rows = await this.db.all<RawHistoryStatsRow>(sql`
      SELECT
        substr(h.start_time_local, 9, 2) AS bucket,
        SUM(h.solar_wh) AS solar_wh,
        SUM(h.battery_wh) AS battery_wh,
        SUM(h.grid_wh) AS grid_wh,
        SUM(h.away_wh) AS away_wh,
        SUM(h.charged_wh) AS total_wh
      FROM vehicle_charge_history h
      WHERE h.source = 'chargehq'
        AND substr(h.start_time_local, 1, 7) = ${yearMonth}
        ${vehicleFilter}
        ${this.nativePriorityFilter()}
      GROUP BY bucket
      ORDER BY bucket
    `);
    return rows.map((row) => this.mapStatsRow(row));
  }

  /** ChargeHQ archive grouped by local month for a year. */
  async getChargeHqStatsYear(
    year: number,
    vehicleId?: string,
  ): Promise<HistoryStatsRow[]> {
    const yearString = String(year);
    const vehicleFilter = this.vehicleFilter(vehicleId);
    const rows = await this.db.all<RawHistoryStatsRow>(sql`
      SELECT
        substr(h.start_time_local, 6, 2) AS bucket,
        SUM(h.solar_wh) AS solar_wh,
        SUM(h.battery_wh) AS battery_wh,
        SUM(h.grid_wh) AS grid_wh,
        SUM(h.away_wh) AS away_wh,
        SUM(h.charged_wh) AS total_wh
      FROM vehicle_charge_history h
      WHERE h.source = 'chargehq'
        AND substr(h.start_time_local, 1, 4) = ${yearString}
        ${vehicleFilter}
        ${this.nativePriorityFilter()}
      GROUP BY bucket
      ORDER BY bucket
    `);
    return rows.map((row) => this.mapStatsRow(row));
  }

  private vehicleFilter(vehicleId?: string) {
    return vehicleId ? sql`AND h.vehicle_id = ${vehicleId}` : sql``;
  }

  /**
   * Defensive overlap guard for existing archives. New imports already stop at
   * the native boundary, but this also protects databases created by an older
   * importer implementation.
   */
  private nativePriorityFilter() {
    return sql`
      AND h.start_time_utc < COALESCE(
        (
          SELECT MIN(v.timestamp)
          FROM vehicle_charge_readings v
          WHERE v.vehicle_id = h.vehicle_id
        ),
        '9999-12-31 23:59:59'
      )
    `;
  }

  private mapStatsRow(row: RawHistoryStatsRow): HistoryStatsRow {
    return {
      bucket: String(row.bucket),
      solarWh: Number(row.solar_wh ?? 0),
      batteryWh: Number(row.battery_wh ?? 0),
      gridWh: Number(row.grid_wh ?? 0),
      awayWh: Number(row.away_wh ?? 0),
      totalWh: Number(row.total_wh ?? 0),
      // ChargeHQ CSVs do not contain historical tariff prices. Do not invent
      // costs or savings from today's tariff configuration.
      costCents: 0,
      solarSavingsCents: 0,
    };
  }
}
