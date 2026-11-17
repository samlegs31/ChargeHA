import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { assertExists } from "@std/assert";
import {
  BASE_ENERGY,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

Deno.test("Europe/Paris overnight schedule crosses midnight and yields to manual OFF", async () => {
  // 21:55 UTC = 23:55 Paris, summer time. Schedule spans midnight locally.
  using time = new FakeTime(Date.UTC(2026, 5, 15, 21, 55));
  const ctx = await setupController({}, "auto", {
    ...BASE_ENERGY,
    solarProductionW: 0,
    gridPowerW: 600,
  }, {
    timezone: "Europe/Paris",
    grace_period_minutes: "0",
    cooldown_period_minutes: "0",
  });
  await ctx.db.createSchedule({
    id: "overnight",
    vehicleId: VIN,
    scheduleType: "charge",
    startTime: "23:58",
    endTime: "00:10",
    days: ["mon", "tue"],
    chargeAmps: 8,
    chargeLimitPct: 80,
    enabled: true,
  });
  try {
    for (let step = 0; step < 25; step++) {
      if (step) time.tick(60_000);
      if (step === 7) await ctx.db.setConfig("charging_enabled", "false");
      if (step === 10) await ctx.db.setConfig("charging_enabled", "true");
      assertExists(ctx.poller.snapshot);
      ctx.adapter.state.chargePowerKw = ctx.adapter.state.isCharging
        ? ctx.adapter.state.chargeAmps * 0.23
        : 0;
      ctx.poller.snapshot.realtime = {
        ...BASE_ENERGY,
        solarProductionW: 0,
        gridPowerW: 600 + ctx.adapter.state.chargePowerKw * 1000,
        lastUpdated: new Date().toISOString(),
      };
      await ctx.runOneLoop();
      const expected = step >= 3 && step < 15 && !(step >= 7 && step < 10);
      expect(ctx.adapter.state.isCharging).toBe(expected);
      if (expected) expect(ctx.adapter.state.chargeAmps).toBe(8);
    }
  } finally {
    ctx.controller.stop();
    ctx.db.close();
  }
});

Deno.test("Europe/Paris overnight schedule stays uninterrupted past midnight despite Overseer trip, battery discharge, and inverter telemetry loss", async () => {
  // Use current UTC date shifted so Europe/Paris local time starts at 23:55
  // today (matching SQLite's datetime('now') clock for Overseer logs).
  const parisNowParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: string) =>
    Number(parisNowParts.find((p) => p.type === type)?.value ?? 0);
  // Target 23:55:00 in Europe/Paris on the current calendar date by shifting
  // relative to current Paris HH:MM:SS.
  const currentParisSeconds = (part("hour") % 24) * 3600 + part("minute") * 60 +
    part("second");
  const targetParisSeconds = 23 * 3600 + 55 * 60;
  const startMs = Date.now() +
    (targetParisSeconds - currentParisSeconds) * 1000;

  using time = new FakeTime(startMs);
  const { Overseer } = await import("../Overseer.ts");
  const { Logger } = await import("../../lib/Logger.ts");
  const { testable } = await import("../../test-helpers/Testable.ts");

  const ctx = await setupController({}, "auto", {
    ...BASE_ENERGY,
    solarProductionW: 0,
    gridPowerW: 600,
    batterySoc: 15,
    batteryPowerW: 2500,
    lastUpdated: new Date().toISOString(),
  }, {
    timezone: "Europe/Paris",
    battery_priority_enabled: "true",
    battery_priority_limit: "80",
    battery_discharge_tolerance_w: "100",
    battery_discharge_grace_minutes: "3",
    grace_period_minutes: "1",
    cooldown_period_minutes: "10",
    max_grid_import_kw: "6",
  });
  const overseer = new Overseer(
    ctx.db,
    ctx.trackingEmitter,
    new Logger("system-schedule-overseer", "error"),
    ctx.manager,
  );
  overseer.stop();

  const fetch = ctx.adapter.getChargeState.bind(ctx.adapter);
  ctx.adapter.getChargeState = async (origin) => ({
    ...await fetch(origin),
    lastUpdated: new Date().toISOString(),
  });

  await ctx.db.createSchedule({
    id: "overnight-paris-immune",
    vehicleId: VIN,
    scheduleType: "charge",
    startTime: "23:58",
    endTime: "00:10",
    days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    chargeAmps: 16,
    chargeLimitPct: 80,
    enabled: true,
  });

  try {
    // Trigger an active Overseer safety trip before the 23:58 schedule opens.
    for (
      const action of ["start", "stop", "start", "stop", "start"] as const
    ) {
      await ctx.db.insertControllerLogEntries([{
        vehicleId: VIN,
        vehicleName: "Test Car",
        mode: "auto",
        inputsJson: "{}",
        checksJson: "{}",
        action,
        actionDetail: action,
        targetAmps: null,
        traceId: "paris-pre-trip",
      }]);
    }
    await testable(overseer).check();
    expect(await ctx.db.getConfig("oscillation_paused")).toBe("true");

    // 23:55 -> 00:12 (18 steps @ 1 min, spanning >3 min grace and midnight 00:00..00:09)
    for (let step = 0; step < 18; step++) {
      if (step) time.tick(60_000);
      assertExists(ctx.poller.snapshot);
      // Simulate inverter telemetry outage across midnight (23:59 -> 00:04).
      const inverterDown = step >= 4 && step <= 9;
      ctx.adapter.state.chargePowerKw = ctx.adapter.state.isCharging
        ? ctx.adapter.state.chargeAmps * 0.23
        : 0;
      ctx.poller.snapshot.realtime = {
        ...BASE_ENERGY,
        pollFailed: inverterDown,
        solarProductionW: 0,
        batterySoc: 15,
        batteryPowerW: 2500,
        gridPowerW: 600 + ctx.adapter.state.chargePowerKw * 1000,
        lastUpdated: new Date().toISOString(),
      };
      await ctx.runOneLoop();
      await testable(overseer).check();

      // Steps 3..14 = 23:58..00:09 Paris -> continuously charging at 16A!
      const inSchedule = step >= 3 && step < 15;
      expect(ctx.adapter.state.isCharging).toBe(inSchedule);
      if (inSchedule) {
        expect(ctx.adapter.state.chargeAmps).toBe(16);
        expect(await ctx.db.getConfig("oscillation_paused")).toBe("false");
      }
    }
    // Outside schedule (00:10..00:12), normal battery protection stopped it
    // and Overseer did not re-trip from the schedule session.
    expect(await ctx.db.getConfig("oscillation_paused")).toBe("false");
  } finally {
    overseer.stop();
    ctx.controller.stop();
    ctx.db.close();
  }
});
