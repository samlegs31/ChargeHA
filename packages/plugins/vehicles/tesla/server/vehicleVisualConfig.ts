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

type TeslaVehicleDataResponse = {
  response?: {
    vehicle_config?: Record<string, unknown>;
  };
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

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

  const data = await response.json() as TeslaVehicleDataResponse;
  const config = data.response?.vehicle_config ?? {};
  return {
    carType: optionalString(config.car_type),
    exteriorColor: optionalString(config.exterior_color),
    wheelType: optionalString(config.wheel_type),
    trim: optionalString(config.trim_badging) ?? optionalString(config.trim),
    roofColor: optionalString(config.roof_color),
    spoilerType: optionalString(config.spoiler_type),
  };
}
