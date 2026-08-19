import { describe, expect, it } from "vitest";
import type { VehicleWithState } from "@chargeha/shared";
import { isChargingVehicleAtHome } from "./energyHelpers.ts";

function chargingVehicle(
  latitude: number | null,
  longitude: number | null,
): VehicleWithState {
  return {
    id: "friday",
    name: "F.R.I.D.A.Y.",
    priority: 1,
    mode: "vacation",
    lastLocation: latitude == null || longitude == null
      ? null
      : { latitude, longitude },
    state: {
      vehicleId: "friday",
      batteryLevel: 22,
      chargeLimit: 80,
      isCharging: true,
      isPluggedIn: true,
      isOnline: true,
      chargeAmps: 13,
      chargeAmpsMax: 13,
      chargeAmpsMin: 5,
      chargePowerKw: 3.1,
      chargerVoltage: 240,
      chargerPhases: 1,
      energyAddedKwh: 1.8,
      minutesToFull: 865,
      chargePortOpen: true,
      vehicleName: "F.R.I.D.A.Y.",
      lastUpdated: new Date().toISOString(),
      latitude,
      longitude,
      isHome: null,
    },
  } as VehicleWithState;
}

describe("isChargingVehicleAtHome", () => {
  const home = { lat: 43.6, lng: 1.5 };

  it("includes a charging vehicle inside the home radius", () => {
    expect(isChargingVehicleAtHome(chargingVehicle(43.6, 1.5), home)).toBe(true);
  });

  it("excludes a charging vehicle away from home", () => {
    expect(isChargingVehicleAtHome(chargingVehicle(43.7, 1.6), home)).toBe(false);
  });

  it("fails closed when home or vehicle location is unknown", () => {
    expect(isChargingVehicleAtHome(chargingVehicle(null, null), home)).toBe(false);
    expect(isChargingVehicleAtHome(chargingVehicle(43.6, 1.5), null)).toBe(false);
  });
});
