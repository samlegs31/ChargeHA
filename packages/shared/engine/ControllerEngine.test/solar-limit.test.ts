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

Deno.test("every integer solar ceiling from 5 to 32A works independently of phase count", () => {
  for (const phases of [1, 3]) {
    for (let amps = 5; amps <= 32; amps++) {
      const result = new ControllerEngine().decide(makeInput({
        configOverrides: {
          vehicleSolarCurrentLimits: { V1: amps },
          threePhaseCharger: phases === 3,
        },
        vehicle: {
          state: {
            isCharging: true,
            chargeAmps: 32,
            chargeAmpsActual: 32,
            chargerPhases: phases,
          },
        },
        energyOverrides: { solarProductionW: 30000, gridPowerW: -30000 },
      })).decisions.get("V1");
      expect(result?.targetAmps).toBe(amps);
    }
  }
});

Deno.test("leaving a 32A charge schedule restores the solar cap at the next decision", () => {
  const engine = new ControllerEngine();
  let amps = 22;
  for (const [hour, expected] of [[12, 32], [13, 22]]) {
    const now = new Date(`2026-01-01T${hour}:00:00Z`);
    const result = engine.decide(makeInput({
      now,
      timestamp: now.getTime(),
      configOverrides: {
        timezone: "UTC",
        vehicleSolarCurrentLimits: { V1: 22 },
      },
      vehicle: {
        state: { isCharging: true, chargeAmps: amps, chargeAmpsActual: amps },
      },
      energyOverrides: { solarProductionW: 12000, gridPowerW: -10000 },
      schedules: [{
        id: "s1",
        vehicleId: "V1",
        scheduleType: "charge",
        startTime: "12:00",
        endTime: "13:00",
        days: ["thu"],
        chargeAmps: 32,
        chargeLimitPct: null,
        enabled: true,
      }],
    })).decisions.get("V1");
    expect(result?.targetAmps).toBe(expected);
    amps = expected;
  }
});
