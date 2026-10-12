import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { assertExists } from "@std/assert";
import {
  BASE_ENERGY,
  setupController,
} from "../../test-helpers/ChargeControllerHarness.ts";

Deno.test("a 1A solar drop reaches Tesla on the next tick and cloud recovery does not bounce", async () => {
  using time = new FakeTime(Date.UTC(2026, 5, 15, 12));
  const ctx = await setupController(
    {
      isCharging: true,
      chargeAmps: 8,
      chargeAmpsActual: 8,
      chargePowerKw: 1.84,
    },
    "auto",
    { ...BASE_ENERGY, gridPowerW: -1 },
    { amp_debounce_threshold: "2", amp_debounce_settle_minutes: "3" },
  );
  try {
    await ctx.runOneLoop();
    ctx.adapter.commands = [];
    time.tick(10_000);
    assertExists(ctx.poller.snapshot);
    ctx.poller.snapshot.realtime = {
      ...BASE_ENERGY,
      gridPowerW: 229,
      lastUpdated: new Date().toISOString(),
    };
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).toEqual([{ cmd: "setAmps", args: 7 }]);
    expect(ctx.adapter.state.chargeAmps).toBe(7);
    ctx.adapter.state.chargeAmpsActual = 7;
    ctx.adapter.state.chargePowerKw = 1.61;
    ctx.adapter.commands = [];
    for (let tick = 0; tick < 6; tick++) {
      time.tick(10_000);
      ctx.poller.snapshot.realtime = {
        ...BASE_ENERGY,
        gridPowerW: tick % 2 === 0 ? -231 : -1,
        lastUpdated: new Date().toISOString(),
      };
      await ctx.runOneLoop();
    }
    expect(ctx.adapter.commands).toEqual([]);
    expect(ctx.adapter.state.chargeAmps).toBe(7);
  } finally {
    ctx.controller.stop();
    ctx.db.close();
  }
});
