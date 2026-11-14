import { assert, assertEquals, assertExists } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { Overseer } from "../Overseer.ts";
import { Logger } from "../../lib/Logger.ts";
import { testable } from "../../test-helpers/Testable.ts";
import {
  BASE_ENERGY,
  setupController,
  setupMultiVehicleController,
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

Deno.test("per-vehicle Overseer pause isolates oscillating vehicle while allowing second vehicle to charge", async () => {
  using time = new FakeTime(Date.now());
  const VIN_1 = "TEST_VIN_001";
  const VIN_2 = "TEST_VIN_002";
  const ctx = await setupMultiVehicleController(
    [
      {
        vin: VIN_1,
        name: "Friday",
        priority: 1,
        state: { isCharging: true, chargeAmps: 8 },
        mode: "auto",
      },
      {
        vin: VIN_2,
        name: "Jarvis",
        priority: 2,
        state: { isCharging: false, chargeAmps: 0 },
        mode: "auto",
      },
    ],
    {
      ...BASE_ENERGY,
      solarProductionW: 6000,
      homeConsumptionW: 600,
      gridPowerW: -5400,
      lastUpdated: new Date().toISOString(),
    },
    {
      cooldown_period_minutes: "0",
      priority_charging_enabled: "true",
    },
  );
  const overseer = new Overseer(
    ctx.db,
    ctx.trackingEmitter,
    new Logger("recovery-multi-test", "error"),
    ctx.manager,
  );
  overseer.stop();

  for (const [, adapter] of ctx.adapters) {
    const fetch = adapter.getChargeState.bind(adapter);
    adapter.getChargeState = async (origin) => ({
      ...await fetch(origin),
      lastUpdated: new Date().toISOString(),
    });
  }

  try {
    await ctx.db.setConfig("charging_enabled", "true");
    for (
      const action of ["start", "stop", "start", "stop", "start"] as const
    ) {
      await ctx.db.insertControllerLogEntries([{
        vehicleId: VIN_1,
        vehicleName: "Friday",
        mode: "auto",
        inputsJson: "{}",
        checksJson: "{}",
        action,
        actionDetail: action,
        targetAmps: null,
        traceId: "recovery-multi",
      }]);
    }
    await testable(overseer).check();
    assertEquals(await ctx.db.getConfig("oscillation_paused"), "true");
    const adapter1 = ctx.adapters.get(VIN_1)!;
    const adapter2 = ctx.adapters.get(VIN_2)!;
    assertEquals(adapter1.state.isCharging, false);

    // Next cycle during the 5-minute pause: VIN_1 stays paused, VIN_2 gets the solar surplus!
    time.tick(60_000);
    assertExists(ctx.poller.snapshot);
    ctx.poller.snapshot.realtime = {
      ...BASE_ENERGY,
      solarProductionW: 6000,
      homeConsumptionW: 600,
      gridPowerW: -5400,
      lastUpdated: new Date().toISOString(),
    };
    await ctx.runOneLoop();

    assertEquals(adapter1.state.isCharging, false);
    assertEquals(adapter2.state.isCharging, true);
    const log1 = await ctx.getLogForVehicle(VIN_1);
    assertExists(log1);
    assert(log1.actionDetail.includes("Stabilisation pause"));
  } finally {
    overseer.stop();
    ctx.controller.stop();
    ctx.db.close();
  }
});

Deno.test("ChargeController deduplicates identical action=none logs within 5 minutes and emits heartbeat after 5 minutes", async () => {
  using time = new FakeTime(Date.now());
  const ctx = await setupController(
    { isCharging: false, isPluggedIn: false },
    "auto",
    {
      ...BASE_ENERGY,
      lastUpdated: new Date().toISOString(),
    },
  );
  try {
    await ctx.runOneLoop();
    const firstCount =
      (await ctx.db.logs.getControllerLogs({ limit: 50, offset: 0 })).total;
    assertEquals(firstCount, 1);

    // 3 identical cycles 5 seconds apart -> still 1 persisted log row
    for (let i = 0; i < 3; i++) {
      time.tick(5_000);
      assertExists(ctx.poller.snapshot);
      ctx.poller.snapshot.realtime = {
        ...BASE_ENERGY,
        lastUpdated: new Date().toISOString(),
      };
      await ctx.runOneLoop();
    }
    const afterRedundantCount =
      (await ctx.db.logs.getControllerLogs({ limit: 50, offset: 0 })).total;
    assertEquals(afterRedundantCount, 1);

    // Advance 5 minutes -> heartbeat log row is persisted
    time.tick(5 * 60_000);
    assertExists(ctx.poller.snapshot);
    ctx.poller.snapshot.realtime = {
      ...BASE_ENERGY,
      lastUpdated: new Date().toISOString(),
    };
    await ctx.runOneLoop();
    const afterHeartbeatCount =
      (await ctx.db.logs.getControllerLogs({ limit: 50, offset: 0 })).total;
    assertEquals(afterHeartbeatCount, 2);
  } finally {
    ctx.controller.stop();
    ctx.db.close();
  }
});
