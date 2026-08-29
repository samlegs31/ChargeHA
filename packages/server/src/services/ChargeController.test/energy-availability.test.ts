import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  BASE_ENERGY,
  type ControllerCtx,
  setupController,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — energy availability", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  it("reduces an active automatic charge to minimum on poll failure", async () => {
    ctx = await setupController(
      { isCharging: true, chargeAmps: 16, chargePowerKw: 3.68 },
      "auto",
      { ...BASE_ENERGY, pollFailed: true },
    );

    await ctx.runOneLoop();

    expect(ctx.adapter.commands).toContainEqual({ cmd: "setAmps", args: 5 });
    expect(
      (await ctx.getLastLogParsed())?.checks.some(
        (check) => check.check === "energy_availability",
      ),
    ).toBe(true);
  });

  it("does not start from a stale successful reading", async () => {
    ctx = await setupController({}, "auto", {
      ...BASE_ENERGY,
      lastUpdated: "2020-01-01T00:00:00.000Z",
    });
    ctx.poller.maxRealtimeAgeMs = 30_000;

    await ctx.runOneLoop();

    expect(ctx.adapter.commands).not.toContainEqual({ cmd: "start" });
    expect(
      (await ctx.getLastLogParsed())?.checks.some(
        (check) => check.check === "energy_availability",
      ),
    ).toBe(true);
  });

  it("requires two distinct valid readings before automatic recovery", async () => {
    ctx = await setupController({}, "auto", {
      ...BASE_ENERGY,
      pollFailed: true,
    });
    await ctx.runOneLoop();
    assertExists(ctx.poller.snapshot);

    ctx.adapter.commands = [];
    ctx.poller.snapshot.realtime = {
      ...BASE_ENERGY,
      lastUpdated: "2026-08-29T10:00:00.000Z",
    };
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).not.toContainEqual({ cmd: "start" });
    expect(
      (await ctx.getLastLogParsed())?.checks.some(
        (check) => check.check === "energy_availability",
      ),
    ).toBe(true);

    ctx.poller.snapshot.realtime = {
      ...BASE_ENERGY,
      lastUpdated: "2026-08-29T10:00:10.000Z",
    };
    await ctx.runOneLoop();
    expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
  });

  it("allows explicit Charge Now during an energy outage", async () => {
    ctx = await setupController({}, "charge_now", {
      ...BASE_ENERGY,
      pollFailed: true,
    });

    await ctx.runOneLoop();

    expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
    expect(ctx.adapter.commands).toContainEqual({ cmd: "setAmps", args: 32 });
  });
});
