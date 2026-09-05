import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ControllerEngine } from "./ControllerEngine.ts";
import { makeInput } from "./test-helpers/controller-engine.ts";

describe("home battery priority solar handoff", () => {
  it("starts the EV at the configured SOC threshold using solar still charging the home battery", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: {
        batteryPriorityEnabled: true,
        batteryPriorityLimit: 80,
        solarMarginKw: 0,
        minExcessSolarKw: null,
      },
      energyOverrides: {
        solarProductionW: 3500,
        gridPowerW: 0,
        batterySoc: 80,
        batteryPowerW: -2000,
      },
      vehicle: {
        state: {
          isCharging: false,
          chargeAmpsMin: 5,
          chargerVoltage: 230,
          chargerPhases: 1,
          isHome: true,
        },
      },
    }));

    const decision = output.decisions.get("V1");
    expect(decision?.action).toBe("start");
    expect(decision?.targetAmps).toBeGreaterThanOrEqual(5);
  });

  it("keeps the home battery first below the configured SOC threshold", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: {
        batteryPriorityEnabled: true,
        batteryPriorityLimit: 80,
        solarMarginKw: 0,
        minExcessSolarKw: null,
      },
      energyOverrides: {
        solarProductionW: 3500,
        gridPowerW: 0,
        batterySoc: 79,
        batteryPowerW: -2000,
      },
    }));

    const decision = output.decisions.get("V1");
    expect(decision?.action).toBe("none");
    expect(decision?.reason).toBe("battery_priority");
  });

  it("does not reclaim home-battery charging when battery priority is disabled", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: {
        batteryPriorityEnabled: false,
        batteryPriorityLimit: 80,
        solarMarginKw: 0,
        minExcessSolarKw: null,
      },
      energyOverrides: {
        solarProductionW: 3500,
        gridPowerW: 0,
        batterySoc: 80,
        batteryPowerW: -2000,
      },
    }));

    const decision = output.decisions.get("V1");
    expect(decision?.action).toBe("none");
    expect(decision?.detail).toContain("solar");
  });
});
