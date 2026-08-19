import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { VehicleChargeState } from "@chargeha/shared";
import { renderWithProviders } from "../../test-utils.tsx";
import { VehicleCard } from "./VehicleCard.tsx";

vi.mock("../StaticMap/StaticMap.tsx", () => ({
  StaticMap: () => <div data-testid="static-map" />,
}));

type VehicleCardProps = ComponentProps<typeof VehicleCard>;

describe("VehicleCard Wattpilot control", () => {
  const state = (
    overrides: Partial<VehicleChargeState> = {},
  ): VehicleChargeState => ({
    vehicleId: "edith",
    batteryLevel: 75,
    chargeLimit: 100,
    isCharging: true,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 20,
    chargeAmpsMax: 20,
    chargeAmpsMin: 6,
    chargePowerKw: 4.6,
    chargerVoltage: 230,
    chargerPhases: 1,
    energyAddedKwh: 8.9,
    minutesToFull: 215,
    chargePortOpen: true,
    vehicleName: "E.D.I.T.H.",
    lastUpdated: new Date().toISOString(),
    latitude: 43.6,
    longitude: 1.5,
    isHome: true,
    ...overrides,
  });

  const renderWattpilot = (overrides: Partial<VehicleCardProps> = {}) => {
    return renderWithProviders(
      <VehicleCard
        name="E.D.I.T.H."
        state={state()}
        priority={2}
        mode="vacation"
        chargeController="wattpilot"
        commandPending={false}
        onStartCharging={vi.fn()}
        onStopCharging={vi.fn()}
        onSetAmps={vi.fn()}
        onChangeMode={vi.fn()}
        atHome={true}
        {...overrides}
      />,
    );
  };

  afterEach(cleanup);

  it("shows Wattpilot as the active charging controller and hides Tesla controls", () => {
    renderWattpilot();

    expect(screen.getByText("Charging via Wattpilot at 4.6 kW"))
      .toBeInTheDocument();
    expect(screen.getAllByText("Charge control managed by Wattpilot").length)
      .toBeGreaterThan(0);
    expect(screen.queryByText("SOLAR ONLY")).not.toBeInTheDocument();
    expect(screen.queryByText("Stop Charging")).not.toBeInTheDocument();
  });

  it("suppresses the expected Tesla public-key pairing error", () => {
    renderWattpilot({
      vehicleError:
        "vehicle rejected request: your public key has not been paired with the vehicle",
      commandsDisabled: true,
      commandsDisabledReason: "Virtual key is not paired",
    });

    expect(screen.queryByText("Vehicle API error")).not.toBeInTheDocument();
    expect(screen.queryByText("Charging control unavailable"))
      .not.toBeInTheDocument();
  });

  it("keeps unrelated vehicle API errors visible", () => {
    renderWattpilot({ vehicleError: "Tesla API rate limited" });

    expect(screen.getByText("Vehicle API error")).toBeInTheDocument();
    expect(screen.getByText("Tesla API rate limited")).toBeInTheDocument();
  });

  it("still identifies off-site charging as away from home", () => {
    renderWattpilot({ atHome: false });

    expect(screen.getByText("Charging away from home at 4.6 kW"))
      .toBeInTheDocument();
  });
});
