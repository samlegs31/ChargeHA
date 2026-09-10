import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { renderWithProviders } from "../../test-utils.tsx";
import type { VehicleChargeState } from "@chargeha/shared";
import { VehicleCard } from "./VehicleCard.tsx";

describe("VehicleCard", () => {
  beforeEach(vi.clearAllMocks);
  afterEach(cleanup);

  const makeVehicleState = (
    overrides: Partial<VehicleChargeState> = {},
  ): VehicleChargeState => ({
    vehicleId: "vin-123",
    batteryLevel: 72,
    chargeLimit: 80,
    isCharging: false,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 16,
    chargeAmpsMax: 32,
    chargeAmpsMin: 5,
    chargePowerKw: 0,
    chargerVoltage: 240,
    chargerPhases: 1,
    energyAddedKwh: 0,
    minutesToFull: 0,
    chargePortOpen: false,
    vehicleName: "Model 3",
    lastUpdated: new Date().toISOString(),
    latitude: null,
    longitude: null,
    isHome: null,
    ...overrides,
  });

  type VCProps = ComponentProps<typeof VehicleCard>;
  const renderVC = (overrides: Partial<VCProps> = {}) => {
    const props: VCProps = {
      name: "Model 3",
      state: makeVehicleState(),
      priority: 1,
      mode: "auto",
      commandPending: false,
      onStartCharging: vi.fn(),
      onStopCharging: vi.fn(),
      onSetAmps: vi.fn(),
      onChangeMode: vi.fn(),
      ...overrides,
    };
    return { props, ...renderWithProviders(<VehicleCard {...props} />) };
  };

  it("shows the essential vehicle state without a details disclosure", () => {
    renderVC();

    expect(screen.getByText("Model 3")).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-silhouette-icon")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByText("Limit 80%")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Plugged in · Ready")).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-charge-status"))
      .toHaveAttribute("data-status", "connected");
    expect(screen.queryByText("Show details")).not.toBeInTheDocument();
  });

  it("uses the three requested Home charging modes", () => {
    renderVC();

    expect(
      screen.getByRole("button", { name: "Solar + Off-Peak mode, selected" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Solar Only mode" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop mode" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Charge Now mode" }))
      .not.toBeInTheDocument();
  });

  it.each<[
    string,
    VCProps["mode"],
  ]>([
    ["Stop", "stop"],
    ["Solar + Off-Peak", "auto"],
    ["Solar Only", "vacation"],
  ])("changes to %s from the segmented control", (label, mode) => {
    const onChangeMode = vi.fn();
    renderVC({ mode: mode === "auto" ? "vacation" : "auto", onChangeMode });

    fireEvent.click(screen.getByRole("button", { name: `${label} mode` }));
    expect(onChangeMode).toHaveBeenCalledWith(mode);
  });

  it.each<[VCProps["mode"], string]>([
    ["auto", "Solar + Off-Peak"],
    ["vacation", "Solar Only"],
    ["charge_now", "Charge Now"],
    ["stop", "Stop"],
  ])("identifies the active %s mode", (mode, label) => {
    renderVC({ mode });
    expect(screen.getByLabelText(`Active mode: ${label}`))
      .toHaveAttribute("data-mode", mode);
  });

  it("shows real charging power immediately", () => {
    renderVC({
      state: makeVehicleState({
        isCharging: true,
        chargePowerKw: 4.8,
        energyAddedKwh: 2.3,
      }),
    });

    expect(screen.getByText("Charging · 4.8 kW")).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-charge-status"))
      .toHaveAttribute("data-status", "charging");
  });

  it("formats sub-kW charging power in watts", () => {
    renderVC({
      state: makeVehicleState({ isCharging: true, chargePowerKw: 0.45 }),
    });
    expect(screen.getByText("Charging · 450 W")).toBeInTheDocument();
  });

  it.each<[
    string,
    Partial<VehicleChargeState>,
    Partial<VCProps>,
    string,
    string,
  ]>([
    [
      "waiting",
      { isPluggedIn: true, isCharging: false },
      { mode: "vacation", controllerReason: "solar_tracking" },
      "Waiting",
      "waiting",
    ],
    [
      "disconnected",
      { isPluggedIn: false, isCharging: false },
      {},
      "Disconnected",
      "disconnected",
    ],
    [
      "error",
      { isOnline: false },
      {},
      "Error",
      "error",
    ],
  ])("shows the %s state directly", (_label, state, props, text, kind) => {
    renderVC({ ...props, state: makeVehicleState(state) });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-charge-status"))
      .toHaveAttribute("data-status", kind);
  });

  it("shows connected and stopped without introducing a sixth status", () => {
    renderVC({ mode: "stop" });
    expect(screen.getByText("Connected · Stopped")).toBeInTheDocument();
    expect(screen.getByText("Charging stopped")).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-charge-status"))
      .toHaveAttribute("data-status", "connected");
  });

  it.each([true, false])(
    "keeps actual charging visible in Stop mode (home: %s)",
    (atHome) => {
      renderVC({
        mode: "stop",
        atHome,
        state: makeVehicleState({ isCharging: true, chargePowerKw: 4.8 }),
      });
      expect(screen.getByText("Charging · 4.8 kW")).toBeInTheDocument();
      expect(
        screen.getByText(atHome ? "Stop requested" : "Charging away from home"),
      )
        .toBeInTheDocument();
    },
  );

  it("keeps a numeric waiting reason visible", () => {
    renderVC({
      atHome: true,
      controllerReason: "battery_priority",
      controllerDetail: "Home battery 78% / 80% reserve",
    });
    expect(screen.getByTestId("charging-decision-detail")).toHaveTextContent(
      "78% / 80%",
    );
  });

  it("does not show a home-only waiting reason for an away vehicle", () => {
    renderVC({
      atHome: false,
      controllerReason: "battery_priority",
      controllerDetail: "Home battery 78% / 80% reserve",
    });
    expect(screen.queryByTestId("charging-decision-detail"))
      .not.toBeInTheDocument();
  });

  it("shows a scheduled charge without a hidden details section", () => {
    renderVC({
      scheduledCharge: {
        scheduleId: "night-charge",
        status: "upcoming",
        title: "Charge programmed for tonight",
        detail: "23:10–04:40 · Target 80%",
      },
    });

    expect(screen.getByTestId("scheduled-charge-notice")).toBeInTheDocument();
    expect(screen.getByText("Charge programmed for tonight"))
      .toBeInTheDocument();
    expect(screen.getByText("23:10–04:40 · Target 80%"))
      .toBeInTheDocument();
    expect(screen.queryByText("Show details")).not.toBeInTheDocument();
  });

  it("uses concise source information while charging", () => {
    renderVC({
      state: makeVehicleState({ isCharging: true, chargePowerKw: 4.2 }),
      mode: "vacation",
      controllerReason: "solar_tracking",
    });
    expect(screen.getByText("Solar charging")).toBeInTheDocument();
  });

  it("makes Off-Peak charging explicit", () => {
    renderVC({
      state: makeVehicleState({ isCharging: true, chargePowerKw: 3.7 }),
      mode: "auto",
      controllerReason: "schedule",
    });
    expect(screen.getByText("Off-Peak charging")).toBeInTheDocument();
  });

  it("shows an error state and Settings action when control is unavailable", () => {
    const onNavigateSettings = vi.fn();
    renderVC({
      commandsDisabled: true,
      commandsDisabledReason: "Tesla API token is expired.",
      onNavigateSettings,
    });

    expect(screen.getByTestId("vehicle-charge-status"))
      .toHaveAttribute("data-status", "error");
    expect(screen.getByText("Vehicle control unavailable"))
      .toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Settings"));
    expect(onNavigateSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Tesla API token is expired/))
      .not.toBeInTheDocument();
  });

  it("keeps legacy Charge Now readable without exposing it in the Home selector", () => {
    const onSetAmps = vi.fn();
    renderVC({ mode: "charge_now", onSetAmps });

    expect(screen.getByLabelText("Active mode: Charge Now"))
      .toBeInTheDocument();
    expect(screen.getByText("Manual current")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Charge Now mode" }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByText("+"));
    expect(onSetAmps).toHaveBeenCalledWith(17);
  });
});
