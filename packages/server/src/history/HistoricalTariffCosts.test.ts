import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { DayOfWeek, StatsResponse } from "@chargeha/shared";
import { AppDatabase } from "../db/AppDatabase.ts";
import { HistoryRepository } from "../db/repositories/HistoryRepository.ts";
import type { ChargeHqHistoryRow } from "./ChargeHqCsv.ts";
import { applyHistoricalChargeHqTariffs } from "./HistoricalTariffCosts.ts";

describe("applyHistoricalChargeHqTariffs", () => {
  const ALL_DAYS: DayOfWeek[] = [
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
  ];

  function dayResponse(date: string): StatsResponse {
    return {
      period: "day",
      startDate: date,
      endDate: date,
      buckets: Array.from({ length: 24 }, (_, hour) => ({
        label: String(hour),
        solarWh: 0,
        batteryWh: 0,
        gridWh: 0,
        awayWh: 0,
        totalWh: 0,
        costCents: 0,
      })),
      totalCostCents: 0,
      solarSavingsCents: 0,
      evSolarSavingsCents: 0,
    } as StatsResponse;
  }

  function chargeHqRow(values: {
    externalId: string;
    startTimeUtc: string;
    startTimeLocal: string;
    gridWh: number;
    solarWh: number;
  }): ChargeHqHistoryRow {
    return {
      source: "chargehq",
      externalId: values.externalId,
      startTimeUtc: values.startTimeUtc,
      startTimeLocal: values.startTimeLocal,
      intervalSeconds: 15 * 60,
      chargedWh: values.gridWh + values.solarWh,
      solarWh: values.solarWh,
      batteryWh: 0,
      gridWh: values.gridWh,
      awayWh: 0,
      atHomeWh: values.gridWh + values.solarWh,
    };
  }

  let db: AppDatabase;
  let history: HistoryRepository;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    history = new HistoryRepository(db.db);
    db.getDriver().exec(`
      INSERT INTO vehicles (
        id, name, adapter_type, config, home_charging_source
      ) VALUES (
        'vehicle-1', 'Model Y', 'tesla', '{}', 'chargehq'
      )
    `);
    await db.setConfig("default_rate_per_kwh", "0.24");
    await db.createTariffPeriod({
      label: "Off-Peak",
      startTime: "01:10",
      endTime: "06:40",
      days: ALL_DAYS,
      ratePerKwh: 0.13,
      enabled: true,
    });
  });

  afterEach(() => db.close());

  it("splits a 15-minute ChargeHQ interval across a tariff boundary", async () => {
    await history.importChargeHqRows("vehicle-1", [chargeHqRow({
      externalId: "boundary",
      startTimeUtc: "2025-01-15 01:00:00",
      startTimeLocal: "2025-01-15 01:00:00",
      gridWh: 500,
      solarWh: 500,
    })]);

    const result = await applyHistoricalChargeHqTariffs(
      db,
      dayResponse("2025-01-15"),
      "vehicle-1",
    );

    const weightedRate = (10 / 15) * 0.24 + (5 / 15) * 0.13;
    expect(result.buckets[1].costCents).toBeCloseTo(
      0.5 * weightedRate * 100,
      6,
    );
    expect(result.totalCostCents).toBeCloseTo(
      0.5 * weightedRate * 100,
      6,
    );
    expect(result.evSolarSavingsCents).toBeCloseTo(
      0.5 * weightedRate * 100,
      6,
    );
    expect(result.solarSavingsCents).toBeCloseTo(
      0.5 * weightedRate * 100,
      6,
    );
  });

  it("does not price ChargeHQ home rows when Solar.web is selected", async () => {
    db.getDriver().exec(`
      UPDATE vehicles
      SET home_charging_source = 'solarweb'
      WHERE id = 'vehicle-1'
    `);
    await history.importChargeHqRows("vehicle-1", [chargeHqRow({
      externalId: "ignored",
      startTimeUtc: "2025-01-15 02:00:00",
      startTimeLocal: "2025-01-15 02:00:00",
      gridWh: 1000,
      solarWh: 0,
    })]);

    const result = await applyHistoricalChargeHqTariffs(
      db,
      dayResponse("2025-01-15"),
      "vehicle-1",
    );

    expect(result.totalCostCents).toBe(0);
    expect(result.evSolarSavingsCents).toBe(0);
  });
});
