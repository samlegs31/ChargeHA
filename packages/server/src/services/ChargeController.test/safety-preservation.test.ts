import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  type ControllerCtx,
  REQUEST_CONTEXT,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("September/October safety invariants", () => {
  let ctx: ControllerCtx | undefined;
  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  it("stops an ongoing automatic charge when the manual switch is OFF", async () => {
    ctx = await setupController({ isCharging: true, chargeAmps: 8 });
    await ctx.db.setConfig("charging_enabled", "false");
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
    expect(await ctx.db.getConfig("charging_enabled")).toBe("false");
  });

  it("stops when a refresh fails with a cached active charge", async () => {
    ctx = await setupController({ isCharging: true, chargeAmps: 8 });
    ctx.adapter.getChargeState = () =>
      Promise.reject(new Error("telemetry lost"));
    await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
    expect(ctx.manager.hasVehicleFetchError(VIN)).toBe(true);
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
    expect((await ctx.getLastLogParsed())?.actionDetail).toContain(
      "refresh failed",
    );
  });

  it("does not command or poll an externally controlled vehicle", async () => {
    ctx = await setupController({ isCharging: true, chargeAmps: 8 });
    await ctx.db.setConfig(
      "external_charging_vehicles",
      JSON.stringify({ [VIN]: true }),
    );
    ctx.adapter.getChargeState = () => {
      throw new Error("must not poll");
    };
    ctx.adapter.commands = [];
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).toEqual([]);
    expect(ctx.manager.hasVehicleFetchError(VIN)).toBe(false);
    expect(await ctx.getLastLogParsed()).toBeNull();
  });
});
