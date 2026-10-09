import { expect } from "@std/expect";
import {
  BASE_ENERGY,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

for (const mode of ["auto", "vacation", "charge_now"] as const) {
  Deno.test(`configured 22A solar cap reaches adapter in ${mode}`, async () => {
    const ctx = await setupController(
      {
        isCharging: true,
        chargeAmps: 32,
        chargeAmpsActual: 32,
        chargeAmpsMax: 32,
        chargePowerKw: 7.36,
      },
      mode,
      { ...BASE_ENERGY, solarProductionW: 12000, gridPowerW: -5000 },
      { vehicle_solar_current_limits: JSON.stringify({ [VIN]: 22 }) },
    );
    try {
      await ctx.runOneLoop();
      if (mode === "charge_now") {
        expect(ctx.adapter.state.chargeAmps).toBe(32);
        expect(ctx.adapter.commands).not.toContainEqual({
          cmd: "setAmps",
          args: 22,
        });
      } else {
        expect(ctx.adapter.commands).toContainEqual({
          cmd: "setAmps",
          args: 22,
        });
        expect(ctx.adapter.state.chargeAmps).toBe(22);
      }
    } finally {
      ctx.controller.stop();
      ctx.db.close();
    }
  });
}
