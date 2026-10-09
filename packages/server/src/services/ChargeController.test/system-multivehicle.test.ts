import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  BASE_ENERGY,
  setupMultiVehicleController,
} from "../../test-helpers/ChargeControllerHarness.ts";

for (const priority of [false, true]) {
  Deno.test(`seeded multi-vehicle electrical simulation, priority=${priority}`, async () => {
    using time = new FakeTime(Date.UTC(2026, 5, 15, 10));
    const ctx = await setupMultiVehicleController(
      [
        {
          vin: "A",
          name: "A",
          priority: 1,
          mode: "charge_now",
          state: { chargeAmpsMax: 16 },
        },
        {
          vin: "B",
          name: "B",
          priority: 2,
          mode: "charge_now",
          state: { chargeAmpsMax: 16 },
        },
        {
          vin: "EXTERNAL",
          name: "External",
          priority: 3,
          state: { isCharging: true, chargeAmps: 5 },
        },
      ],
      BASE_ENERGY,
      {
        max_grid_import_kw: "3",
        priority_charging_enabled: String(priority),
        vehicle_current_limits: JSON.stringify({ A: 12, B: 16 }),
      },
    );
    await ctx.db.setConfig(
      "external_charging_vehicles",
      JSON.stringify({ EXTERNAL: true }),
    );
    let seed = 8731;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let adjustments = 0;
    try {
      for (let tick = 0; tick < 720; tick++) {
        time.tick(10_000);
        const solar = Math.floor(next() * 7000);
        const house = 500 + Math.floor(next() * 1400);
        let measuredW = 0;
        for (const adapter of ctx.adapters.values()) {
          const amps = adapter.state.isCharging ? adapter.state.chargeAmps : 0;
          adapter.state.chargeAmpsActual = amps;
          adapter.state.chargePowerKw = amps * 0.23;
          measuredW += amps * 230;
        }
        assertExists(ctx.poller.snapshot);
        ctx.poller.snapshot.realtime = {
          ...BASE_ENERGY,
          solarProductionW: solar,
          homeConsumptionW: house + measuredW,
          gridPowerW: house + measuredW - solar,
          lastUpdated: new Date().toISOString(),
        };
        const external = ctx.adapters.get("EXTERNAL");
        assertExists(external);
        const externalCommands = external.commands.length;
        await ctx.runOneLoop();
        expect(external.commands.length).toBe(externalCommands);
        let controlledW = 0;
        for (const id of ["A", "B"]) {
          const adapter = ctx.adapters.get(id);
          assertExists(adapter);
          const amps = adapter.state.isCharging ? adapter.state.chargeAmps : 0;
          expect(amps).toBeLessThanOrEqual(id === "A" ? 12 : 16);
          expect(amps === 0 || amps >= 5).toBe(true);
          controlledW += amps * 230;
          adjustments += adapter.commands.filter((c) =>
            c.cmd === "setAmps"
          ).length;
          adapter.commands = [];
        }
        // The fixed external EV consumes 1150 W; the controller may only use
        // the remaining installation budget. No optimistic cache used here.
        expect(controlledW).toBeLessThanOrEqual(
          Math.max(0, 3000 + solar - house - 1150) + 1,
        );
      }
      expect(adjustments).toBeGreaterThan(100);
      console.log(
        "MULTI_SIMULATION",
        JSON.stringify({
          ticks: 720,
          hours: 2,
          vehicles: 3,
          priority,
          adjustments,
          seed: 8731,
        }),
      );
    } finally {
      ctx.controller.stop();
      ctx.db.close();
    }
  });
}
