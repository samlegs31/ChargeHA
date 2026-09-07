import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { CommandPowerGuard } from "./CommandPowerGuard.ts";
import {
  makeEnergy,
  makeState,
} from "../../../shared/engine/test-helpers/controller-engine.ts";

describe("Command power guard", () => {
  function guard(values: Record<string, string>) {
    return new CommandPowerGuard({
      getConfig: (key) => Promise.resolve(values[key] ?? null),
    });
  }

  it("applies a per-car cap to direct current commands", async () => {
    expect(
      await guard({ vehicle_current_limits: '{"V1":8}' }).limit(
        makeState(),
        32,
      ),
    ).toBe(8);
  });
  it("does not spend the same grid headroom twice between meter readings", async () => {
    const limiter = guard({ max_grid_import_kw: "4.6" });
    const energy = makeEnergy({
      gridPowerW: 0,
      lastUpdated: new Date().toISOString(),
    });
    limiter.setEnergyReader(() => ({ energy, maxAgeMs: 30000 }));
    expect(await limiter.limit(makeState({ vehicleId: "a", isHome: true }), 16))
      .toBe(16);
    expect(await limiter.limit(makeState({ vehicleId: "b", isHome: true }), 16))
      .toBe(4);
    expect(
      await limiter.limit(
        makeState({
          vehicleId: "a",
          isHome: true,
          isCharging: true,
          chargeAmps: 16,
          chargePowerKw: 3.68,
        }),
        32,
      ),
    ).toBe(16);
  });
  it("keeps the battery-reserve handoff available with zero grid import", async () => {
    const limiter = guard({
      max_grid_import_kw: "0",
      battery_priority_enabled: "true",
      battery_priority_limit: "80",
    });
    const energy = makeEnergy({
      gridPowerW: 0,
      batterySoc: 80,
      batteryPowerW: -3236,
      lastUpdated: new Date().toISOString(),
    });
    limiter.setEnergyReader(() => ({ energy, maxAgeMs: 30000 }));
    expect(await limiter.limit(makeState({ isHome: true }), 32)).toBe(14);
  });

  it("blocks commands on stale or unknown home energy when enabled", async () => {
    const limiter = guard({ max_grid_import_kw: "6" });
    limiter.setEnergyReader(() => ({
      energy: makeEnergy({ lastUpdated: "2020-01-01T00:00:00Z" }),
      maxAgeMs: 30000,
    }));
    expect(await limiter.limit(makeState({ isHome: true }), 32)).toBe(0);
    expect(await limiter.limit(makeState({ isHome: null }), 32)).toBe(0);
  });
});
