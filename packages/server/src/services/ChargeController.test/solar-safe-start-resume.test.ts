import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type { VehicleMode } from "@chargeha/shared";
import {
  BASE_ENERGY,
  type ControllerCtx,
  REQUEST_CONTEXT,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — Solar safe-start regulation resume", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  async function expectImmediateResume(mode: VehicleMode): Promise<void> {
    ctx = await setupController(
      {
        isCharging: false,
        chargeAmps: 20,
        chargeAmpsMin: 5,
        chargerVoltage: 230,
      },
      mode,
      { ...BASE_ENERGY, gridPowerW: -1380 },
      {
        amp_debounce_threshold: "2",
        amp_debounce_settle_minutes: "3",
      },
    );

    // The first pass must physically start at the safe 5A minimum even though
    // the available solar supports 6A.
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).toEqual([
      { cmd: "setAmps", args: 5 },
      { cmd: "start" },
    ]);

    // Once the 5A load appears at the meter, add-back reconstructs the same
    // 1380W surplus. The next pass must ramp to 6A without the normal 3-minute
    // debounce intended for steady-state fluctuations.
    ctx.adapter.commands = [];
    assertExists(ctx.poller.snapshot);
    ctx.poller.snapshot.realtime = {
      ...BASE_ENERGY,
      gridPowerW: -230,
    };
    await ctx.runOneLoop();

    expect(ctx.adapter.commands).toContainEqual({ cmd: "setAmps", args: 6 });
    expect((await ctx.getLastLogParsed())?.targetAmps).toBe(6);
  }

  it("ramps Solar + Clock above 5A on the next controller pass", async () => {
    await expectImmediateResume("auto");
  });

  it("ramps Solar Only above 5A on the next controller pass", async () => {
    await expectImmediateResume("vacation");
  });

  it("ramps after Tesla resumes at 5A following a charge-limit increase", async () => {
    ctx = await setupController(
      {
        isCharging: false,
        chargeAmps: 5,
        chargeAmpsMin: 5,
        chargerVoltage: 230,
      },
      "auto",
      { ...BASE_ENERGY, gridPowerW: 0 },
      {
        amp_debounce_threshold: "2",
        amp_debounce_settle_minutes: "3",
      },
    );

    // First establish that the controller saw the car stopped. Raising the
    // Tesla charge limit can then resume charging independently at the 5A
    // value pre-armed by TeslaVehicleMiddleware.
    await ctx.runOneLoop();
    ctx.adapter.state = {
      ...ctx.adapter.state,
      isCharging: true,
      chargeAmps: 5,
      chargePowerKw: 1.15,
    };
    await ctx.manager.requestState(VIN, REQUEST_CONTEXT);

    ctx.adapter.commands = [];
    assertExists(ctx.poller.snapshot);
    ctx.poller.snapshot.realtime = {
      ...BASE_ENERGY,
      gridPowerW: -230,
    };
    await ctx.runOneLoop();

    expect(ctx.adapter.commands).toContainEqual({ cmd: "setAmps", args: 6 });
  });
});
