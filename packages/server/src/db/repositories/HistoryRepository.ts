import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, sql } from "drizzle-orm";
import { vehicleChargeHistory } from "../HistorySchema.ts";
import type { ChargeHqHistoryRow } from "../../history/ChargeHqCsv.ts";

export interface HistoryImportResult {
  insertedRows: number;
  skippedRows: number;
}

export interface HistoryCoverage {
  rowCount: number;
  firstStartTimeLocal: string | null;
  lastStartTimeLocal: string | null;
  chargedWh: number;
}

export class HistoryRepository {
  constructor(private db: BetterSQLite3Database) {}

  importChargeHqRows(
    vehicleId: string,
    rows: readonly ChargeHqHistoryRow[],
  ): HistoryImportResult {
    const insertedRows = this.db.transaction((tx) =>
      rows.reduce((inserted, row) => {
        const result = tx.insert(vehicleChargeHistory).values({
          ...row,
          vehicleId,
        }).onConflictDoNothing().run();
        return inserted + result.changes;
      }, 0)
    );

    return {
      insertedRows,
      skippedRows: rows.length - insertedRows,
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
}
