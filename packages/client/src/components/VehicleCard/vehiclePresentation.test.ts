import { describe, expect, it } from "vitest";
import type { VehicleChargeState, VehicleMode } from "@chargeha/shared";
import {
  formatChargingPower,
  getChargeStatusKind,
  getStatusHeadline,
} from "./vehiclePresentation.ts";

const makeState = (
  overrides: Partial<VehicleChargeState> = {},
): VehicleChargeState => ({
  vehicleId: "vin-1",
  batteryLevel: 72,
  chargeLimit: 80,
  isCharging: false,
  isPluggedIn: true,
  isOnline: true,
  chargeAmps: 16,
  chargeAmpsMax: 32,
  chargeAmpsMin: 5,
  chargePowerKw: 0,
  chargerVoltage: 230,
  chargerPhases: 1,
  energyAddedKwh: 0,
  minutesToFull: 0,
  chargePortOpen: true,
  vehicleName: "F.R.I.D.A.Y.",
  lastUpdated: "2026-09-08T20:00:00.000Z",
  latitude: null,
  longitude: null,
  isHome: true,
  ...overrides,
});

function kind(
  state: VehicleChargeState,
  mode: VehicleMode = "auto",
  controllerReason: string | null = null,
  vehicleError: string | null = null,
) {
  return getChargeStatusKind({ state, mode, controllerReason, vehicleError });
}

describe("vehiclePresentation", () => {
  it.each([
    [0, "0 W"],
    [0.45, "450 W"],
    [0.999, "999 W"],
    [1, "1.0 kW"],
    [4.8, "4.8 kW"],
  ])("formats %s kW as %s", (input, expected) => {
    expect(formatChargingPower(input)).toBe(expected);
  });

  it("falls back safely for invalid power", () => {
    expect(formatChargingPower(Number.NaN)).toBe("—");
    expect(formatChargingPower(-1)).toBe("—");
  });

  it.each<[
    string,
    VehicleChargeState,
    VehicleMode,
    string | null,
    string | null,
    string,
  ]>([
    ["charging", makeState({ isCharging: true, chargePowerKw: 4.8 }), "auto", null, null, "charging"],
    ["waiting", makeState(), "vacation", null, null, "waiting"],
    ["waiting reason", makeState(), "auto", "battery_priority", null, "waiting"],
    ["connected", makeState(), "auto", null, null, "connected"],
    ["stopped", makeState(), "stop", null, null, "connected"],
    ["disconnected", makeState({ isPluggedIn: false }), "auto", null, null, "disconnected"],
    ["offline", makeState({ isOnline: false }), "auto", null, null, "error"],
    ["adapter error", makeState(), "auto", null, "Tesla API error", "error"],
  ])("derives the %s presentation state", (_label, state, mode, reason, error, expected) => {
    expect(kind(state, mode, reason, error)).toBe(expected);
  });

  it("keeps the real charging state visible even when Stop is selected", () => {
    const state = makeState({ isCharging: true, chargePowerKw: 4.8 });
    const status = kind(state, "stop");
    expect(status).toBe("charging");
    expect(getStatusHeadline(status, state, "stop")).toBe("Charging · 4.8 kW");
  });

  it("uses one of the five Home states for Stop", () => {
    const state = makeState();
    const status = kind(state, "stop");
    expect(getStatusHeadline(status, state, "stop")).toBe("Connected · Stopped");
  });
});
