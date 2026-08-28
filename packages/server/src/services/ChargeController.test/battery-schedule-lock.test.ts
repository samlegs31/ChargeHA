import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  BASE_ENERGY,
  type ControllerCtx,
  currentScheduleWindow,
  REQUEST_CONTEXT,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — battery-protected schedule lock", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  it("does not restart the scheduled current after battery discharge clears", async () => {
    const { today, startTime, endTime } = currentScheduleWindow();
    ctx = await setupController(
      { isCharging: true, chargeAmps: 16, chargePowerKw: 3.68 },
      "auto",
      { ...BASE_ENERGY, batterySoc: 90, batteryPowerW: 1200 },
      {
        battery_priority_enabled: "true",
        battery_priority_limit: "80",
        battery_discharge_tolerance_w: "0",
        battery_discharge_grace_minutes: "5",
      },
    );
    await ctx.db.createSchedule({
      id: "unsafe-off-peak",
      vehicleId: VIN,
      scheduleType: "charge",
      startTime,
      endTime,
      days: [today],
      chargeAmps: 16,
      chargeLimitPct: null,
      enabled: true,
    });

    // The first protected cycle sees battery discharge and stops the car.
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });

    // Once stopped, battery discharge disappears. The same Off-Peak window
    // must remain blocked instead of immediately commanding 16A again.
    ctx.adapter.commands = [];
    ctx.adapter.state = {
      ...ctx.adapter.state,
      isCharging: false,
      chargeAmps: 0,
      chargePowerKw: 0,
    };
    await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
    assertExists(ctx.poller.snapshot);
    ctx.poller.snapshot.realtime = {
      ...BASE_ENERGY,
      batterySoc: 90,
      batteryPowerW: 0,
      solarProductionW: 5000,
      gridPowerW: -2000,
    };

    await ctx.runOneLoop();

    expect(ctx.adapter.commands).not.toContainEqual({
      cmd: "setAmps",
      args: 16,
    });
    const log = await ctx.getLastLogParsed();
    expect(log?.targetAmps).not.toBe(16);
  });
});
