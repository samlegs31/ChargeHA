import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  BASE_ENERGY,
  type ControllerCtx,
  REQUEST_CONTEXT,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — manual amperage recovery", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  it("reclaims solar control on the next cycle after a small manual amp change", async () => {
    // 10A at 230V with zero grid flow means the controller sees exactly
    // 2300W available after adding the EV load back, so 10A is the target.
    ctx = await setupController(
      { isCharging: true, chargeAmps: 10, chargePowerKw: 2.3 },
      "auto",
      { ...BASE_ENERGY, solarProductionW: 5000, gridPowerW: 0 },
      {
        amp_debounce_threshold: "2",
        amp_debounce_settle_minutes: "3",
      },
    );

    // First loop establishes the controller-owned previous state at 10A.
    await ctx.runOneLoop();
    expect((await ctx.getLastLogParsed())?.action).toBe("none");

    // User/Tesla app raises the current to 12A. The extra 460W is now imported,
    // leaving the controller's solar target at 10A. This is only a 2A delta,
    // which used to be swallowed by the 3-minute debounce.
    ctx.adapter.commands = [];
    ctx.adapter.state = {
      ...ctx.adapter.state,
      isCharging: true,
      chargeAmps: 12,
      chargePowerKw: 2.76,
    };
    await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
    assertExists(ctx.poller.snapshot);
    ctx.poller.snapshot.realtime = {
      ...BASE_ENERGY,
      solarProductionW: 5000,
      gridPowerW: 460,
    };

    await ctx.runOneLoop();

    expect(ctx.adapter.commands).toContainEqual({ cmd: "setAmps", args: 10 });
    const log = await ctx.getLastLogParsed();
    expect(log?.action).toBe("adjust_amps");
    expect(log?.targetAmps).toBe(10);
  });
});
