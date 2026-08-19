import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { VehicleChargeState } from "@chargeha/shared";
import { renderWithProviders } from "../../test-utils.tsx";
import { VehicleCard } from "./VehicleCard.tsx";

describe("VehicleCard away charging status", () => {
  const chargingState: VehicleChargeState = {
    vehicleId: "friday",
    batteryLevel: 36,
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
    energyAddedKwh: 11.9,
    minutesToFull: 645,
    chargePortOpen: true,
    vehicleName: "F.R.I.D.A.Y.",
    lastUpdated: new Date().toISOString(),
    latitude: 43.7,
    longitude: 1.6,
    isHome: false,
  };

  it("shows an explicit away-from-home message instead of the configured mode", () => {
    renderWithProviders(
      <VehicleCard
        name="F.R.I.D.A.Y."
        state={chargingState}
        priority={1}
        mode="vacation"
        commandPending={false}
        onStartCharging={vi.fn()}
        onStopCharging={vi.fn()}
        onSetAmps={vi.fn()}
        onChangeMode={vi.fn()}
        atHome={false}
      />,
    );

    expect(screen.getByText("Charging away from home at 3.1 kW"))
      .toBeInTheDocument();
    expect(screen.queryByText("Solar Only - Charging at 3.1 kW"))
      .not.toBeInTheDocument();
  });
});
