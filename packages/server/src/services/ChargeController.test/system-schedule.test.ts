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
