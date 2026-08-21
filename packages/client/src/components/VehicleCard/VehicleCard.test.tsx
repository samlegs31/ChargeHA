import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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

    expect(screen.getByRole("button", { name: "Smart Charge is on" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Other options" }))
      .toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Solar" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Now" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" }))
      .not.toBeInTheDocument();

    expect(screen.getByText("Show details")).toBeInTheDocument();
    expect(screen.queryByText("Start Charging")).not.toBeInTheDocument();
    expect(screen.queryByText(/Priority 1/)).not.toBeInTheDocument();
    expect(screen.queryByText("16A")).not.toBeInTheDocument();
  });

  it("shows an upcoming programmed charge without opening details", () => {
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
    expect(screen.getByText("Show details")).toBeInTheDocument();
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
    expect(screen.getByText("Programmed charge in progress"))
      .toBeInTheDocument();
  });

  it("reveals technical controls only after Show details", () => {
    renderVC();

    fireEvent.click(screen.getByText("Show details"));

    expect(screen.getByText("Hide details")).toBeInTheDocument();
    expect(screen.getByText(/Online · Priority 1/)).toBeInTheDocument();
    expect(screen.getByText("Start Charging")).toBeInTheDocument();
    expect(screen.getByText("16A")).toBeInTheDocument();
  });

  it("makes Smart Charge the single primary action", () => {
    const onChangeMode = vi.fn();
    renderVC({ mode: "vacation", onChangeMode });

    fireEvent.click(screen.getByRole("button", { name: "Use Smart Charge" }));
    expect(onChangeMode).toHaveBeenCalledWith("auto");
  });

  it.each<[string, VCProps["mode"]]>([
    ["Solar", "vacation"],
    ["Now", "charge_now"],
    ["Pause", "stop"],
  ])("keeps %s inside Other options", (label, mode) => {
    const onChangeMode = vi.fn();
    renderVC({ onChangeMode });

    fireEvent.click(screen.getByRole("button", { name: "Other options" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onChangeMode).toHaveBeenCalledWith(mode);
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

    expect(screen.getByText("Unplugged — Smart ready for next connection"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Smart Charge is on" }))
      .toBeInTheDocument();
    expect(screen.queryByText("Solar")).not.toBeInTheDocument();
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
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

  it("shows connection problem copy without exposing raw API text by default", () => {
    renderVC({ vehicleError: "Tesla API rate limited" });

    expect(screen.getByText("Vehicle connection problem")).toBeInTheDocument();
    expect(screen.getByText(/It will keep trying automatically/))
      .toBeInTheDocument();
    expect(screen.queryByText("Tesla API rate limited")).not
      .toBeInTheDocument();

    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getByText(/Connection detail: Tesla API rate limited/))
      .toBeInTheDocument();
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

  it("keeps raw control diagnostics inside details", () => {
    renderVC({
      commandsDisabled: true,
      commandsDisabledReason: "Tesla API token is expired.",
    });

    expect(screen.queryByText(/Control detail:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getByText(/Control detail: Tesla API token is expired\./))
      .toBeInTheDocument();
  });

  it("keeps manual start and amp controls functional inside details", () => {
    const onStartCharging = vi.fn();
    const onSetAmps = vi.fn();
    renderVC({ onStartCharging, onSetAmps });

    fireEvent.click(screen.getByText("Show details"));
    fireEvent.click(screen.getByText("Start Charging"));
    expect(onStartCharging).toHaveBeenCalledTimes(1);

    const plus = screen.getByText("+");
    expect(plus.closest("button")).toBeDisabled();
  });

  it("keeps stop charging and amp adjustment functional inside details", () => {
    const onStopCharging = vi.fn();
    const onSetAmps = vi.fn();
    renderVC({
      state: makeVehicleState({ isCharging: true, chargePowerKw: 7.4 }),
      onStopCharging,
      onSetAmps,
    });

    fireEvent.click(screen.getByText("Show details"));
    fireEvent.click(screen.getByText("Stop Charging"));
    expect(onStopCharging).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("−"));
    fireEvent.click(screen.getByText("+"));
    expect(onSetAmps).toHaveBeenNthCalledWith(1, 15);
    expect(onSetAmps).toHaveBeenNthCalledWith(2, 17);
  });

  it("keeps refresh inside technical details", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderVC({ onRefresh });

    expect(screen.queryByText("Refresh")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Show details"));
    fireEvent.click(screen.getByText("Refresh"));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
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
