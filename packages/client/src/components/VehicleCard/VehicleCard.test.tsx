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

  it("shows a simple plugged-in card by default", () => {
    renderVC();

    expect(screen.getByText("Model 3")).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-silhouette-icon")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByText("Limit 80%")).toBeInTheDocument();
    expect(screen.getByText("Ready — E.V. Solar will choose the best time"))
      .toBeInTheDocument();
    expect(screen.getByText("Connected · Not charging")).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-charge-status"))
      .toHaveAttribute("data-status", "connected");
    expect(screen.getByLabelText("Active mode: Smart charging"))
      .toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Smart mode, selected" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Solar mode" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Now mode" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop mode" }))
      .toBeInTheDocument();
    expect(screen.getByText("Solar + off-peak")).toBeInTheDocument();
    expect(screen.getByText("Solar surplus only")).toBeInTheDocument();
    expect(screen.getByText("Manual grid charging")).toBeInTheDocument();
    expect(screen.getByText("Stop charging")).toBeInTheDocument();

    expect(screen.queryByText("Show details")).not.toBeInTheDocument();
    expect(screen.queryByText("Start Charging")).not.toBeInTheDocument();
    expect(screen.queryByText(/Priority 1/)).not.toBeInTheDocument();
    expect(screen.queryByText("16 A")).not.toBeInTheDocument();
  });

  it("shows an upcoming programmed charge with details visible", () => {
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
    expect(screen.queryByText(/Online · Priority/)).not.toBeInTheDocument();
  });

  it("makes an active programmed charge explicit", () => {
    renderVC({
      state: makeVehicleState({ isCharging: true, chargePowerKw: 7.4 }),
      controllerReason: "schedule",
      scheduledCharge: {
        scheduleId: "active-charge",
        status: "active",
        title: "Programmed charge in progress",
        detail: "Until 06:00 · Target 80%",
      },
    });

    expect(screen.getByText("Charging with lower-cost electricity"))
      .toBeInTheDocument();
    expect(screen.getByText(/Charging · 7.400 W/)).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-charge-status"))
      .toHaveAttribute("data-status", "charging");
    expect(screen.getByTestId("vehicle-charge-status"))
      .toHaveAttribute("data-mode", "auto");
    expect(screen.getByText("Programmed charge in progress"))
      .toBeInTheDocument();
  });

  it("uses the active Solar mode color for the charging status", () => {
    renderVC({
      state: makeVehicleState({ isCharging: true, chargePowerKw: 4.8 }),
      mode: "vacation",
      controllerReason: "solar_tracking",
    });

    expect(screen.getByText(/Charging · 4.800 W/)).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-charge-status"))
      .toHaveAttribute("data-mode", "vacation");
  });

  it.each<[
    string,
    Partial<VehicleChargeState>,
    Partial<VCProps>,
    string,
    string,
  ]>([
    [
      "waiting for solar",
      { isPluggedIn: true, isCharging: false },
      { mode: "vacation", controllerReason: "solar_tracking" },
      "Waiting for energy",
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
      "in error",
      { isOnline: false },
      {},
      "Connection error",
      "error",
    ],
  ])("shows the %s state on the card", (_label, state, props, text, kind) => {
    renderVC({ ...props, state: makeVehicleState(state) });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-charge-status"))
      .toHaveAttribute("data-status", kind);
  });

  it("keeps the home card free from the technical footer", () => {
    renderVC();

    expect(screen.queryByText("Show details")).not.toBeInTheDocument();
    expect(screen.queryByText(/Online · Priority 1/)).not.toBeInTheDocument();
    expect(screen.queryByText("Start Charging")).not.toBeInTheDocument();
    expect(screen.queryByText("16 A")).not.toBeInTheDocument();
  });

  it("keeps every charging mode visible and selectable", () => {
    const onChangeMode = vi.fn();
    renderVC({ mode: "vacation", onChangeMode });

    fireEvent.click(screen.getByRole("button", { name: "Smart mode" }));
    expect(onChangeMode).toHaveBeenCalledWith("auto");
  });

  it.each<[string, VCProps["mode"]]>([
    ["Solar", "vacation"],
    ["Now", "charge_now"],
    ["Stop", "stop"],
  ])("selects the visible %s mode", (label, mode) => {
    const onChangeMode = vi.fn();
    renderVC({ onChangeMode });

    fireEvent.click(screen.getByRole("button", { name: `${label} mode` }));
    expect(onChangeMode).toHaveBeenCalledWith(mode);
  });

  it.each<[VCProps["mode"], string]>([
    ["auto", "Smart charging"],
    ["vacation", "Solar"],
    ["charge_now", "Now"],
    ["stop", "Stop"],
  ])("identifies the active %s mode with its mode color", (mode, label) => {
    renderVC({ mode });
    expect(screen.getByLabelText(`Active mode: ${label}`))
      .toHaveAttribute("data-mode", mode);
  });

  it.each<
    [
      string,
      Partial<VehicleChargeState>,
      VCProps["mode"],
      string | null,
      string,
    ]
  >([
    [
      "solar charging",
      { isCharging: true, chargePowerKw: 4.2 },
      "vacation",
      "solar_tracking",
      "Charging with available solar",
    ],
    [
      "scheduled charging",
      { isCharging: true, chargePowerKw: 3.7 },
      "auto",
      "schedule",
      "Charging with lower-cost electricity",
    ],
    [
      "charge now",
      { isCharging: true, chargePowerKw: 7.4 },
      "charge_now",
      null,
      "Charging now",
    ],
  ])(
    "uses human status copy for %s",
    (_label, state, mode, reason, expected) => {
      renderVC({
        state: makeVehicleState(state),
        mode,
        controllerReason: reason,
      });
      expect(screen.getByText(expected)).toBeInTheDocument();
    },
  );

  it("makes away charging explicit", () => {
    renderVC({
      state: makeVehicleState({ isCharging: true, chargePowerKw: 7.4 }),
      atHome: false,
    });
    expect(screen.getByText("Charging away from home")).toBeInTheDocument();
  });

  it("keeps unplugged cards calm and compact", () => {
    renderVC({ state: makeVehicleState({ isPluggedIn: false }) });

    expect(screen.getByText(
      "Unplugged — Smart charging ready for next connection",
    ))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Smart mode, selected" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solar mode" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Now mode" }))
      .toBeInTheDocument();
  });

  it("shows a clear offline status", () => {
    renderVC({ state: makeVehicleState({ isOnline: false }) });
    expect(screen.getByText("Vehicle offline — waiting to reconnect"))
      .toBeInTheDocument();
  });

  it("uses simple controller waiting messages", () => {
    renderVC({ controllerReason: "battery_priority" });
    expect(screen.getByText("Home battery has priority")).toBeInTheDocument();
  });

  it("explains the safe minimum while live solar data is unavailable", () => {
    renderVC({
      state: makeVehicleState({ isCharging: true, chargeAmps: 5 }),
      controllerReason: "energy_unavailable",
    });
    expect(
      screen.getByText(
        "Solar data unavailable — charging safely at minimum",
      ),
    ).toBeInTheDocument();
  });

  it("explains why automatic charging is waiting for solar data", () => {
    renderVC({ controllerReason: "energy_unavailable" });
    expect(screen.getByText("Waiting for live solar data")).toBeInTheDocument();
  });

  it("shows connection problem copy without raw technical detail", () => {
    renderVC({ vehicleError: "Tesla API rate limited" });

    expect(screen.getByText("Vehicle connection problem")).toBeInTheDocument();
    expect(screen.getByText(/It will keep trying automatically/))
      .toBeInTheDocument();
    expect(screen.queryByText(/Connection detail: Tesla API rate limited/))
      .not.toBeInTheDocument();
  });

  it("shows a simple automatic charging error with a Settings action", () => {
    const onNavigateSettings = vi.fn();
    renderVC({
      commandsDisabled: true,
      commandsDisabledReason: "Tesla API token is expired.",
      onNavigateSettings,
    });

    expect(screen.getByText("Automatic charging unavailable"))
      .toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Settings"));
    expect(onNavigateSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps raw control diagnostics off the home card", () => {
    renderVC({
      commandsDisabled: true,
      commandsDisabledReason: "Tesla API token is expired.",
    });

    expect(screen.queryByText(/Control detail: Tesla API token is expired\./))
      .not.toBeInTheDocument();
  });

  it("shows the amp selector only in Now mode", () => {
    const onSetAmps = vi.fn();
    renderVC({ mode: "charge_now", onSetAmps });

    expect(screen.getByText("Manual current")).toBeInTheDocument();
    fireEvent.click(screen.getByText("+"));
    expect(onSetAmps).toHaveBeenCalledWith(17);
  });

  it("uses the red Stop mode instead of a duplicate charge button", () => {
    const onChangeMode = vi.fn();
    renderVC({ onChangeMode });

    fireEvent.click(screen.getByRole("button", { name: "Stop mode" }));
    expect(onChangeMode).toHaveBeenCalledWith("stop");
    expect(screen.queryByText("Stop Charging")).not.toBeInTheDocument();
  });

  it("shows a red stopped status when Stop is active", () => {
    renderVC({
      mode: "stop",
      state: makeVehicleState({ isCharging: true, chargePowerKw: 4.8 }),
    });

    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText("Charging stopped until next connection"))
      .toBeInTheDocument();
    expect(screen.queryByText("Smart charging in progress"))
      .not.toBeInTheDocument();
    expect(screen.getByTestId("vehicle-charge-status"))
      .toHaveAttribute("data-status", "stopped");
  });

  it("does not show stale charging metrics during an error", () => {
    renderVC({
      state: makeVehicleState({ isCharging: true, chargePowerKw: 4.8 }),
      vehicleError: "Simulated error",
    });

    expect(screen.getByText("Connection error")).toBeInTheDocument();
    expect(screen.queryByText(/kWh added/)).not.toBeInTheDocument();
  });

  it.each([
    ["offline", { isOnline: false }],
    ["unplugged", { isPluggedIn: false }],
  ])("hides the Now current selector when %s", (_label, state) => {
    renderVC({ mode: "charge_now", state: makeVehicleState(state) });
    expect(screen.queryByText("Manual current")).not.toBeInTheDocument();
  });

  it("keeps refresh metadata off the home card", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderVC({ onRefresh });

    expect(screen.queryByText("Refresh")).not.toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not render a GPS map on the home card", () => {
    const { container } = renderVC();
    expect(container.querySelector('img[src*="tile.openstreetmap.org"]'))
      .toBeNull();
  });

  it("shows a skeleton while loading", () => {
    renderVC({ loading: true });
    expect(screen.queryByText("Model 3")).not.toBeInTheDocument();
  });
});
