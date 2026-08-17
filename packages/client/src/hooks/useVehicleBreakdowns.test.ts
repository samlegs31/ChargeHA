import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";
import type { StatsResponse } from "@chargeha/shared";

const hoisted = vi.hoisted(() => ({
  state: {
    listData: undefined as
      | { vehicles: Array<{ id: string; name: string }> }
      | undefined,
    listIsPending: false,
    queriesResults: [] as Array<
      { data: Record<string, unknown> | undefined; isPending: boolean }
    >,
  },
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    vehicle: {
      list: {
        useQuery: () => ({
          data: hoisted.state.listData,
          isPending: hoisted.state.listIsPending,
        }),
      },
    },
    useQueries: (fn: (t: Record<string, unknown>) => unknown[]) => {
      const t = {
        stats: {
          day: vi.fn((..._args: unknown[]) => ({})),
          month: vi.fn((..._args: unknown[]) => ({})),
          year: vi.fn((..._args: unknown[]) => ({})),
          total: vi.fn((..._args: unknown[]) => ({})),
        },
      };
      fn(t);
      return hoisted.state.queriesResults;
    },
  },
}));

import { useVehicleBreakdowns } from "./useVehicleBreakdowns.ts";

describe("useVehicleBreakdowns", () => {
  const baseStatsData: StatsResponse = {
    period: "day",
    startDate: "2026-03-01",
    endDate: "2026-03-01",
    energyBuckets: [],
    homeSolarProductionWh: 0,
    homeConsumedWh: 10000,
    homeSolarWh: 6000,
    homeBatteryChargeWh: 0,
    homeBatteryDischargeWh: 0,
    homeSolarToBatteryWh: 0,
    homeGridToBatteryWh: 0,
    homeGridWh: 4000,
    homeSelfPoweredPercent: 60,
    solarProductionLine: [],
    buckets: [],
    totalChargedWh: 5500,
    totalSolarWh: 3000,
    totalBatteryWh: 0,
    totalGridWh: 2000,
    totalAwayWh: 500,
    selfPoweredPercent: 60,
    totalCostCents: 150,
    evSolarSavingsCents: 200,
    currencySymbol: "A$",
    tariffBreakdown: [],
  };

  const createWrapper = () => {
    const queryClient = createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
  };

  type Args = Parameters<typeof useVehicleBreakdowns>[0];

  const defaultArgs = (): Args => ({
    data: null,
    loading: false,
    period: "day",
    cursor: new Date(2026, 0, 15),
    resolution: "1h",
  });

  const runHook = (overrides: Partial<Args> = {}) =>
    renderHook(
      () => useVehicleBreakdowns({ ...defaultArgs(), ...overrides }),
      { wrapper: createWrapper() },
    );

  beforeEach(() => {
    hoisted.state.listData = undefined;
    hoisted.state.listIsPending = false;
    hoisted.state.queriesResults = [];
  });

  it("returns EV defaults when no vehicles and no data", () => {
    const { result } = runHook();

    expect(result.current.hasChargeData).toBe(false);
    expect(result.current.hasConfiguredVehicles).toBe(false);
    expect(result.current.vehicleBreakdownsLoading).toBe(false);
    expect(result.current.currencySymbol).toBe("$");
    expect(result.current.activeVehicleBreakdowns).toEqual([]);
  });

  it.each([
    { totalChargedWh: 5000, expected: true },
    { totalChargedWh: 0, expected: false },
  ])(
    "hasChargeData is $expected when totalChargedWh=$totalChargedWh",
    ({ totalChargedWh, expected }) => {
      const { result } = runHook({
        data: { ...baseStatsData, totalChargedWh },
      });
      expect(result.current.hasChargeData).toBe(expected);
    },
  );

  it.each([
    { name: "from data", data: baseStatsData, expected: "A$" },
    { name: "default $", data: null, expected: "$" },
  ])("currencySymbol $name", ({ data, expected }) => {
    const { result } = runHook({ data });
    expect(result.current.currencySymbol).toBe(expected);
  });

  it("hasConfiguredVehicles is true when vehicles exist", () => {
    hoisted.state.listData = { vehicles: [{ id: "VIN1", name: "Model 3" }] };
    hoisted.state.queriesResults = [{ data: undefined, isPending: false }];

    const { result } = runHook({ data: baseStatsData });

    expect(result.current.hasConfiguredVehicles).toBe(true);
  });

  it("supports the Total period for per-vehicle queries", () => {
    hoisted.state.listData = { vehicles: [{ id: "VIN1", name: "Model 3" }] };
    hoisted.state.queriesResults = [{
      data: {
        totalChargedWh: 5500,
        totalSolarWh: 3000,
        totalBatteryWh: 0,
        totalGridWh: 2000,
        totalAwayWh: 500,
        totalCostCents: 150,
        evSolarSavingsCents: 200,
      },
      isPending: false,
    }];

    const { result } = runHook({ data: baseStatsData, period: "total" });

    expect(result.current.activeVehicleBreakdowns[0]?.vehicleId).toBe("VIN1");
    expect(result.current.activeVehicleBreakdowns[0]?.totalAwayWh).toBe(500);
  });

  it("vehicleBreakdownsLoading is true when vehiclesQuery is pending", () => {
    hoisted.state.listIsPending = true;

    const { result } = runHook();

    expect(result.current.vehicleBreakdownsLoading).toBe(true);
  });

  it("vehicleBreakdownsLoading is true when any vehicle query is pending", () => {
    hoisted.state.listData = { vehicles: [{ id: "VIN1", name: "Model 3" }] };
    hoisted.state.queriesResults = [{ data: undefined, isPending: true }];

    const { result } = runHook();

    expect(result.current.vehicleBreakdownsLoading).toBe(true);
  });

  it("maps vehicle query results to EV breakdowns", () => {
    hoisted.state.listData = {
      vehicles: [
        { id: "VIN1", name: "Model 3" },
        { id: "VIN2", name: "Model Y" },
      ],
    };
    hoisted.state.queriesResults = [
      {
        data: {
          totalChargedWh: 3500,
          totalSolarWh: 2000,
          totalBatteryWh: 0,
          totalGridWh: 1000,
          totalAwayWh: 500,
          totalCostCents: 100,
          evSolarSavingsCents: 150,
        },
        isPending: false,
      },
      {
        data: {
          totalChargedWh: 2250,
          totalSolarWh: 1000,
          totalBatteryWh: 0,
          totalGridWh: 1000,
          totalAwayWh: 250,
          totalCostCents: null,
          evSolarSavingsCents: null,
        },
        isPending: false,
      },
    ];

    const { result } = runHook({ data: baseStatsData });

    expect(result.current.activeVehicleBreakdowns).toEqual([
      {
        vehicleId: "VIN1",
        vehicleName: "Model 3",
        totalChargedWh: 3500,
        totalSolarWh: 2000,
        totalBatteryWh: 0,
        totalGridWh: 1000,
        totalAwayWh: 500,
        totalCostCents: 100,
        evSolarSavingsCents: 150,
      },
      {
        vehicleId: "VIN2",
        vehicleName: "Model Y",
        totalChargedWh: 2250,
        totalSolarWh: 1000,
        totalBatteryWh: 0,
        totalGridWh: 1000,
        totalAwayWh: 250,
        totalCostCents: 0,
        evSolarSavingsCents: 0,
      },
    ]);
  });

  it("filters out vehicles with zero charge data", () => {
    hoisted.state.listData = {
      vehicles: [
        { id: "VIN1", name: "Model 3" },
        { id: "VIN2", name: "Model Y" },
      ],
    };
    hoisted.state.queriesResults = [
      {
        data: {
          totalChargedWh: 3000,
          totalSolarWh: 2000,
          totalBatteryWh: 0,
          totalGridWh: 1000,
          totalAwayWh: 0,
          totalCostCents: 100,
          evSolarSavingsCents: 150,
        },
        isPending: false,
      },
      {
        data: {
          totalChargedWh: 0,
          totalSolarWh: 0,
          totalBatteryWh: 0,
          totalGridWh: 0,
          totalAwayWh: 0,
          totalCostCents: 0,
          evSolarSavingsCents: 0,
        },
        isPending: false,
      },
    ];

    const { result } = runHook({ data: baseStatsData });

    expect(result.current.activeVehicleBreakdowns).toHaveLength(1);
    expect(result.current.activeVehicleBreakdowns[0].vehicleId).toBe("VIN1");
  });

  it("filters out vehicles with no query data", () => {
    hoisted.state.listData = { vehicles: [{ id: "VIN1", name: "Model 3" }] };
    hoisted.state.queriesResults = [{ data: undefined, isPending: false }];

    const { result } = runHook({ data: baseStatsData });

    expect(result.current.activeVehicleBreakdowns).toEqual([]);
  });
});
