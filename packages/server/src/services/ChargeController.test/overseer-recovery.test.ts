import { assert, assertEquals, assertExists } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { Overseer } from "../Overseer.ts";
import { Logger } from "../../lib/Logger.ts";
import { testable } from "../../test-helpers/Testable.ts";
import {
  BASE_ENERGY,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

for (const disabled of [false, true]) {
  Deno.test(`real controller resumes after Overseer cooldown, manual OFF=${disabled}`, async () => {
    using time = new FakeTime(Date.now());
    const ctx = await setupController(
      { isCharging: true, chargeAmps: 8 },
      "auto",
      BASE_ENERGY,
      {
        cooldown_period_minutes: "0",
        vehicle_solar_current_limits: JSON.stringify({ [VIN]: 22 }),
      },
    );
    const overseer = new Overseer(
      ctx.db,
      ctx.trackingEmitter,
      new Logger("recovery-test", "error"),
      ctx.manager,
    );
    overseer.stop();
    const fetch = ctx.adapter.getChargeState.bind(ctx.adapter);
    ctx.adapter.getChargeState = async (origin) => ({
      ...await fetch(origin),
      lastUpdated: new Date().toISOString(),
    });
    try {
      await ctx.db.setConfig("charging_enabled", "true");
      for (
        const action of ["start", "stop", "start", "stop", "start"] as const
      ) {
        await ctx.db.insertControllerLogEntries([{
          vehicleId: VIN,
          vehicleName: "Friday",
          mode: "auto",
          inputsJson: "{}",
          checksJson: "{}",
          action,
          actionDetail: action,
          targetAmps: null,
          traceId: "recovery",
        }]);
      }
      await testable(overseer).check();
      assertEquals(await ctx.db.getConfig("oscillation_paused"), "true");
      assertEquals(ctx.adapter.state.isCharging, false);
      if (disabled) await ctx.db.setConfig("charging_enabled", "false");
      for (let minute = 1; minute <= 12; minute++) {
        time.tick(60_000);
        assertExists(ctx.poller.snapshot);
        const actual = ctx.adapter.state.isCharging
          ? ctx.adapter.state.chargeAmps
          : 0;
        ctx.adapter.state.chargeAmpsActual = actual;
        ctx.adapter.state.chargePowerKw = actual * 0.23;
        ctx.poller.snapshot.realtime = {
          ...BASE_ENERGY,
          solarProductionW: 6000,
          homeConsumptionW: 600 + actual * 230,
          gridPowerW: 600 + actual * 230 - 6000,
          lastUpdated: new Date().toISOString(),
        };
        await ctx.runOneLoop();
        await testable(overseer).check();
        if (minute < 5 || disabled) {
          assertEquals(ctx.adapter.state.isCharging, false);
        }
      }
      assertEquals(await ctx.db.getConfig("oscillation_paused"), "false");
      assertEquals(ctx.adapter.state.isCharging, !disabled);
      assertEquals(
        await ctx.db.getConfig("charging_enabled"),
        String(!disabled),
      );
      assert(ctx.adapter.state.chargeAmps <= 22);
      assertEquals(
        ctx.trackingEmitter.emitted.filter((e) => e.type === "safety_trip")
          .length,
        1,
      );
    } finally {
      overseer.stop();
      ctx.controller.stop();
      ctx.db.close();
    }
  });
}
