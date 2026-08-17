import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

const { tooltipState, makeStatsData } = vi.hoisted(() => {
  type SR = import("@chargeha/shared").StatsResponse;
  const tooltipState: { captured: ReactElement | null } = { captured: null };
  const makeStatsData = (overrides?: Partial<SR>): SR => ({
    period: "day",
    startDate: "2026-03-01",
    endDate: "2026-03-01",
    homeSolarProductionWh: 8000,
    homeConsumedWh: 7000,
    homeSolarWh: 5000,
    homeBatteryChargeWh: 0,
    homeBatteryDischargeWh: 0,
    homeSolarToBatteryWh: 0,
    homeGridToBatteryWh: 0,
    homeGridWh: 2000,
    homeSelfPoweredPercent: 71,
    solarProductionLine: [],
    totalChargedWh: 3000,
    totalSolarWh: 2000,
    totalBatteryWh: 0,
    totalGridWh: 1000,
    totalAwayWh: 0,
    selfPoweredPercent: 67,
    totalCostCents: 500,
    evSolarSavingsCents: 200,
    currencySymbol: "$",
    tariffBreakdown: [],
    vehicleSoc: [],
    energyBuckets: [],
    buckets: [
      {
        label: "10",
        solarWh: 500,
        batteryWh: 50,
        gridWh: 100,
        awayWh: 0,
        totalWh: 650,
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
  return { tooltipState, makeStatsData };
});

vi.mock("recharts", () => {
  const RECHARTS_CHILD_NAMES = new Set([
    "Bar",
    "XAxis",
    "YAxis",
    "CartesianGrid",
    "Tooltip",
  ]);

  const Bar = ({ dataKey }: { dataKey: string }) => (
    <div data-testid={`bar-${dataKey}`} />
  );
  Bar.displayName = "Bar";

  const makeStub = (name: string) => {
    const Stub = () => null;
    Stub.displayName = name;
    return Stub;
  };

  const XAxis = makeStub("XAxis");
  const YAxis = makeStub("YAxis");
  const CartesianGrid = makeStub("CartesianGrid");
  const Tooltip = ({ content }: { content: ReactNode }) => {
    if (isValidElement(content)) tooltipState.captured = content;
    return <div data-testid="tooltip-wrapper" />;
  };
  Tooltip.displayName = "Tooltip";

  const assertChild = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === Fragment) {
        assertChild((child.props as { children?: ReactNode }).children);
        return;
      }
      const type = child.type as { displayName?: string; name?: string };
      const name = type.displayName ?? type.name ?? "(anonymous)";
      if (!RECHARTS_CHILD_NAMES.has(name)) {
        throw new Error(`Unexpected chart child <${name}>`);
      }
    });
  };

  const ComposedChart = ({ children }: { children: ReactNode }) => {
    assertChild(children);
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

import { cleanup, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { StatsChart } from "./StatsChart.tsx";
import type { StatsResponse } from "@chargeha/shared";

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

  beforeEach(vi.clearAllMocks);
  afterEach(cleanup);

  it("shows loading text", () => {
    renderWithProviders(<StatsChart {...defaultProps} loading />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders only the three EV charging bars", () => {
    renderWithProviders(
      <StatsChart {...defaultProps} data={makeStatsData()} />,
    );
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByTestId("bar-solarToCar")).toBeInTheDocument();
    expect(screen.getByTestId("bar-batteryToCar")).toBeInTheDocument();
    expect(screen.getByTestId("bar-gridToCar")).toBeInTheDocument();
  });

  it("renders only EV charging legend items", () => {
    renderWithProviders(
      <StatsChart {...defaultProps} data={makeStatsData()} />,
    );
    expect(screen.getByText("Solar → Car")).toBeInTheDocument();
    expect(screen.getByText("Battery → Car")).toBeInTheDocument();
    expect(screen.getByText("Grid → Car")).toBeInTheDocument();
    expect(screen.queryByText("Solar → Home")).not.toBeInTheDocument();
    expect(screen.queryByText("Grid → Home")).not.toBeInTheDocument();
    expect(screen.queryByText("Solar Production")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Consumption")).not.toBeInTheDocument();
  });

  it("shows resolution toggle for day only", () => {
    renderWithProviders(
      <StatsChart {...defaultProps} data={makeStatsData()} />,
    );
    expect(screen.getAllByText("1h").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("15m").length).toBeGreaterThanOrEqual(1);
    cleanup();
    renderWithProviders(
      <StatsChart
        {...defaultProps}
        data={makeStatsData({ period: "month" })}
        period="month"
      />,
    );
    expect(screen.queryByText("15m")).not.toBeInTheDocument();
  });

  it("calls setResolution", () => {
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

  it("renders with no charging buckets", () => {
    renderWithProviders(
      <StatsChart {...defaultProps} data={makeStatsData({ buckets: [] })} />,
    );
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });
});

describe("EV charging tooltip", () => {
  type ChartOverrides = {
    period?: StatsResponse["period"];
    resolution?: "1h" | "15m";
    dateCursor?: Date;
    bucketLabel?: string;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tooltipState.captured = null;
  });
  afterEach(cleanup);

  const captureTooltip = (chart: ChartOverrides = {}) => {
    const period = chart.period ?? "day";
    const resolution = chart.resolution ?? "1h";
    const label = chart.bucketLabel ?? "10";
    const data = makeStatsData({
      period,
      buckets: [{
        label,
        solarWh: 500,
        batteryWh: 100,
        gridWh: 100,
        awayWh: 0,
        totalWh: 700,
        costCents: 20,
      }],
    });
    const { unmount } = renderWithProviders(
      <StatsChart
        data={data}
        loading={false}
        period={period}
        resolution={resolution}
        setResolution={vi.fn()}
        dateCursor={chart.dateCursor ?? new Date(2026, 2, 1)}
        onDrillDown={vi.fn()}
      />,
    );
    unmount();
    cleanup();
    if (!tooltipState.captured) throw new Error("Tooltip content not captured");
    return tooltipState.captured;
  };

  const renderTooltip = (
    props: Record<string, unknown>,
    chart?: ChartOverrides,
  ) => render(cloneElement(captureTooltip(chart), props));

  const baseDatum = {
    label: "10:00",
    solarToCar: 1.5,
    batteryToCar: 0.2,
    gridToCar: 0.3,
    costCents: 80,
    vehicleSoc: [],
  };

  it("returns null when inactive", () => {
    const { container } = renderTooltip({ active: false, payload: [] });
    expect(container.innerHTML).toBe("");
  });

  it("shows only EV charging flows and grid cost", () => {
    renderTooltip({
      active: true,
      label: "10:00",
      payload: [{ payload: baseDatum }],
    });
    expect(screen.getByText("10:00 – 11:00")).toBeInTheDocument();
    expect(screen.getByText("Solar → Car")).toBeInTheDocument();
    expect(screen.getByText("Battery → Car")).toBeInTheDocument();
    expect(screen.getByText("Grid → Car")).toBeInTheDocument();
    expect(screen.getByText("Grid cost $0.80")).toBeInTheDocument();
    expect(screen.queryByText("Solar → Home")).not.toBeInTheDocument();
  });

  it("hides zero-value charging flows", () => {
    renderTooltip({
      active: true,
      label: "10:00",
      payload: [{
        payload: {
          ...baseDatum,
          solarToCar: 0,
          batteryToCar: 0,
          costCents: 0,
        },
      }],
    });
    expect(screen.queryByText("Solar → Car")).not.toBeInTheDocument();
    expect(screen.queryByText("Battery → Car")).not.toBeInTheDocument();
    expect(screen.getByText("Grid → Car")).toBeInTheDocument();
    expect(screen.queryByText(/Grid cost/)).not.toBeInTheDocument();
  });

  it("formats 15-minute ranges across the hour boundary", () => {
    renderTooltip({
      active: true,
      label: "10:45",
      payload: [{ payload: baseDatum }],
    }, { resolution: "15m", bucketLabel: "10:45" });
    expect(screen.getByText("10:45 – 11:00")).toBeInTheDocument();
  });

  it("formats month and year headers", () => {
    renderTooltip({
      active: true,
      label: "15",
      payload: [{ payload: baseDatum }],
    }, { period: "month", bucketLabel: "15" });
    expect(screen.getByText("Sun, Mar 15")).toBeInTheDocument();
    cleanup();
    renderTooltip({
      active: true,
      label: "Mar",
      payload: [{ payload: baseDatum }],
    }, {
      period: "year",
      bucketLabel: "Mar",
      dateCursor: new Date(2026, 0, 1),
    });
    expect(screen.getByText("Mar")).toBeInTheDocument();
  });

  it("shows vehicle state of charge context", () => {
    renderTooltip({
      active: true,
      label: "10:00",
      payload: [{
        payload: {
          ...baseDatum,
          vehicleSoc: [
            { vehicleId: "v1", vehicleName: "Model 3", batteryLevel: 75 },
          ],
        },
      }],
    });
    expect(screen.getByText("Model 3")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });
});
