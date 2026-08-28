import { describe, expect, it } from "vitest";
import type { VehicleChargeState, VehicleWithState } from "@chargeha/shared";
import {
  isChargingVehicleAtHome,
  vehicleChargePowerW,
} from "./energyHelpers.ts";

describe("isChargingVehicleAtHome", () => {
  const home = { lat: 43.6, lng: 1.5 };
  const chargingVehicle = (
    latitude: number | null,
    longitude: number | null,
  ): VehicleWithState => {
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
  };

  it("includes a charging vehicle inside the home radius", () => {
    expect(isChargingVehicleAtHome(chargingVehicle(43.6, 1.5), home)).toBe(
      true,
    );
  });

  it("excludes a charging vehicle away from home", () => {
    expect(isChargingVehicleAtHome(chargingVehicle(43.7, 1.6), home)).toBe(
      false,
    );
  });

  it("fails closed when home or vehicle location is unknown", () => {
    expect(isChargingVehicleAtHome(chargingVehicle(null, null), home)).toBe(
      false,
    );
    expect(isChargingVehicleAtHome(chargingVehicle(43.6, 1.5), null)).toBe(
      false,
    );
  });
});

describe("vehicleChargePowerW", () => {
  const state = {
    vehicleId: "friday",
    batteryLevel: 22,
    chargeLimit: 80,
    isCharging: true,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 13,
    chargeAmpsMax: 16,
    chargeAmpsMin: 5,
    chargePowerKw: 1.2,
    chargerVoltage: 240,
    chargerPhases: 1,
    energyAddedKwh: 1.8,
    minutesToFull: 865,
    chargePortOpen: true,
    vehicleName: "F.R.I.D.A.Y.",
    lastUpdated: new Date().toISOString(),
    latitude: 43.6,
    longitude: 1.5,
    isHome: true,
  } satisfies VehicleChargeState;

  it("uses accepted amps immediately when Tesla power telemetry is stale", () => {
    expect(vehicleChargePowerW(state)).toBe(3120);
  });

  it("falls back to confirmed power when electrical target data is unavailable", () => {
    expect(vehicleChargePowerW({ ...state, chargeAmps: 0 })).toBe(1200);
  });

  it("never shows vehicle flow after charging stops", () => {
    expect(vehicleChargePowerW({ ...state, isCharging: false })).toBe(0);
  });
});
