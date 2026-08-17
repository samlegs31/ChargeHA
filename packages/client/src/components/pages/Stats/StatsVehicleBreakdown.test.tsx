import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { StatsResponse } from "@chargeha/shared";
import { renderWithProviders } from "../../../test-utils.tsx";
import { StatsVehicleBreakdown } from "./StatsVehicleBreakdown.tsx";
import { useVehicleBreakdowns } from "../../../hooks/useVehicleBreakdowns.ts";

vi.mock("../../../hooks/useVehicleBreakdowns.ts", () => ({
  useVehicleBreakdowns: vi.fn(),
}));

describe("StatsVehicleBreakdown", () => {
  const mockUseVehicleBreakdowns = vi.mocked(useVehicleBreakdowns);

  const baseData: StatsResponse = {
    period: "day",
    startDate: "2026-03-01",
    endDate: "2026-03-01",
    energyBuckets: [],
    homeSolarProductionWh: 0,
    homeConsumedWh: 0,
    homeSolarWh: 0,
    homeBatteryChargeWh: 0,
    homeBatteryDischargeWh: 0,
    homeSolarToBatteryWh: 0,
    homeGridToBatteryWh: 0,
    homeGridWh: 0,
    homeSelfPoweredPercent: 0,
    solarProductionLine: [],
    buckets: [],
    totalChargedWh: 1700,
    totalSolarWh: 1400,
    totalBatteryWh: 0,
    totalGridWh: 300,
    totalAwayWh: 0,
    selfPoweredPercent: 82,
  };

  const renderComponent = (data: StatsResponse = baseData) =>
    renderWithProviders(
      <StatsVehicleBreakdown
        data={data}
        loading={false}
        period="day"
        cursor={new Date("2026-03-01")}
        resolution="1h"
      />,
    );

  type BreakdownsReturn = ReturnType<typeof useVehicleBreakdowns>;

  const setBreakdowns = (overrides: Partial<BreakdownsReturn>) => {
    mockUseVehicleBreakdowns.mockReturnValue({
      hasChargeData: true,
      hasConfiguredVehicles: true,
      vehicleBreakdownsLoading: false,
      currencySymbol: "$",
      activeVehicleBreakdowns: [],
      ...overrides,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders complete per-vehicle charging", () => {
    setBreakdowns({
      activeVehicleBreakdowns: [{
        vehicleId: "VIN-1",
        vehicleName: "Model Y",
        totalChargedWh: 2000,
        totalSolarWh: 1400,
        totalBatteryWh: 0,
        totalGridWh: 300,
        totalAwayWh: 300,
        totalCostCents: 20,
        evSolarSavingsCents: 10,
      }],
    });
    renderComponent();
    expect(screen.getByText("Model Y")).toBeInTheDocument();
    expect(screen.getByText("Total Charged")).toBeInTheDocument();
    expect(screen.getByText("From Solar")).toBeInTheDocument();
    expect(screen.getByText("From Battery")).toBeInTheDocument();
    expect(screen.getByText("From Grid")).toBeInTheDocument();
    expect(screen.getByText("Away")).toBeInTheDocument();
    expect(screen.queryByText("Home Battery")).not.toBeInTheDocument();
    expect(screen.queryByText("Energy Sources")).not.toBeInTheDocument();
  });

  it("does not render generic fallback while vehicle data loads", () => {
    setBreakdowns({ vehicleBreakdownsLoading: true });
    renderComponent();
    expect(screen.queryByText("Vehicle Charging")).not.toBeInTheDocument();
  });

  it("renders generic fallback only without configured vehicles", () => {
    setBreakdowns({ hasConfiguredVehicles: false });
    renderComponent();
    expect(screen.getByText("Vehicle Charging")).toBeInTheDocument();
  });

  it("renders away charging in the generic fallback when available", () => {
    setBreakdowns({ hasConfiguredVehicles: false });
    renderComponent({
      ...baseData,
      totalAwayWh: 500,
      totalChargedWh: 2200,
    });
    expect(screen.getByText("Vehicle Charging")).toBeInTheDocument();
    expect(screen.getByText("Away")).toBeInTheDocument();
  });
});
