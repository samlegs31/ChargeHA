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

  it("permits scheduled off-peak charging during battery discharge and stops once schedule ends", async () => {
    const { today, startTime, endTime } = currentScheduleWindow();
    ctx = await setupController(
      { isCharging: true, chargeAmps: 16, chargePowerKw: 3.68 },
      "auto",
      { ...BASE_ENERGY, batterySoc: 90, batteryPowerW: 1200 },
      {
        battery_priority_enabled: "true",
        battery_priority_limit: "80",
        battery_discharge_tolerance_w: "0",
        battery_discharge_grace_minutes: "0",
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

    // Scheduled charging intentionally permits grid use during the window.
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).not.toContainEqual({ cmd: "stop" });
    const scheduledLog = await ctx.getLastLogParsed();
    expect(scheduledLog?.targetAmps).toBe(16);

    // Once the schedule window ends, battery protection immediately stops the car.
    ctx.adapter.commands = [];
    await ctx.db.updateSchedule("unsafe-off-peak", { enabled: false });
    assertExists(ctx.poller.snapshot);
    await ctx.manager.requestState(VIN, REQUEST_CONTEXT);

    await ctx.runOneLoop();

    expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
    const log = await ctx.getLastLogParsed();
    expect(log?.action).toBe("stop");
  });
});
