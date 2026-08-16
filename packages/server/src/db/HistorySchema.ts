import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Imported/archived vehicle charging intervals.
 *
 * Unlike vehicle_charge_readings (live one-minute power samples), this table
 * stores energy directly in Wh so source intervals such as ChargeHQ's 15-minute
 * exports remain exact and do not need synthetic one-minute rows.
 */
export const vehicleChargeHistory = sqliteTable("vehicle_charge_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  vehicleId: text("vehicle_id").notNull(),
  startTimeUtc: text("start_time_utc").notNull(),
  startTimeLocal: text("start_time_local").notNull(),
  intervalSeconds: integer("interval_seconds").notNull(),
  chargedWh: real("charged_wh").notNull(),
  solarWh: real("solar_wh").notNull(),
  batteryWh: real("battery_wh").notNull(),
  gridWh: real("grid_wh").notNull(),
  awayWh: real("away_wh").notNull(),
  atHomeWh: real("at_home_wh").notNull(),
  importedAt: text("imported_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("idx_vch_source_vehicle_external").on(
    table.source,
    table.vehicleId,
    table.externalId,
  ),
  index("idx_vch_vehicle_local").on(table.vehicleId, table.startTimeLocal),
  index("idx_vch_vehicle_utc").on(table.vehicleId, table.startTimeUtc),
]);
