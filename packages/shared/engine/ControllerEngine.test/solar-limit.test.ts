import { expect } from "@std/expect";
import { ControllerEngine } from "../ControllerEngine.ts";
import { makeInput, makeVehicle } from "../test-helpers/controller-engine.ts";

Deno.test("solar cap limits starts and immediately reduces running current in both solar modes", () => {
  for (const mode of ["auto", "vacation"] as const) {
    for (const current of [0, 23, 32]) {
      const result = new ControllerEngine().decide(makeInput({
        configOverrides: { vehicleSolarCurrentLimits: { V1: 22 } },
        vehicle: {
          mode,
          state: { isCharging: current > 0, chargeAmps: current },
        },
        energyOverrides: { solarProductionW: 12000, gridPowerW: -10000 },
      })).decisions.get("V1");
      expect(result?.targetAmps).toBe(22);
      expect(result?.action).toBe(current ? "adjust_amps" : "start");
    }
  }
});

Deno.test("solar cap preserves lower hardware and electrical limits", () => {
  for (const hardware of [16, 32]) {
    const result = new ControllerEngine().decide(makeInput({
      configOverrides: {
        vehicleSolarCurrentLimits: { V1: 22 },
        vehicleCurrentLimits: { V1: 20 },
      },
      vehicle: { state: { chargeAmpsMax: hardware, isHome: true } },
      energyOverrides: { solarProductionW: 12000, gridPowerW: -10000 },
    })).decisions.get("V1");
    expect(result?.targetAmps).toBe(Math.min(hardware, 20));
  }
});

Deno.test("solar cap does not limit charge now or a charge schedule", () => {
  for (const mode of ["charge_now", "auto"] as const) {
    const result = new ControllerEngine().decide(makeInput({
      configOverrides: {
        vehicleSolarCurrentLimits: { V1: 22 },
        timezone: "UTC",
      },
      vehicle: { mode },
      schedules: [{
        id: "s1",
        vehicleId: "V1",
        scheduleType: "charge",
        startTime: "11:00",
        endTime: "13:00",
        days: ["thu"],
        chargeAmps: 32,
        chargeLimitPct: null,
        enabled: true,
      }],
    })).decisions.get("V1");
    expect(result?.targetAmps).toBe(32);
  }
});

Deno.test("solar cap redistributes spare power without limiting another vehicle", () => {
  const result = new ControllerEngine().decide(makeInput({
    configOverrides: {
      vehicleSolarCurrentLimits: { V1: 22 },
      priorityChargingEnabled: true,
    },
    vehicles: [
      makeVehicle({ id: "V1", priority: 1 }),
      makeVehicle({ id: "V2", priority: 2 }),
    ],
    energyOverrides: { solarProductionW: 15000, gridPowerW: -12420 },
  }));
  expect(result.decisions.get("V1")?.targetAmps).toBe(22);
  expect(result.decisions.get("V2")?.targetAmps).toBe(32);
});

Deno.test("a solar cap below hardware minimum stops instead of exceeding the cap", () => {
  const result = new ControllerEngine().decide(makeInput({
    configOverrides: { vehicleSolarCurrentLimits: { V1: 3 } },
    vehicle: { state: { isCharging: true, chargeAmps: 8 } },
  })).decisions.get("V1");
  expect(result?.action).toBe("stop");
  expect(result?.targetAmps).toBeNull();
});
