import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../AppDatabase.ts";
import { HistoryRepository } from "./HistoryRepository.ts";
import type { ChargeHqHistoryRow } from "../../history/ChargeHqCsv.ts";

describe("HistoryRepository", () => {
  function historyRow(
    externalId: string,
    startTimeUtc: string,
    startTimeLocal: string,
    values: Partial<
      Pick<
        ChargeHqHistoryRow,
        | "chargedWh"
        | "solarWh"
        | "batteryWh"
        | "gridWh"
        | "awayWh"
        | "atHomeWh"
      >
    > = {},
  ): ChargeHqHistoryRow {
    return {
      source: "chargehq",
      externalId,
      startTimeUtc,
      startTimeLocal,
      intervalSeconds: 900,
      chargedWh: values.chargedWh ?? 1000,
      solarWh: values.solarWh ?? 400,
      batteryWh: values.batteryWh ?? 100,
      gridWh: values.gridWh ?? 500,
      awayWh: values.awayWh ?? 0,
      atHomeWh: values.atHomeWh ?? 1000,
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

  it("imports exact Wh and is idempotent", async () => {
    const row = historyRow(
      "1736942400:home",
      "2025-01-15 12:00:00",
      "2025-01-15 13:00:00",
    );

    const first = await repository.importChargeHqRows("vehicle-1", [row]);
    expect(first).toEqual({
      insertedRows: 1,
      duplicateRows: 0,
      overlapRows: 0,
      skippedRows: 0,
    });

    const second = await repository.importChargeHqRows("vehicle-1", [row]);
    expect(second).toEqual({
      insertedRows: 0,
      duplicateRows: 1,
      overlapRows: 0,
      skippedRows: 1,
    });

    const coverage = await repository.getCoverage("chargehq", "vehicle-1");
    expect(coverage.rowCount).toBe(1);
    expect(coverage.chargedWh).toBe(1000);

    const stats = await repository.getChargeHqStatsDay(
      "2025-01-15",
      "vehicle-1",
    );
    expect(stats).toEqual([{
      bucket: "13",
      solarWh: 400,
      batteryWh: 100,
      gridWh: 500,
      awayWh: 0,
      totalWh: 1000,
      costCents: 0,
      solarSavingsCents: 0,
    }]);
  });

  it("keeps native E.V Solar readings authoritative on overlap", async () => {
    db.getDriver().exec(`
      INSERT INTO vehicle_charge_readings (
        timestamp,
        vehicle_id,
        charge_power_w,
        charge_amps,
        solar_contribution_w,
        battery_contribution_w,
        grid_contribution_w,
        is_home
      ) VALUES (
        '2026-08-11 00:00:00',
        'vehicle-1',
        0,
        0,
        0,
        0,
        0,
        1
      )
    `);

    const beforeNative = historyRow(
      "1786405500:home",
      "2026-08-10 23:45:00",
      "2026-08-11 01:45:00",
    );
    const atNativeBoundary = historyRow(
      "1786406400:home",
      "2026-08-11 00:00:00",
      "2026-08-11 02:00:00",
    );

    const result = await repository.importChargeHqRows("vehicle-1", [
      beforeNative,
      atNativeBoundary,
    ]);

    expect(result).toEqual({
      insertedRows: 1,
      duplicateRows: 0,
      overlapRows: 1,
      skippedRows: 1,
    });

    const stats = await repository.getChargeHqStatsDay(
      "2026-08-11",
      "vehicle-1",
    );
    expect(stats.map((row) => row.totalWh)).toEqual([1000]);
  });

  it("buckets repeated DST wall-clock intervals by ChargeHQ local time", async () => {
    const firstOccurrence = historyRow(
      "1761437700:home",
      "2025-10-26 00:15:00",
      "2025-10-26 02:15:00",
      {
        chargedWh: 1000,
        solarWh: 1000,
        batteryWh: 0,
        gridWh: 0,
        atHomeWh: 1000,
      },
    );
    const secondOccurrence = historyRow(
      "1761441300:home",
      "2025-10-26 01:15:00",
      "2025-10-26 02:15:00",
      {
        chargedWh: 2000,
        solarWh: 0,
        batteryWh: 500,
        gridWh: 1500,
        atHomeWh: 2000,
      },
    );

    const result = await repository.importChargeHqRows("vehicle-1", [
      firstOccurrence,
      secondOccurrence,
    ]);
    expect(result.insertedRows).toBe(2);

    const detailed = await repository.getChargeHqStatsDayDetailed(
      "2025-10-26",
      "vehicle-1",
    );
    expect(detailed).toEqual([{
      bucket: 9,
      solarWh: 1000,
      batteryWh: 500,
      gridWh: 1500,
      awayWh: 0,
      totalWh: 3000,
      costCents: 0,
      solarSavingsCents: 0,
    }]);
  });

  it("keeps away charging separate from home energy sources", async () => {
    const home = historyRow(
      "1760000000:home",
      "2025-10-09 08:53:20",
      "2025-10-09 10:53:20",
      {
        chargedWh: 750,
        solarWh: 250,
        batteryWh: 100,
        gridWh: 400,
        awayWh: 0,
        atHomeWh: 750,
      },
    );
    const away = historyRow(
      "1760000000:away",
      "2025-10-09 08:53:20",
      "2025-10-09 10:53:20",
      {
        chargedWh: 1250,
        solarWh: 0,
        batteryWh: 0,
        gridWh: 0,
        awayWh: 1250,
        atHomeWh: 0,
      },
    );

    await repository.importChargeHqRows("vehicle-1", [home, away]);
    const stats = await repository.getChargeHqStatsDay(
      "2025-10-09",
      "vehicle-1",
    );

    expect(stats[0]).toEqual({
      bucket: "10",
      solarWh: 250,
      batteryWh: 100,
      gridWh: 400,
      awayWh: 1250,
      totalWh: 2000,
      costCents: 0,
      solarSavingsCents: 0,
    });
  });
});
