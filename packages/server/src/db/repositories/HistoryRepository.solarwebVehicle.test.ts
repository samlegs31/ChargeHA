import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../AppDatabase.ts";
import {
  HistoryRepository,
  type VehicleChargeHistoryRowInput,
} from "./HistoryRepository.ts";

describe("vehicle-attributed charging history", () => {
  function historyRow(
    source: string,
    externalId: string,
    values: Partial<VehicleChargeHistoryRowInput> = {},
  ): VehicleChargeHistoryRowInput {
    return {
      source,
      externalId,
      startTimeUtc: "2025-06-01 08:00:00",
      startTimeLocal: "2025-06-01 10:00:00",
      intervalSeconds: 300,
      chargedWh: 1000,
      solarWh: 500,
      batteryWh: 100,
      gridWh: 400,
      awayWh: 0,
      atHomeWh: 1000,
      ...values,
    };
  }

  let db: AppDatabase;
  let repository: HistoryRepository;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    repository = new HistoryRepository(db.db);
  });

  afterEach(() => {
    db.close();
  });

  it("attaches Wattpilot history to Edith VIN without leaking into Friday", async () => {
    const wattpilot = historyRow("solarweb", "pv:2025-06-01T10:00:00");
    const first = await repository.importRows("VIN_EDITH", [wattpilot]);
    const second = await repository.importRows("VIN_EDITH", [wattpilot]);

    expect(first).toEqual({
      insertedRows: 1,
      duplicateRows: 0,
      overlapRows: 0,
      skippedRows: 0,
    });
    expect(second.duplicateRows).toBe(1);
    const coverage = await repository.getCoverage("solarweb", "VIN_EDITH");
    expect(coverage.rowCount).toBe(1);
    expect(coverage.chargedWh).toBe(1000);

    const edith = await repository.getChargeHqStatsDay(
      "2025-06-01",
      "VIN_EDITH",
    );
    expect(edith[0]?.totalWh).toBe(1000);
    expect(edith[0]?.solarWh).toBe(500);
    const friday = await repository.getChargeHqStatsDay(
      "2025-06-01",
      "VIN_FRIDAY",
    );
    expect(friday).toEqual([]);
  });

  it("uses a per-vehicle native cutoff for Wattpilot imports", async () => {
    db.getDriver().exec(`
      INSERT INTO vehicle_charge_readings (
        timestamp, vehicle_id, charge_power_w, charge_amps,
        solar_contribution_w, battery_contribution_w, grid_contribution_w, is_home
      ) VALUES (
        '2025-01-01 00:00:00', 'VIN_FRIDAY', 0, 0, 0, 0, 0, 1
      )
    `);
    const wattpilot = historyRow("solarweb", "edith-after-friday-cutoff", {
      startTimeUtc: "2025-06-01 08:00:00",
      startTimeLocal: "2025-06-01 10:00:00",
    });

    const result = await repository.importRows("VIN_EDITH", [wattpilot]);
    expect(result.insertedRows).toBe(1);
    expect(result.overlapRows).toBe(0);
  });

  it("prefers Wattpilot home energy over overlapping legacy home data", async () => {
    const legacyHome = historyRow("chargehq", "legacy-home", {
      chargedWh: 1200,
      solarWh: 200,
      batteryWh: 0,
      gridWh: 1000,
      atHomeWh: 1200,
      intervalSeconds: 900,
    });
    const wattpilot = historyRow("solarweb", "wattpilot-home", {
      chargedWh: 900,
      solarWh: 600,
      batteryWh: 100,
      gridWh: 200,
      atHomeWh: 900,
    });

    await repository.importRows("VIN_EDITH", [legacyHome, wattpilot]);
    const stats = await repository.getChargeHqStatsDay(
      "2025-06-01",
      "VIN_EDITH",
    );
    expect(stats.reduce((sum, row) => sum + row.totalWh, 0)).toBe(900);
    expect(stats.reduce((sum, row) => sum + row.solarWh, 0)).toBe(600);
  });

  it("suppresses external archive intervals that overlap Wattpilot home charging", async () => {
    const wattpilot = historyRow("solarweb", "home", {
      startTimeUtc: "2025-06-02 08:00:00",
      startTimeLocal: "2025-06-02 10:00:00",
      chargedWh: 900,
      solarWh: 500,
      batteryWh: 100,
      gridWh: 300,
      atHomeWh: 900,
    });
    const homeDuplicate = historyRow("vehicle-history", "home-overlap", {
      startTimeUtc: "2025-06-02 08:04:00",
      startTimeLocal: "2025-06-02 10:04:00",
      chargedWh: 1000,
      solarWh: 0,
      batteryWh: 0,
      gridWh: 0,
      awayWh: 1000,
      atHomeWh: 0,
    });
    const external = historyRow("vehicle-history", "external", {
      startTimeUtc: "2025-06-02 12:00:00",
      startTimeLocal: "2025-06-02 14:00:00",
      chargedWh: 1400,
      solarWh: 0,
      batteryWh: 0,
      gridWh: 0,
      awayWh: 1400,
      atHomeWh: 0,
    });

    await repository.importRows("VIN_EDITH", [wattpilot, homeDuplicate, external]);
    const stats = await repository.getChargeHqStatsDay(
      "2025-06-02",
      "VIN_EDITH",
    );
    expect(stats.reduce((sum, row) => sum + row.totalWh, 0)).toBe(2300);
    expect(stats.reduce((sum, row) => sum + row.awayWh, 0)).toBe(1400);
    expect(stats.reduce((sum, row) => sum + row.solarWh, 0)).toBe(500);
    expect(stats.reduce((sum, row) => sum + row.gridWh, 0)).toBe(300);
  });
});
