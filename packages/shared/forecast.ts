import { z } from "zod";
import type { VehicleMode } from "./types.ts";

export const solarArrayConfigSchema = z.object({
  name: z.string().trim().min(1).max(80),
  capacityKwp: z.number().positive().max(1000),
  azimuthDeg: z.number().min(0).max(360),
  tiltDeg: z.number().min(0).max(90),
});

export const solarArraysConfigSchema = z.array(solarArrayConfigSchema)
  .min(1)
  .max(24);

export type SolarArrayConfig = z.infer<typeof solarArrayConfigSchema>;

export function parseSolarArrays(raw: string): SolarArrayConfig[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    const result = solarArraysConfigSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export interface ForecastScheduleSummary {
  startAt: string;
  endAt: string;
  amps: number;
  targetPercent: number;
  expectedFinishAt: string | null;
}

export type ForecastConfidence = "low" | "medium" | "high";

export interface SolarChargeForecast {
  available: true;
  vehicleId: string;
  mode: Extract<VehicleMode, "vacation" | "auto">;
  generatedAt: string;
  timezone: string;
  pvRemainingKwh: number;
  solarChargeRemainingKwh: number;
  solarEndAt: string | null;
  socAtSolarEnd: number;
  finalSoc: number;
  finalAt: string | null;
  schedule: ForecastScheduleSummary | null;
  confidence: ForecastConfidence;
}

export interface SolarChargeForecastUnavailable {
  available: false;
  reason:
    | "not_configured"
    | "vehicle_not_found"
    | "vehicle_unplugged"
    | "vehicle_away"
    | "unsupported_mode"
    | "energy_unavailable"
    | "weather_unavailable";
  message: string;
}

export type SolarChargeForecastResult =
  | SolarChargeForecast
  | SolarChargeForecastUnavailable;
