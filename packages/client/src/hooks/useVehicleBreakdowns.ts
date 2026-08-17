import { useMemo } from "react";
import type {
  StatsPeriod,
  StatsResponse,
  VehicleWithState,
} from "@chargeha/shared";
import type { DayResolution } from "./useStats.ts";
import { trpc } from "../trpc.ts";

export interface VehicleBreakdown {
  vehicleId: string;
  vehicleName: string;
  totalChargedWh: number;
  totalSolarWh: number;
  totalBatteryWh: number;
  totalGridWh: number;
  totalCostCents: number;
  evSolarSavingsCents: number;
}

interface UseVehicleBreakdownsArgs {
  data: StatsResponse | null;
  loading: boolean;
  period: StatsPeriod;
  cursor: Date;
  resolution: DayResolution;
}

interface UseVehicleBreakdownsResult {
  hasChargeData: boolean;
  hasConfiguredVehicles: boolean;
  vehicleBreakdownsLoading: boolean;
  currencySymbol: string;
  activeVehicleBreakdowns: VehicleBreakdown[];
}

function cursorToDateStr(cursor: Date): string {
  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}-${
    String(cursor.getDate()).padStart(2, "0")
  }`;
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
    return queryData.vehicles as VehicleWithState[];
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
          totalChargedWh: response.totalChargedWh,
          totalSolarWh: response.totalSolarWh,
          totalBatteryWh: response.totalBatteryWh,
          totalGridWh: response.totalGridWh,
          totalCostCents: response.totalCostCents ?? 0,
          evSolarSavingsCents: response.evSolarSavingsCents ?? 0,
        };
      })
      .filter((value): value is VehicleBreakdown => value !== null);
  }, [vehicles, vehicleQueries]);

  return {
    hasChargeData: (data?.totalChargedWh ?? 0) > 0,
    hasConfiguredVehicles,
    vehicleBreakdownsLoading,
    currencySymbol: data?.currencySymbol ?? "$",
    activeVehicleBreakdowns: vehicleBreakdowns.filter(
      (vehicle) => vehicle.totalChargedWh > 0,
    ),
  };
}
