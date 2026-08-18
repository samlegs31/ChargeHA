import { TRPCError } from "@trpc/server";
import type { TeslaVehiclePlugin } from "./index.ts";

export type TeslaVehicleVisualConfig = {
  carType: string | null;
  exteriorColor: string | null;
  wheelType: string | null;
  trim: string | null;
  roofColor: string | null;
  spoilerType: string | null;
};

export async function fetchTeslaVehicleVisualConfig(
  plugin: TeslaVehiclePlugin,
  vin: string,
): Promise<TeslaVehicleVisualConfig> {
  const token = await plugin.teslaTokenManager.getAccessToken();
  const fleetBase = await plugin.teslaTokenManager.getFleetApiBaseUrl();
  const endpoints = encodeURIComponent("vehicle_config");
  const response = await fetch(
    `${fleetBase}/api/1/vehicles/${encodeURIComponent(vin)}/vehicle_data?endpoints=${endpoints}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `Tesla vehicle_config unavailable (${response.status}): ${detail}`,
    });
  }

  const data = await response.json();
  const config = data.response?.vehicle_config ?? {};
  return {
    carType: config.car_type ?? null,
    exteriorColor: config.exterior_color ?? null,
    wheelType: config.wheel_type ?? null,
    trim: config.trim_badging ?? config.trim ?? null,
    roofColor: config.roof_color ?? null,
    spoilerType: config.spoiler_type ?? null,
  };
}
