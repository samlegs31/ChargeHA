import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ChargeHqCsvError, parseChargeHqIntervalCsv } from "./ChargeHqCsv.ts";

describe("parseChargeHqIntervalCsv", () => {
  const header =
    "start_time_local,start_time_epoch,charged_kwh,from_solar_kwh,from_battery_kwh,from_grid_kwh,away_from_home_kwh,at_home_kwh";
  const indexedHeader = `index,${header}`;

  it("parses a raw ChargeHQ 15-minute home interval without losing energy", () => {
    const csv =
      `${header}\n2026-01-04 12:00:00,1767524400.0,0.521,0.432,0.059,0.030,0.0,0.521`;
    const result = parseChargeHqIntervalCsv(csv);

    expect(result.summary.intervalCount).toBe(1);
    expect(result.summary.chargedKwh).toBe(0.521);
    expect(result.historyRows).toEqual([{
      source: "chargehq",
      externalId: "1767524400:home",
      startTimeUtc: "2026-01-04 11:00:00",
      startTimeLocal: "2026-01-04 12:00:00",
      intervalSeconds: 900,
      chargedWh: 521,
      solarWh: 432,
      batteryWh: 59,
      gridWh: 30,
      awayWh: 0,
      atHomeWh: 521,
    }]);
  });

  it("also accepts an optional leading index column", () => {
    const csv =
      `${indexedHeader}\n42,2026-01-04 12:00:00,1767524400.0,0.521,0.432,0.059,0.030,0.0,0.521`;
    const result = parseChargeHqIntervalCsv(csv);

    expect(result.summary.intervalCount).toBe(1);
    expect(result.intervals[0].index).toBe(42);
    expect(result.summary.chargedKwh).toBe(0.521);
  });

  it("keeps away charging separate from home energy attribution", () => {
    const csv =
      `${header}\n2026-01-08 07:15:00,1767852900.0,0.438,0.0,0.0,0.0,0.438,0.0`;
    const result = parseChargeHqIntervalCsv(csv);

    expect(result.historyRows).toEqual([{
      source: "chargehq",
      externalId: "1767852900:away",
      startTimeUtc: "2026-01-08 06:15:00",
      startTimeLocal: "2026-01-08 07:15:00",
      intervalSeconds: 900,
      chargedWh: 438,
      solarWh: 0,
      batteryWh: 0,
      gridWh: 0,
      awayWh: 438,
      atHomeWh: 0,
    }]);
  });

  it("splits a mixed interval into home and away rows", () => {
    const csv =
      `${header}\n2026-01-08 07:15:00,1767852900,1.000,0.200,0.100,0.200,0.500,0.500`;
    const result = parseChargeHqIntervalCsv(csv);

    expect(result.historyRows).toHaveLength(2);
    expect(result.historyRows.reduce((sum, row) => sum + row.chargedWh, 0))
      .toBe(1000);
    expect(result.historyRows.reduce((sum, row) => sum + row.awayWh, 0))
      .toBe(500);
    expect(result.historyRows.reduce((sum, row) => sum + row.atHomeWh, 0))
      .toBe(500);
  });

  it("preserves ChargeHQ local wall-clock timestamps across DST gaps", () => {
    const csv = [
      header,
      "2026-03-29 01:45:00,1774745100,0.100,0.100,0.0,0.0,0.0,0.100",
      "2026-03-29 03:00:00,1774746000,0.100,0.100,0.0,0.0,0.0,0.100",
    ].join("\n");
    const result = parseChargeHqIntervalCsv(csv);

    expect(result.historyRows.map((row) => row.startTimeLocal)).toEqual([
      "2026-03-29 01:45:00",
      "2026-03-29 03:00:00",
    ]);
  });

  it("accepts BOM and CRLF exports", () => {
    const csv =
      `\uFEFF${header}\r\n2025-01-01 11:00:00,1735725600.0,0.269,0.269,0.0,0.0,0.0,0.269\r\n`;
    expect(parseChargeHqIntervalCsv(csv).summary.intervalCount).toBe(1);
  });

  it("rejects duplicate epoch intervals so re-import IDs stay deterministic", () => {
    const csv = [
      header,
      "2025-01-01 11:00:00,1735725600,0.269,0.269,0.0,0.0,0.0,0.269",
      "2025-01-01 11:00:00,1735725600,0.269,0.269,0.0,0.0,0.0,0.269",
    ].join("\n");
    expect(() => parseChargeHqIntervalCsv(csv)).toThrow(ChargeHqCsvError);
  });

  it("rejects rows where charged energy does not equal home plus away", () => {
    const csv =
      `${header}\n2026-01-04 12:00:00,1767524400,1.000,0.400,0.0,0.100,0.0,0.500`;
    expect(() => parseChargeHqIntervalCsv(csv)).toThrow(
      /charged_kwh is inconsistent/,
    );
  });

  it("rejects rows where home attribution is inconsistent", () => {
    const csv =
      `${header}\n2026-01-04 12:00:00,1767524400,0.500,0.100,0.0,0.100,0.0,0.500`;
    expect(() => parseChargeHqIntervalCsv(csv)).toThrow(
      /at_home_kwh is inconsistent/,
    );
  });
});
