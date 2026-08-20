import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

/**
 * Remove installation-level Solar.web archive rows for days that are now
 * represented by the newer per-vehicle Wattpilot daily aggregate import.
 *
 * Older E.V. Solar versions stored Solar.web history in
 * aggregate_ev_charge_history without a vehicle. The current importer stores
 * the authoritative Wattpilot daily total on the selected vehicle. Keeping both
 * makes global Stats larger than the sum of the vehicle cards.
 *
 * A whole legacy day is superseded only by the explicit `wattpilot-day` format.
 * Interval-based ChargeHQ/legacy rows therefore keep their existing overlap
 * behaviour, and a vehicle explicitly configured for ChargeHQ does not suppress
 * installation-level Solar.web history by accident.
 */
export function reconcileLegacySolarWebHistory(
  db: BetterSQLite3Database,
): number {
  const result = db.run(sql`
    DELETE FROM aggregate_ev_charge_history
    WHERE source = 'solarweb'
      AND EXISTS (
        SELECT 1
        FROM vehicle_charge_history h
        JOIN vehicles v ON v.id = h.vehicle_id
        WHERE h.source = 'solarweb'
          AND h.external_id LIKE '%:wattpilot-day:%'
          AND h.at_home_wh > 0
          AND substr(h.start_time_local, 1, 10) =
              substr(aggregate_ev_charge_history.start_time_local, 1, 10)
          AND (
            v.home_charging_source IS NULL
            OR v.home_charging_source = 'solarweb'
          )
      )
  `);
  return Number(result.changes ?? 0);
}
