import { useMemo } from "react";
import type { VehicleWithState } from "@chargeha/shared";
import type {
  DayResolution,
  StatsViewPeriod,
  StatsViewResponse,
} from "./useStats.ts";
import { trpc } from "../trpc.ts";

export type VehicleHomeChargingSource = "chargehq" | "solarweb" | null;

type VehicleStateWithColor = NonNullable<VehicleWithState["state"]> & {
  exteriorColor?: string | null;
};

type StatsVehicle = Omit<VehicleWithState, "state"> & {
  state: VehicleStateWithColor | null;
  homeChargingSource?: VehicleHomeChargingSource;
};

export interface VehicleBreakdown {
  vehicleId: string;
  vehicleName: string;
  exteriorColor: string | null;
  homeChargingSource: VehicleHomeChargingSource;
  totalChargedWh: number;
  totalSolarWh: number;
  totalBatteryWh: number;
  totalGridWh: number;
  totalAwayWh: number;
  totalCostCents: number;
  evSolarSavingsCents: number;
}

export interface UnassignedBreakdown {
  totalChargedWh: number;
  totalSolarWh: number;
  totalBatteryWh: number;
  totalGridWh: number;
  totalAwayWh: number;
}

interface UseVehicleBreakdownsArgs {
  data: StatsViewResponse | null;
  loading: boolean;
  period: StatsViewPeriod;
  cursor: Date;
  resolution: DayResolution;
}

interface UseVehicleBreakdownsResult {
  hasChargeData: boolean;
  hasConfiguredVehicles: boolean;
  vehicleBreakdownsLoading: boolean;
  currencySymbol: string;
  activeVehicleBreakdowns: VehicleBreakdown[];
  unassignedBreakdown: UnassignedBreakdown | null;
}

function cursorToDateStr(cursor: Date): string {
  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}-${
    String(cursor.getDate()).padStart(2, "0")
  }`;
}

function nonNegativeDifference(total: number, attributed: number): number {
  return Math.max(0, total - attributed);
}

export function computeUnassignedBreakdown(
  data: StatsViewResponse | null,
  vehicles: readonly VehicleBreakdown[],
): UnassignedBreakdown | null {
  if (!data) return null;

  const attributed = vehicles.reduce(
    (sum, vehicle) => ({
      solarWh: sum.solarWh + vehicle.totalSolarWh,
      batteryWh: sum.batteryWh + vehicle.totalBatteryWh,
      gridWh: sum.gridWh + vehicle.totalGridWh,
      awayWh: sum.awayWh + vehicle.totalAwayWh,
    }),
    { solarWh: 0, batteryWh: 0, gridWh: 0, awayWh: 0 },
  );

  const totalSolarWh = nonNegativeDifference(
    data.totalSolarWh,
    attributed.solarWh,
  );
  const totalBatteryWh = nonNegativeDifference(
    data.totalBatteryWh,
    attributed.batteryWh,
  );
  const totalGridWh = nonNegativeDifference(data.totalGridWh, attributed.gridWh);
  const totalAwayWh = nonNegativeDifference(data.totalAwayWh, attributed.awayWh);
  const totalChargedWh = totalSolarWh + totalBatteryWh + totalGridWh + totalAwayWh;

  // Keep real legacy/unattributed history visible, but ignore sub-Wh float noise.
  if (totalChargedWh < 1) return null;

  return {
    totalChargedWh,
    totalSolarWh,
    totalBatteryWh,
    totalGridWh,
    totalAwayWh,
  };
}

export function useVehicleBreakdowns({
  data,
  loading,
  period,
  cursor,
  resolution,
}: UseVehicleBreakdownsArgs): UseVehicleBreakdownsResult {
  const vehiclesQuery = trpc.vehicle.list.useQuery();
  const vehicles = useMemo(() => {
    const queryData = vehiclesQuery.data;
    if (!queryData) return [];
    return queryData.vehicles as StatsVehicle[];
  }, [vehiclesQuery.data]);
  const hasConfiguredVehicles = vehicles.length > 0;

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  const dateStr = cursorToDateStr(cursor);
  const tz = useMemo(() => -(new Date().getTimezoneOffset() / 60), []);

  const vehicleQueries = trpc.useQueries((t) =>
    vehicles.map((vehicle) => {
      switch (period) {
        case "day":
          return t.stats.day(
            {
              date: dateStr,
              vehicleId: vehicle.id,
              tz,
              resolution: resolution === "15m" ? "15m" : undefined,
            },
            { enabled: !loading },
          );
        case "month":
          return t.stats.month(
            { year, month, vehicleId: vehicle.id, tz },
            { enabled: !loading },
          );
        case "year":
          return t.stats.year(
            { year, vehicleId: vehicle.id, tz },
            { enabled: !loading },
          );
        case "total":
          return t.stats.total(
            { vehicleId: vehicle.id, tz },
            { enabled: !loading },
          );
      }
    })
  );

  const vehicleBreakdownsLoading = vehiclesQuery.isPending ||
    vehicleQueries.some((query) => query.isPending);

  const vehicleBreakdowns = useMemo(() => {
    return vehicles
      .map((vehicle, index) => {
        const response = vehicleQueries[index]?.data;
        if (!response) return null;
        return {
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          exteriorColor: vehicle.state?.exteriorColor ?? null,
          homeChargingSource: vehicle.homeChargingSource ?? null,
          totalChargedWh: response.totalChargedWh,
          totalSolarWh: response.totalSolarWh,
          totalBatteryWh: response.totalBatteryWh,
          totalGridWh: response.totalGridWh,
          totalAwayWh: response.totalAwayWh,
          totalCostCents: response.totalCostCents ?? 0,
          evSolarSavingsCents: response.evSolarSavingsCents ?? 0,
        };
      })
      .filter((value): value is VehicleBreakdown => value !== null);
  }, [vehicles, vehicleQueries]);

  const activeVehicleBreakdowns = useMemo(
    () => vehicleBreakdowns.filter((vehicle) => vehicle.totalChargedWh > 0),
    [vehicleBreakdowns],
  );
  const hasCompleteVehicleStats = vehicleBreakdowns.length === vehicles.length;
  const unassignedBreakdown = useMemo(
    () => hasConfiguredVehicles && hasCompleteVehicleStats
      ? computeUnassignedBreakdown(data, vehicleBreakdowns)
      : null,
    [data, vehicleBreakdowns, hasConfiguredVehicles, hasCompleteVehicleStats],
  );

  return {
    hasChargeData: (data?.totalChargedWh ?? 0) > 0,
    hasConfiguredVehicles,
    vehicleBreakdownsLoading,
    currencySymbol: data?.currencySymbol ?? "$",
    activeVehicleBreakdowns,
    unassignedBreakdown,
  };
}
