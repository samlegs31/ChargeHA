import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  BASE_ENERGY,
  currentScheduleWindow,
  type MultiControllerCtx,
  REQUEST_CONTEXT,
  setupMultiVehicleController,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — per-vehicle runtime protection", () => {
  const VIN_A = "VIN_MANUAL_CHANGE";
  const VIN_B = "VIN_STABLE";
  let ctx: MultiControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  it("bypasses amp debounce only for the manually changed vehicle", async () => {
    ctx = await setupMultiVehicleController(
      [
        {
          vin: VIN_A,
          name: "Car A",
          priority: 1,
          state: { isCharging: true, chargeAmps: 10, chargePowerKw: 2.3 },
        },
        {
          vin: VIN_B,
          name: "Car B",
          priority: 2,
          state: { isCharging: true, chargeAmps: 10, chargePowerKw: 2.3 },
        },
      ],
      { ...BASE_ENERGY, solarProductionW: 7000, gridPowerW: 0 },
      { amp_debounce_threshold: "2", amp_debounce_settle_minutes: "3" },
    );
    await ctx.runOneLoop();

    const adapterA = ctx.adapters.get(VIN_A);
    const adapterB = ctx.adapters.get(VIN_B);
    assertExists(adapterA);
    assertExists(adapterB);
    adapterA.commands = [];
    adapterB.commands = [];
    adapterA.state = {
      ...adapterA.state,
      isCharging: true,
      chargeAmps: 12,
      chargePowerKw: 2.76,
    };
    await ctx.manager.requestState(VIN_A, REQUEST_CONTEXT);
    assertExists(ctx.poller.snapshot);
    ctx.poller.snapshot.realtime = {
      ...BASE_ENERGY,
      solarProductionW: 7000,
      gridPowerW: 690,
    };

    await ctx.runOneLoop();

    expect(adapterA.commands).toContainEqual({ cmd: "setAmps", args: 10 });
    expect(adapterB.commands).not.toContainEqual({ cmd: "setAmps", args: 9 });
    const logB = await ctx.getLogForVehicle(VIN_B);
    expect(logB?.checks.some((check) => check.check === "amp_debounce"))
      .toBe(true);
  });

  it("does not persistently block another vehicle's schedule", async () => {
    const { today, startTime, endTime } = currentScheduleWindow();
    ctx = await setupMultiVehicleController(
      [
        {
          vin: VIN_A,
          name: "Solar car",
          priority: 1,
          state: { isCharging: true, chargeAmps: 8, chargePowerKw: 1.84 },
        },
        { vin: VIN_B, name: "Scheduled car", priority: 2 },
      ],
      { ...BASE_ENERGY, batterySoc: 90, batteryPowerW: 1500 },
      {
        battery_priority_enabled: "true",
        battery_priority_limit: "80",
        battery_discharge_tolerance_w: "0",
        battery_discharge_grace_minutes: "0",
      },
    );
    await ctx.db.createSchedule({
      id: "only-for-car-b",
      vehicleId: VIN_B,
      scheduleType: "charge",
      startTime,
      endTime,
      days: [today],
      chargeAmps: 16,
      chargeLimitPct: null,
      enabled: true,
    });

    await ctx.runOneLoop();
    const adapterB = ctx.adapters.get(VIN_B);
    assertExists(adapterB);
    expect(adapterB.commands).not.toContainEqual({ cmd: "start" });

    adapterB.commands = [];
    assertExists(ctx.poller.snapshot);
    ctx.poller.snapshot.realtime = {
      ...BASE_ENERGY,
      batterySoc: 90,
      batteryPowerW: 0,
      solarProductionW: 5000,
      gridPowerW: -2000,
    };
    await ctx.runOneLoop();

    expect(adapterB.commands).toContainEqual({ cmd: "setAmps", args: 16 });
    expect(adapterB.commands).toContainEqual({ cmd: "start" });
  });
});
