import { Overseer } from "../Overseer.ts";
import { Logger } from "../../lib/Logger.ts";
import { testable } from "../../test-helpers/Testable.ts";
import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  type ControllerCtx,
  REQUEST_CONTEXT,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("combined failures and in-flight safety commands", () => {
  let ctx: ControllerCtx | undefined;
  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  it("retries STOP after telemetry loss and rejected STOP, even with fresh cache", async () => {
    ctx = await setupController({ isCharging: true, chargeAmps: 8 });
    ctx.adapter.getChargeState = () =>
      Promise.reject(new Error("telemetry lost"));
    await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
    ctx.adapter.stopChargingResult = false;
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
    expect((await ctx.getLastLogParsed())?.action).toBe("none");
    ctx.adapter.commands = [];
    ctx.adapter.stopChargingResult = true;
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).toEqual([{ cmd: "stop" }]);
    expect(ctx.adapter.state.isCharging).toBe(false);
  });

  it("does not restart from stale stopped telemetry while the outage persists", async () => {
    ctx = await setupController({ isCharging: true, chargeAmps: 8 });
    ctx.adapter.getChargeState = () =>
      Promise.reject(new Error("telemetry lost"));
    await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
    await ctx.runOneLoop();
    expect(ctx.adapter.state.isCharging).toBe(false);
    ctx.adapter.commands = [];
    await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).toEqual([]);
    expect(ctx.adapter.state.isCharging).toBe(false);
  });

  it("real Overseer failure is retried by the controller without changing the user switch", async () => {
    ctx = await setupController({ isCharging: true, chargeAmps: 8 });
    await ctx.db.setConfig("charging_enabled", "true");
    for (const action of ["start", "stop", "start", "stop", "start"] as const) {
      await ctx.db.insertControllerLogEntries([{
        vehicleId: VIN,
        vehicleName: "Test",
        mode: "auto",
        inputsJson: "{}",
        checksJson: "{}",
        action,
        actionDetail: action,
        targetAmps: null,
        traceId: "trip",
      }]);
    }
    const overseer = new Overseer(
      ctx.db,
      ctx.trackingEmitter,
      new Logger("test", "error"),
      ctx.manager,
    );
    overseer.stop();
    ctx.adapter.stopChargingResult = false;
    await testable(overseer).check();
    expect(await ctx.db.getConfig("oscillation_paused")).toBe("true");
    expect(await ctx.db.getConfig("system_alert")).toContain(
      "Emergency STOP failed",
    );
    expect(await ctx.db.getConfig("charging_enabled")).toBe("true");
    ctx.adapter.stopChargingResult = true;
    await ctx.runOneLoop();
    expect(ctx.adapter.state.isCharging).toBe(false);
    expect(await ctx.db.getConfig("charging_enabled")).toBe("true");
    ctx.adapter.commands = [];
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).toEqual([]);
  });

  it("STOP queued during START stops the newly started car despite its old snapshot", async () => {
    ctx = await setupController({ isCharging: false, chargeAmps: 0 });
    const state = await ctx.manager.getState(VIN);
    assertExists(state);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = ctx.adapter.setChargeAmps.bind(ctx.adapter);
    ctx.adapter.setChargeAmps = async (amps, origin) => {
      entered.resolve();
      await release.promise;
      return original(amps, origin);
    };
    const start = ctx.manager.startChargingAt(VIN, 8, {
      origin: "controller",
      traceId: "race",
    }, state);
    await entered.promise;
    const stop = ctx.manager.stopCharging(
      VIN,
      { origin: "overseer:safety-trip", traceId: "race" },
      state,
      { force: true },
    );
    release.resolve();
    await start;
    expect((await stop).success).toBe(true);
    expect(ctx.adapter.commands.at(-1)).toEqual({ cmd: "stop" });
    expect(ctx.adapter.state.isCharging).toBe(false);
  });
});
