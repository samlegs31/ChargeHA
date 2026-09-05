import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  BASE_ENERGY,
  type ControllerCtx,
  setupController,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — battery reserve handoff", () => {
  const reserveConfig = {
    battery_priority_enabled: "true",
    battery_priority_limit: "80",
    min_excess_solar_kw: "1",
  };
  const solarIntoBattery = {
    ...BASE_ENERGY,
    solarProductionW: 3688,
    homeConsumptionW: 376,
    gridPowerW: 0,
    batteryPowerW: -3236,
    batterySoc: 79.8,
  };

  let ctx: ControllerCtx | undefined;
  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  (["auto", "vacation"] as const).forEach((mode) => {
    it(`${mode}: starts at 5A at 80% without export, then follows surplus`, async () => {
      ctx = await setupController(
        { chargeAmps: 20 },
        mode,
        solarIntoBattery,
        reserveConfig,
      );
      await ctx.runOneLoop();
      expect(ctx.adapter.commands).not.toContainEqual({ cmd: "start" });
      assertExists(ctx.poller.snapshot);
      ctx.poller.snapshot.realtime = { ...solarIntoBattery, batterySoc: 80 };
      ctx.adapter.commands = [];
      await ctx.runOneLoop();
      expect(ctx.adapter.commands).toEqual([{ cmd: "setAmps", args: 5 }, {
        cmd: "start",
      }]);

      // The inverter supplies the new EV load by reducing BYD charging.
      ctx.poller.snapshot.realtime = {
        ...solarIntoBattery,
        batterySoc: 80.2,
        batteryPowerW: -2086,
      };
      ctx.adapter.commands = [];
      await ctx.runOneLoop();
      expect(ctx.adapter.commands).toContainEqual({ cmd: "setAmps", args: 14 });

      ctx.poller.snapshot.realtime = {
        ...solarIntoBattery,
        batterySoc: 80.2,
        batteryPowerW: -16,
      };
      ctx.adapter.commands = [];
      await ctx.runOneLoop();
      expect(ctx.adapter.commands).toEqual([]);

      ctx.poller.snapshot.realtime = {
        ...solarIntoBattery,
        batterySoc: 79.9,
        batteryPowerW: 0,
      };
      await ctx.runOneLoop();
      expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
    });
  });

  it("does not start from reclaimed power while energy data is unavailable", async () => {
    ctx = await setupController({}, "vacation", {
      ...solarIntoBattery,
      batterySoc: 90,
      pollFailed: true,
    }, reserveConfig);
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).not.toContainEqual({ cmd: "start" });
  });

  it("does not start a confirmed away car after reaching the reserve", async () => {
    ctx = await setupController(
      { latitude: 0, longitude: 0, isHome: false },
      "vacation",
      { ...solarIntoBattery, batterySoc: 90 },
      reserveConfig,
    );
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).not.toContainEqual({ cmd: "start" });
  });
});
