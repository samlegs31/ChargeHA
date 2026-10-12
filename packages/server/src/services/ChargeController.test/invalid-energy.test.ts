import { assert, assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  BASE_ENERGY,
  setupController,
} from "../../test-helpers/ChargeControllerHarness.ts";

Deno.test("non-finite inverter readings never start solar charging and stop active charging after grace", async () => {
  using time = new FakeTime(Date.UTC(2026, 9, 11, 12));
  for (
    const field of [
      "solarProductionW",
      "gridPowerW",
      "homeConsumptionW",
      "batteryPowerW",
      "batterySoc",
      "gridVoltageV",
    ] as const
  ) {
    for (const value of [NaN, Infinity, -Infinity]) {
      for (const active of [false, true]) {
        const ctx = await setupController(
          { isCharging: active, chargeAmps: active ? 8 : 0 },
          "auto",
          {
            ...BASE_ENERGY,
            [field]: value,
            lastUpdated: new Date().toISOString(),
          },
        );
        try {
          await ctx.runOneLoop();
          assert(
            !ctx.adapter.commands.some((c) => c.cmd === "start"),
            `${field}=${value}`,
          );
          assert(
            (await ctx.getLastLogParsed())?.checks.some((c) =>
              c.check === "energy_availability"
            ),
            `${field} must invalidate the sample`,
          );
          time.tick(91_000);
          await ctx.runOneLoop();
          assertEquals(
            ctx.adapter.state.isCharging,
            false,
            `${field}=${value}`,
          );
          for (const command of ctx.adapter.commands) {
            if (command.cmd === "setAmps") {
              assert(Number.isFinite(command.args));
            }
          }
        } finally {
          ctx.controller.stop();
          ctx.db.close();
        }
      }
    }
  }
});
