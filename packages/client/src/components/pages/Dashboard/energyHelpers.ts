import { useMemo } from "react";
import type {
  EnergyData,
  VehicleChargeState,
  VehicleWithState,
} from "@chargeha/shared";
import { isHome } from "@chargeha/shared/geo";
import { calculateSolarAttribution } from "@chargeha/shared/solarAttribution";
import type { ChargingVehicleFlow } from "../../EnergyFlowDiagram/EnergyFlowDiagram.tsx";

type HomeLocation = { lat: number; lng: number } | null;

/** Format minutes until a future time as a human-readable string (e.g., "2h 15m", "45m"). */
export function formatTimeUntil(isoString: string): string {
  const diffMs = new Date(isoString).getTime() - Date.now();
  const diffMin = Math.max(0, Math.round(diffMs / 60_000));
  if (diffMin < 60) return `${diffMin}m`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * A vehicle can only participate in the home's live energy balance when its
 * latest known location is positively inside the configured home radius.
 * Unknown location/home configuration deliberately fails closed so an away
 * charge can never be attributed to the home's solar, battery or grid.
 */
export function isChargingVehicleAtHome(
  vehicle: VehicleWithState,
  home: HomeLocation,
): vehicle is VehicleWithState & { state: VehicleChargeState } {
  return !!vehicle.state?.isCharging &&
    vehicle.state.chargePowerKw > 0 &&
    isHome(home, vehicle.lastLocation ?? null) === true;
}

/** Per-vehicle source attribution for currently-charging vehicles at home. */
export function useVehicleSolarGrid(
  realtime: EnergyData | null,
  vehicles: VehicleWithState[],
  home: HomeLocation,
): Record<string, { solarW: number; batteryW: number; gridW: number }> {
  return useMemo(() => {
    if (!realtime) return {};

    const chargingVehicles = vehicles.filter((v) =>
      isChargingVehicleAtHome(v, home)
    );
    const totalChargePowerW = chargingVehicles.reduce(
      (sum, v) => sum + (v.state.chargePowerKw * 1000),
      0,
    );

    return Object.fromEntries(
      chargingVehicles.map((v) => [
        v.id,
        calculateSolarAttribution(
          v.state.chargePowerKw * 1000,
          totalChargePowerW,
          realtime.solarProductionW,
          realtime.homeConsumptionW,
          realtime.batteryPowerW ?? 0,
        ),
      ]),
    );
  }, [realtime, vehicles, home]);
}

/**
 * Compute solar vs grid split per charging vehicle and build the
 * ChargingVehicleFlow[] list for the energy flow diagram. Away vehicles are
 * intentionally excluded from the home diagram.
 */
export function useChargingVehicleFlows(
  realtime: EnergyData | null,
  vehicles: VehicleWithState[],
  home: HomeLocation,
): ChargingVehicleFlow[] {
  const vehicleSolarGrid = useVehicleSolarGrid(realtime, vehicles, home);

  // Build charging-at-home vehicles list for the energy flow diagram
  return useMemo(() => {
    return vehicles
      .filter((v) => isChargingVehicleAtHome(v, home))
      .map((v) => ({
        id: v.id,
        name: v.name || v.state.vehicleName,
        chargePowerW: v.state.chargePowerKw * 1000,
        solarW: vehicleSolarGrid[v.id]?.solarW ?? 0,
        batteryW: vehicleSolarGrid[v.id]?.batteryW ?? 0,
        gridW: vehicleSolarGrid[v.id]?.gridW ?? 0,
      }));
  }, [vehicles, vehicleSolarGrid, home]);
}
