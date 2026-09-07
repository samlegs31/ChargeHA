import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ControllerEngine } from "./ControllerEngine.ts";
import {
  makeConfig,
  makeEnergy,
  makeInput,
  makeVehicle,
} from "./test-helpers/controller-engine.ts";

describe("Electrical limits in every charging mode", () => {
  it("caps Now and running charging even with automation disabled", () => {
    [true, false].forEach((chargingEnabled) => {
      const result = new ControllerEngine().decide(
        makeInput({
          configOverrides: { chargingEnabled, vehicleCurrentLimits: { V1: 8 } },
          vehicle: {
            mode: "charge_now",
            state: { isCharging: true, chargeAmps: 16 },
          },
        }),
      );
      expect(result.decisions.get("V1")?.targetAmps).toBe(8);
      expect(result.decisions.get("V1")?.reason).toBe("power_limit");
    });
  });
  it("stops rather than rounding a low configured cap up to the hardware minimum", () => {
    const result = new ControllerEngine().decide(
      makeInput({
        configOverrides: { vehicleCurrentLimits: { V1: 3 } },
        vehicle: {
          mode: "charge_now",
          state: { isCharging: true, chargeAmps: 16 },
        },
      }),
    );
    expect(result.decisions.get("V1")?.action).toBe("stop");
  });
  it("shares a grid budget across both manual vehicles", () => {
    const vehicles = [
      makeVehicle({ id: "a", mode: "charge_now", priority: 1 }),
      makeVehicle({ id: "b", mode: "charge_now", priority: 2 }),
    ];
    const output = new ControllerEngine().decide(
      makeInput({
        vehicles,
        config: makeConfig({ maxGridImportKw: 4.6 }),
        energy: makeEnergy({ gridPowerW: 0 }),
      }),
    );
    expect([...output.decisions.values()].map((d) => d.targetAmps)).toEqual([
      10,
      10,
    ]);
  });
  it("does not block solar handoff at the reserve with a zero-import limit", () => {
    const result = new ControllerEngine().decide(makeInput({
      configOverrides: {
        maxGridImportKw: 0,
        batteryPriorityEnabled: true,
        batteryPriorityLimit: 80,
      },
      energyOverrides: {
        gridPowerW: 0,
        batterySoc: 80,
        batteryPowerW: -3236,
        solarProductionW: 3688,
      },
    }));
    expect(result.decisions.get("V1")?.action).toBe("start");
    expect(result.decisions.get("V1")?.targetAmps).toBe(14);
  });

  it("fails closed on missing energy when a grid limit is configured, including Now", () => {
    const result = new ControllerEngine().decide(
      makeInput({
        energy: null,
        configOverrides: { maxGridImportKw: 6 },
        vehicle: { mode: "charge_now" },
      }),
    );
    expect(result.decisions.get("V1")?.action).toBe("none");
    expect(result.decisions.get("V1")?.reason).toBe("power_limit");
  });
  it("does not interrupt away charging to enforce a home grid limit", () => {
    const result = new ControllerEngine().decide(
      makeInput({
        configOverrides: { maxGridImportKw: 0 },
        vehicle: { state: { isHome: false, isCharging: true, chargeAmps: 16 } },
      }),
    );
    expect(result.decisions.get("V1")?.action).toBe("none");
  });
});
