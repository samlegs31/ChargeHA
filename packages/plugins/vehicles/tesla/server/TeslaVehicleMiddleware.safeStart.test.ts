import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { VehicleAdapter } from "@chargeha/shared";
import { buildVehicleChargeState } from "@chargeha/shared/test-factories";
import { Logger } from "@chargeha/server/lib/Logger";
import { TeslaVehicleMiddleware } from "./TeslaVehicleMiddleware.ts";
import { MockTeslaAdapter } from "./test-helpers/MockTeslaAdapter.ts";

describe("Tesla solar safe start", () => {
  const testLogger = new Logger("TeslaSafeStartTest", "error");
  const callContext = (origin: string) => ({ origin, traceId: "test" });

  function buildHarness(
    overrides: Parameters<typeof buildVehicleChargeState>[0],
  ) {
    const adapter = new MockTeslaAdapter();
    const middleware = new TeslaVehicleMiddleware(
      adapter as unknown as VehicleAdapter,
      testLogger,
    );
    middleware.seedState(buildVehicleChargeState(overrides));
    return { adapter, middleware };
  }

  it("pre-arms 5A before an increased charge limit can resume charging", async () => {
    const { adapter, middleware } = buildHarness({
      batteryLevel: 90,
      chargeLimit: 90,
      isCharging: false,
      isPluggedIn: true,
      chargeAmps: 20,
      chargeAmpsMin: 5,
    });
    const calls: string[] = [];
    adapter.setChargeAmps = (amps: number, _ctx: unknown) => {
      calls.push(`amps:${amps}`);
      return Promise.resolve(true);
    };
    adapter.setChargeLimit = (percent: number) => {
      calls.push(`limit:${percent}`);
      return Promise.resolve(true);
    };

    const ok = await middleware.setChargeLimit(
      91,
      callContext("user:set-charge-limit"),
    );

    expect(ok).toBe(true);
    expect(calls).toEqual(["amps:5", "limit:91"]);
    expect(middleware.getCachedState()?.chargeAmps).toBe(5);
    expect(middleware.getCachedState()?.chargeLimit).toBe(91);
  });

  it("forces a stopped Solar + Clock start to the hardware minimum", async () => {
    const { adapter, middleware } = buildHarness({
      isCharging: false,
      isPluggedIn: true,
      chargeAmps: 20,
      chargeAmpsMin: 5,
    });
    const ampsSent: number[] = [];
    adapter.setChargeAmps = (amps: number, _ctx: unknown) => {
      ampsSent.push(amps);
      return Promise.resolve(true);
    };

    await middleware.setChargeAmps(
      12,
      callContext("controller:solar_tracking:set-amps"),
    );

    expect(ampsSent).toEqual([5]);
    expect(middleware.getCachedState()?.chargeAmps).toBe(5);
  });

  it("forces a stopped Solar Only start to the hardware minimum", async () => {
    const { adapter, middleware } = buildHarness({
      isCharging: false,
      isPluggedIn: true,
      chargeAmps: 20,
      chargeAmpsMin: 5,
    });
    const ampsSent: number[] = [];
    adapter.setChargeAmps = (amps: number, _ctx: unknown) => {
      ampsSent.push(amps);
      return Promise.resolve(true);
    };

    await middleware.setChargeAmps(
      14,
      callContext("controller:vacation:set-amps"),
    );

    expect(ampsSent).toEqual([5]);
  });

  it("pre-arms 5A before charge_start when the amp command was skipped", async () => {
    const { adapter, middleware } = buildHarness({
      isCharging: false,
      isPluggedIn: true,
      chargeAmps: 12,
      chargeAmpsMin: 5,
    });
    const calls: string[] = [];
    adapter.setChargeAmps = (amps: number, _ctx: unknown) => {
      calls.push(`amps:${amps}`);
      return Promise.resolve(true);
    };
    adapter.startCharging = (_ctx: unknown) => {
      calls.push("start");
      return Promise.resolve(true);
    };

    const ok = await middleware.startCharging(
      callContext("controller:solar_tracking:start"),
    );

    expect(ok).toBe(true);
    expect(calls).toEqual(["amps:5", "start"]);
    expect(middleware.getCachedState()?.chargeAmps).toBe(5);
  });

  it("does not pre-arm a manual charge_start", async () => {
    const { adapter, middleware } = buildHarness({
      isCharging: false,
      isPluggedIn: true,
      chargeAmps: 20,
      chargeAmpsMin: 5,
    });

    const ok = await middleware.startCharging(
      callContext("user:command:start"),
    );

    expect(ok).toBe(true);
    expect(adapter.setChargeAmpsCalls).toBe(0);
    expect(adapter.startChargingCalls).toBe(1);
  });

  it("allows normal solar regulation after charging has started", async () => {
    const { adapter, middleware } = buildHarness({
      isCharging: true,
      isPluggedIn: true,
      chargeAmps: 5,
      chargeAmpsMin: 5,
    });
    const ampsSent: number[] = [];
    adapter.setChargeAmps = (amps: number, _ctx: unknown) => {
      ampsSent.push(amps);
      return Promise.resolve(true);
    };

    await middleware.setChargeAmps(
      10,
      callContext("controller:solar_tracking:set-amps"),
    );

    expect(ampsSent).toEqual([10]);
    expect(middleware.getCachedState()?.chargeAmps).toBe(10);
  });

  it("does not alter a manual current command while stopped", async () => {
    const { adapter, middleware } = buildHarness({
      isCharging: false,
      isPluggedIn: true,
      chargeAmps: 5,
      chargeAmpsMin: 5,
    });
    const ampsSent: number[] = [];
    adapter.setChargeAmps = (amps: number, _ctx: unknown) => {
      ampsSent.push(amps);
      return Promise.resolve(true);
    };

    await middleware.setChargeAmps(16, callContext("user:set-amps"));

    expect(ampsSent).toEqual([16]);
  });
});
