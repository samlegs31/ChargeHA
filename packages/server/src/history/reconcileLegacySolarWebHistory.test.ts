import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../db/AppDatabase.ts";
import {
  HistoryRepository,
  type VehicleChargeHistoryRowInput,
} from "../db/repositories/HistoryRepository.ts";
import { reconcileLegacySolarWebHistory } from "./reconcileLegacySolarWebHistory.ts";

describe("reconcileLegacySolarWebHistory", () => {
  let db: AppDatabase;
  let history: HistoryRepository;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    history = new HistoryRepository(db.db);
  });

  afterEach(() => db.close());

  function addVehicle(source: "chargehq" | "solarweb" | null) {
    const sourceSql = source === null ? "NULL" : `'${source}'`;
    db.getDriver().exec(`
      INSERT INTO vehicles (
        id, name, adapter_type, priority, config, mode, home_charging_source
      ) VALUES (
        'VIN_EDITH', 'E.D.I.T.H.', 'tesla', 1, '{}', 'auto', ${sourceSql}
      )
    `);
  }

  function row(
    source: string,
    externalId: string,
    date: string,
    chargedWh: number,
    hour = "10:00:00",
    intervalSeconds = 300,
  ): VehicleChargeHistoryRowInput {
    return {
      source,
      externalId,
      startTimeUtc: `${date} ${hour}`,
      startTimeLocal: `${date} ${hour}`,
      intervalSeconds,
      chargedWh,
      solarWh: chargedWh,
      batteryWh: 0,
      gridWh: 0,
      awayWh: 0,
      atHomeWh: chargedWh,
    };
  }

  it("removes every legacy aggregate interval on a superseded Wattpilot day", async () => {
    addVehicle("solarweb");
    await history.importAggregateRows([
      row("solarweb", "legacy-1", "2025-06-01", 500, "08:00:00"),
      row("solarweb", "legacy-2", "2025-06-01", 600, "14:00:00"),
      row("solarweb", "legacy-next-day", "2025-06-02", 700, "09:00:00"),
    ]);
    await history.importRows("VIN_EDITH", [
      row(
        "solarweb",
        "pv:wattpilot-day:2025-06-01",
        "2025-06-01",
        900,
        "12:00:00",
        1,
      ),
    ]);

    expect(reconcileLegacySolarWebHistory(db.db)).toBe(2);
    expect(reconcileLegacySolarWebHistory(db.db)).toBe(0);

    const coverage = await history.getAggregateCoverage("solarweb");
    expect(coverage.rowCount).toBe(1);
    expect(coverage.chargedWh).toBe(700);

    const june1 = await history.getChargeHqStatsDay("2025-06-01");
    expect(june1.reduce((sum, entry) => sum + entry.totalWh, 0)).toBe(900);
    const june2 = await history.getChargeHqStatsDay("2025-06-02");
    expect(june2.reduce((sum, entry) => sum + entry.totalWh, 0)).toBe(700);
  });

  it("keeps legacy Solar.web when the vehicle explicitly uses ChargeHQ", async () => {
    addVehicle("chargehq");
    await history.importAggregateRows([
      row("solarweb", "legacy", "2025-06-01", 1000),
    ]);
    await history.importRows("VIN_EDITH", [
      row(
        "solarweb",
        "pv:wattpilot-day:2025-06-01",
        "2025-06-01",
        900,
        "12:00:00",
        1,
      ),
    ]);

    expect(reconcileLegacySolarWebHistory(db.db)).toBe(0);
    const coverage = await history.getAggregateCoverage("solarweb");
    expect(coverage.rowCount).toBe(1);
  });
});
