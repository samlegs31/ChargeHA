import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";

type Period = "day" | "month" | "year" | "total";
type QueryState = {
  data: unknown;
  isLoading: boolean;
  error: Error | null;
};

const hoisted = vi.hoisted(() => ({
  results: {
    day: { data: undefined, isLoading: true, error: null },
    month: { data: undefined, isLoading: true, error: null },
    year: { data: undefined, isLoading: true, error: null },
    total: { data: undefined, isLoading: true, error: null },
  } as Record<Period, QueryState>,
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    stats: {
      day: { useQuery: vi.fn(() => hoisted.results.day) },
      month: { useQuery: vi.fn(() => hoisted.results.month) },
      year: { useQuery: vi.fn(() => hoisted.results.year) },
      total: { useQuery: vi.fn(() => hoisted.results.total) },
    },
  },
}));

import { useStats } from "./useStats.ts";

describe("useStats", () => {
  const fakeResponse = {
    period: "day" as const,
    startDate: "2026-03-01",
    endDate: "2026-03-01",
    buckets: [],
    energyBuckets: [],
    solarProductionLine: [],
    totalChargedWh: 0,
    totalSolarWh: 0,
    totalBatteryWh: 0,
    totalGridWh: 0,
    totalAwayWh: 0,
    selfPoweredPercent: 0,
    homeSolarProductionWh: 0,
    homeConsumedWh: 0,
    homeSolarWh: 0,
    homeBatteryChargeWh: 0,
    homeBatteryDischargeWh: 0,
    homeSolarToBatteryWh: 0,
    homeGridToBatteryWh: 0,
    homeGridWh: 0,
    homeSelfPoweredPercent: 0,
  };

  const createWrapper = () => {
    const queryClient = createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
  };

  const setResult = (period: Period, state: Partial<QueryState>) => {
    hoisted.results[period] = {
      data: undefined,
      isLoading: false,
      error: null,
      ...state,
    };
  };

  const renderStatsHook = () =>
    renderHook(() => useStats(), { wrapper: createWrapper() });

  beforeEach(() => {
    setResult("day", { data: undefined, isLoading: true });
    setResult("month", { data: undefined, isLoading: true });
    setResult("year", { data: undefined, isLoading: true });
    setResult("total", { data: undefined, isLoading: true });
  });

  it("starts on Day", () => {
    const { result } = renderStatsHook();
    expect(result.current.period).toBe("day");
    expect(result.current.resolution).toBe("1h");
  });

  it("shows Total as All years", () => {
    setResult("day", { data: fakeResponse });
    setResult("total", { data: { ...fakeResponse, period: "total" } });
    const { result } = renderStatsHook();

    act(() => result.current.setPeriod("total"));

    expect(result.current.period).toBe("total");
    expect(result.current.cursorLabel).toBe("All years");
    expect(result.current.isAtPresent).toBe(true);
    expect(result.current.data?.period).toBe("total");
  });

  it("does not move the cursor while Total is selected", () => {
    setResult("day", { data: fakeResponse });
    setResult("total", { data: { ...fakeResponse, period: "total" } });
    const { result } = renderStatsHook();
    act(() => result.current.setPeriod("total"));
    const cursor = result.current.cursor.getTime();

    act(() => {
      result.current.goBack();
      result.current.goForward();
    });

    expect(result.current.cursor.getTime()).toBe(cursor);
  });

  it("drills from Total into a selected year", () => {
    setResult("day", { data: fakeResponse });
    const { result } = renderStatsHook();

    act(() => result.current.drillDown("year", new Date(2025, 0, 1)));

    expect(result.current.period).toBe("year");
    expect(result.current.cursor.getFullYear()).toBe(2025);
  });

  it("surfaces Total query errors", () => {
    setResult("day", { data: fakeResponse });
    setResult("total", { error: new Error("Total fetch failed") });
    const { result } = renderStatsHook();

    act(() => result.current.setPeriod("total"));

    expect(result.current.error).toBe("Total fetch failed");
  });
});
