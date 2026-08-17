import { useMemo } from "react";
import { trpc } from "../trpc.ts";

export interface VehicleOption {
  id: string;
  name: string;
}

/** Stable, read-only vehicle choices exposed to plugin UI through hostUi. */
export function useVehicleOptions(): VehicleOption[] {
  const query = trpc.vehicle.list.useQuery();
  return useMemo(
    () => (query.data?.vehicles ?? []).map((vehicle) => ({
      id: vehicle.id,
      name: vehicle.name,
    })),
    [query.data?.vehicles],
  );
}
