import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { SolarAllocator } from "./SolarAllocator.ts";
import {
  makeConfig,
  makeEnergy,
  makeVehicle,
} from "./test-helpers/controller-engine.ts";

describe("Solar allocation after home battery reserve", () => {
  const config = makeConfig({
    batteryPriorityEnabled: true,
    batteryPriorityLimit: 80,
  });
  const energy = makeEnergy({
    solarProductionW: 3688,
    gridPowerW: 0,
    batteryPowerW: -3236,
    batterySoc: 80,
  });

  it("releases solar absorbed by the battery at the exact threshold", () => {
    expect(SolarAllocator.resolveAvailableW(config, energy, 0)).toBe(3236);
  });

  it("keeps that power reserved below the threshold or with unknown SOC", () => {
    [79.9, null, NaN, Infinity].forEach((batterySoc) => {
      expect(
        SolarAllocator.resolveAvailableW(config, { ...energy, batterySoc }, 0),
      ).toBe(0);
    });
  });

  it("does not reinterpret installations without an enabled reserve", () => {
    expect(
      SolarAllocator.resolveAvailableW(
        { ...config, batteryPriorityEnabled: false },
        energy,
        0,
      ),
    ).toBe(0);
  });

  it("subtracts grid import and the safety margin from reclaimed charging", () => {
    expect(
      SolarAllocator.resolveAvailableW({ ...config, solarMarginKw: 0.2 }, {
        ...energy,
        gridPowerW: 2000,
      }, 0),
    ).toBe(1036);
  });

  it("never counts home battery discharge as solar after the reserve", () => {
    expect(
      SolarAllocator.resolveAvailableW(config, {
        ...energy,
        batteryPowerW: 2500,
      }, 2000),
    ).toBe(0);
  });

  it("does not count unknown battery power and caps the total at PV output", () => {
    expect(
      SolarAllocator.resolveAvailableW(config, {
        ...energy,
        batteryPowerW: null,
      }, 0),
    ).toBe(0);
    expect(SolarAllocator.resolveAvailableW(config, energy, 2000)).toBe(3688);
  });

  it("shares reclaimed power once across two cars", () => {
    const vehicles = ["V1", "V2"].map((id, index) =>
      makeVehicle({ id, priority: index + 1, state: { chargeAmpsMax: 12 } })
    );
    const surplus = { ...energy, solarProductionW: 5000, batteryPowerW: -4600 };
    expect([...SolarAllocator.equal(vehicles, config, surplus).values()])
      .toEqual([10, 10]);
    expect([...SolarAllocator.waterfall(vehicles, config, surplus).values()])
      .toEqual([12, 8]);
  });
});
