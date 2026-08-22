import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { StatsChart } from "./StatsChart.tsx";
import type { StatsResponse } from "@chargeha/shared";

const { chartState, makeStatsData } = vi.hoisted(() => {
  type SR = import("@chargeha/shared").StatsResponse;
  const chartState: { onClick?: (event: { activeLabel?: string }) => void } =
    {};
  const makeStatsData = (overrides?: Partial<SR>): SR => ({
    period: "day",
    startDate: "2026-03-01",
    endDate: "2026-03-01",
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
    totalChargedWh: 3500,
    totalSolarWh: 2000,
    totalBatteryWh: 0,
    totalGridWh: 1000,
    totalAwayWh: 500,
    selfPoweredPercent: 67,
    totalCostCents: 500,
    solarSavingsCents: 200,
    evSolarSavingsCents: 200,
    currencySymbol: "$",
    tariffBreakdown: [],
    vehicleSoc: [],
    energyBuckets: [],
    buckets: [
      {
        label: "10",
        solarWh: 500,
        batteryWh: 0,
        gridWh: 100,
        awayWh: 500,
        totalWh: 1100,
        costCents: 20,
      },
      {
        label: "11",
        solarWh: 700,
        batteryWh: 0,
        gridWh: 300,
        awayWh: 0,
        totalWh: 1000,
        costCents: 70,
      },
    ],
    ...overrides,
  });
  return { chartState, makeStatsData };
});

vi.mock("recharts", () => {
  const allowed = new Set([
    "Bar",
    "XAxis",
    "YAxis",
    "CartesianGrid",
    "Tooltip",
  ]);
  const stub = (name: string) => {
    const Stub = () => null;
    Stub.displayName = name;
    return Stub;
  };
  const Bar = stub("Bar");
  const XAxis = stub("XAxis");
  const YAxis = stub("YAxis");
  const CartesianGrid = stub("CartesianGrid");
  const Tooltip = stub("Tooltip");

  const assertChildren = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === Fragment) {
        assertChildren((child.props as { children?: ReactNode }).children);
        return;
      }
      const type = child.type as { displayName?: string; name?: string };
      const name = type.displayName ?? type.name ?? "";
      if (!allowed.has(name)) {
        throw new Error(`Unexpected chart child: ${name}`);
      }
    });
  };

  const ComposedChart = (
    { children, onClick }: {
      children: ReactNode;
      onClick?: (event: { activeLabel?: string }) => void;
    },
  ) => {
    assertChildren(children);
    chartState.onClick = onClick;
    return <div data-testid="chart">{children}</div>;
  };

  return {
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    ComposedChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
  };
});

vi.mock("./Stats.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => `mock-${String(prop)}` }),
}));

vi.mock("../../../utils/Format.ts", () => ({
  formatCost: (cents: number, symbol: string) =>
    `${symbol}${(cents / 100).toFixed(2)}`,
}));

describe("StatsChart", () => {
  const defaultProps = {
    data: null as StatsResponse | null,
    loading: false,
    period: "day" as const,
    resolution: "1h" as const,
    setResolution: vi.fn(),
    dateCursor: new Date(2026, 2, 1),
    onDrillDown: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    chartState.onClick = undefined;
  });
  afterEach(cleanup);

  it("shows loading text when loading", () => {
    renderWithProviders(<StatsChart {...defaultProps} loading />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders chart when data is provided", () => {
    renderWithProviders(
      <StatsChart {...defaultProps} data={makeStatsData()} />,
    );
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });

  it("shows resolution toggle only for day period", () => {
    renderWithProviders(
      <StatsChart {...defaultProps} data={makeStatsData()} period="day" />,
    );
    expect(screen.getAllByText("1h").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("15m").length).toBeGreaterThanOrEqual(1);
  });

  it.each([["month" as const], ["year" as const], ["total" as const]])(
    "does not show resolution toggle for %s period",
    (period) => {
      renderWithProviders(
        <StatsChart
          {...defaultProps}
          data={makeStatsData()}
          period={period}
        />,
      );
      expect(screen.queryByText("15m")).not.toBeInTheDocument();
    },
  );

  it("renders only EV charging legend items including Away", () => {
    renderWithProviders(
      <StatsChart {...defaultProps} data={makeStatsData()} />,
    );
    expect(screen.getByRole("heading", {
      name: "Where your charging came from",
    })).toBeInTheDocument();
    expect(screen.getByText("Solar")).toBeInTheDocument();
    expect(screen.getByText("Home battery")).toBeInTheDocument();
    expect(screen.getByText("Grid")).toBeInTheDocument();
    expect(screen.getByText("Away")).toBeInTheDocument();
    expect(screen.queryByText("Solar → Home")).not.toBeInTheDocument();
  });

  it("calls setResolution when the day resolution changes", () => {
    const setResolution = vi.fn();
    renderWithProviders(
      <StatsChart
        {...defaultProps}
        data={makeStatsData()}
        setResolution={setResolution}
      />,
    );
    fireEvent.click(screen.getAllByText("15m")[0]);
    expect(setResolution).toHaveBeenCalledWith("15m");
  });

  it("drills from Total into the selected year", () => {
    const onDrillDown = vi.fn();
    const data = makeStatsData({
      buckets: [{
        label: "2025",
        solarWh: 5000,
        batteryWh: 1000,
        gridWh: 2000,
        awayWh: 500,
        totalWh: 8500,
        costCents: 100,
      }],
    });
    renderWithProviders(
      <StatsChart
        {...defaultProps}
        data={data}
        period="total"
        onDrillDown={onDrillDown}
      />,
    );

    chartState.onClick?.({ activeLabel: "2025" });

    expect(onDrillDown).toHaveBeenCalledOnce();
    expect(onDrillDown.mock.calls[0][0]).toBe("year");
    expect(onDrillDown.mock.calls[0][1].getFullYear()).toBe(2025);
  });

  it("drills from year into the selected month", () => {
    const onDrillDown = vi.fn();
    renderWithProviders(
      <StatsChart
        {...defaultProps}
        data={makeStatsData()}
        period="year"
        onDrillDown={onDrillDown}
      />,
    );
    chartState.onClick?.({ activeLabel: "Mar" });
    expect(onDrillDown.mock.calls[0][0]).toBe("month");
    expect(onDrillDown.mock.calls[0][1].getMonth()).toBe(2);
  });

  it("drills from month into the selected day", () => {
    const onDrillDown = vi.fn();
    renderWithProviders(
      <StatsChart
        {...defaultProps}
        data={makeStatsData()}
        period="month"
        onDrillDown={onDrillDown}
      />,
    );
    chartState.onClick?.({ activeLabel: "15" });
    expect(onDrillDown.mock.calls[0][0]).toBe("day");
    expect(onDrillDown.mock.calls[0][1].getDate()).toBe(15);
  });
});
