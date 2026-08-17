import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { Stats } from "./Stats.tsx";
import { useStats } from "../../../hooks/useStats.ts";

vi.mock("../../../hooks/useStats.ts", () => ({
  useStats: vi.fn(() => ({
    period: "day",
    setPeriod: vi.fn(),
    resolution: "1h",
    setResolution: vi.fn(),
    cursor: new Date("2026-03-01"),
    cursorLabel: "Sat, Mar 1, 2026",
    isAtPresent: true,
    data: null,
    loading: false,
    error: null,
    goBack: vi.fn(),
    goForward: vi.fn(),
    goToToday: vi.fn(),
    drillDown: vi.fn(),
  })),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useQueries: vi.fn(() => []),
    vehicle: {
      list: {
        useQuery: vi.fn(() => ({
          data: { vehicles: [] },
          isLoading: false,
          isPending: false,
          error: null,
        })),
      },
    },
  },
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ComposedChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

describe("Stats", () => {
  const mockStatsData = {
    period: "day" as const,
    startDate: "2026-03-01",
    endDate: "2026-03-01",
    energyBuckets: [
      {
        label: "10",
        solarProductionWh: 2000,
        solarWh: 1500,
        batteryChargeWh: 0,
        batteryDischargeWh: 0,
        solarToBatteryWh: 0,
        gridToBatteryWh: 0,
        gridWh: 200,
        totalWh: 1700,
      },
      {
        label: "11",
        solarProductionWh: 3000,
        solarWh: 2200,
        batteryChargeWh: 0,
        batteryDischargeWh: 0,
        solarToBatteryWh: 0,
        gridToBatteryWh: 0,
        gridWh: 100,
        totalWh: 2300,
      },
    ],
    homeSolarProductionWh: 5000,
    homeConsumedWh: 4000,
    homeSolarWh: 3700,
    homeBatteryChargeWh: 0,
    homeBatteryDischargeWh: 0,
    homeSolarToBatteryWh: 0,
    homeGridToBatteryWh: 0,
    homeGridWh: 300,
    homeSelfPoweredPercent: 75,
    solarProductionLine: [],
    buckets: [
      {
        label: "10",
        solarWh: 800,
        batteryWh: 0,
        gridWh: 200,
        awayWh: 0,
        totalWh: 1000,
      },
      {
        label: "11",
        solarWh: 600,
        batteryWh: 0,
        gridWh: 100,
        awayWh: 0,
        totalWh: 700,
      },
    ],
    totalChargedWh: 1700,
    totalSolarWh: 1400,
    totalBatteryWh: 0,
    totalGridWh: 300,
    totalAwayWh: 0,
    selfPoweredPercent: 82,
  };

  type StatsReturn = ReturnType<typeof useStats>;

  const makeStatsReturn = (
    overrides: Partial<StatsReturn> = {},
  ): StatsReturn => ({
    period: "day",
    setPeriod: vi.fn(),
    resolution: "1h",
    setResolution: vi.fn(),
    cursor: new Date("2026-03-01"),
    cursorLabel: "Sat, Mar 1, 2026",
    isAtPresent: true,
    data: null,
    loading: false,
    error: null,
    goBack: vi.fn(),
    goForward: vi.fn(),
    goToToday: vi.fn(),
    drillDown: vi.fn(),
    ...overrides,
  });

  const setStats = (overrides: Partial<StatsReturn> = {}) => {
    vi.mocked(useStats).mockReturnValue(makeStatsReturn(overrides));
  };

  const renderStats = () => renderWithProviders(<Stats />);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders period navigation", () => {
    renderStats();
    expect(screen.getAllByText("Day").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Month").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Year").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("Previous period")).toBeInTheDocument();
    expect(screen.getByLabelText("Next period")).toBeInTheDocument();
  });

  it("shows only EV charging summary metrics", () => {
    renderStats();
    expect(screen.getByText("Total Charged")).toBeInTheDocument();
    expect(screen.getByText("From Solar")).toBeInTheDocument();
    expect(screen.getByText("From Battery")).toBeInTheDocument();
    expect(screen.getByText("From Grid")).toBeInTheDocument();
    expect(screen.getByText("Solar Share")).toBeInTheDocument();
    expect(screen.queryByText("Solar Produced")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Consumed")).not.toBeInTheDocument();
    expect(screen.queryByText("Self Powered")).not.toBeInTheDocument();
  });

  it("shows five summary placeholders while loading", () => {
    setStats({ loading: true });
    renderStats();
    expect(screen.getAllByText("—")).toHaveLength(5);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders EV solar share from charged energy", () => {
    setStats({ isAtPresent: false, data: mockStatsData });
    renderStats();
    expect(screen.getByText("82%")).toBeInTheDocument();
  });

  it("does not render home energy or home battery cards", () => {
    setStats({ isAtPresent: false, data: mockStatsData });
    renderStats();
    expect(screen.queryByText("Energy Sources")).not.toBeInTheDocument();
    expect(screen.queryByText("Home Battery")).not.toBeInTheDocument();
    expect(screen.queryByText("Solar → Battery")).not.toBeInTheDocument();
    expect(screen.queryByText("Battery → Home")).not.toBeInTheDocument();
  });

  it("renders the charging chart", () => {
    setStats({ isAtPresent: false, data: mockStatsData });
    renderStats();
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });

  it("shows the day resolution toggle only on day view", () => {
    renderStats();
    expect(screen.getAllByText("1h").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("15m").length).toBeGreaterThanOrEqual(1);
    setStats({ period: "month", cursorLabel: "March 2026" });
    cleanup();
    renderStats();
    expect(screen.queryByText("15m")).not.toBeInTheDocument();
  });

  it("renders only EV charging flow legend labels", () => {
    renderStats();
    expect(screen.getByText("Solar → Car")).toBeInTheDocument();
    expect(screen.getByText("Battery → Car")).toBeInTheDocument();
    expect(screen.getByText("Grid → Car")).toBeInTheDocument();
    expect(screen.queryByText("Solar → Home")).not.toBeInTheDocument();
    expect(screen.queryByText("Grid → Home")).not.toBeInTheDocument();
    expect(screen.queryByText("Solar Production")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Consumption")).not.toBeInTheDocument();
  });

  it("renders a home-only vehicle charging fallback", async () => {
    setStats({ isAtPresent: false, data: mockStatsData });
    renderStats();
    expect(await screen.findByText("Vehicle Charging")).toBeInTheDocument();
    expect(screen.queryByText("Away")).not.toBeInTheDocument();
  });

  it("never renders away charging even if stale data contains it", async () => {
    setStats({
      isAtPresent: false,
      data: {
        ...mockStatsData,
        totalAwayWh: 500,
        totalChargedWh: 2200,
      },
    });
    renderStats();
    expect(await screen.findByText("Vehicle Charging")).toBeInTheDocument();
    expect(screen.queryByText("Away")).not.toBeInTheDocument();
  });

  it("uses EV-only cost and savings metrics", () => {
    setStats({
      isAtPresent: false,
      data: {
        ...mockStatsData,
        totalCostCents: 1250,
        evSolarSavingsCents: 250,
        solarSavingsCents: 830,
        currencySymbol: "$",
        currencyCode: "AUD",
      },
    });
    renderStats();
    expect(screen.getAllByText("Grid Cost").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$12.50").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Solar Savings").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$2.50").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("$8.30")).not.toBeInTheDocument();
  });

  it("hides financial cards when no EV financial data exists", () => {
    setStats({
      isAtPresent: false,
      data: {
        ...mockStatsData,
        totalCostCents: 0,
        evSolarSavingsCents: 0,
        solarSavingsCents: 900,
        currencySymbol: "$",
        currencyCode: "AUD",
      },
    });
    renderStats();
    expect(screen.queryByText("Grid Cost")).not.toBeInTheDocument();
    expect(screen.queryByText("Solar Savings")).not.toBeInTheDocument();
  });

  it.each<
    [
      target: string,
      query: "label" | "text",
      key: "goBack" | "goForward" | "goToToday",
    ]
  >([
    ["Previous period", "label", "goBack"],
    ["Next period", "label", "goForward"],
    ["Sat, Mar 1, 2026", "text", "goToToday"],
  ])("calls %s navigation callback", (target, query, key) => {
    const callback = vi.fn();
    setStats({ isAtPresent: false, [key]: callback });
    renderStats();
    const element = query === "label"
      ? screen.getByLabelText(target)
      : screen.getByText(target);
    fireEvent.click(element);
    expect(callback).toHaveBeenCalledOnce();
  });
});
