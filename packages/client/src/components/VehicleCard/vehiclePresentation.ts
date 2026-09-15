import type { VehicleChargeState, VehicleMode } from "@chargeha/shared";

export type ChargeStatusKind =
  | "charging"
  | "waiting"
  | "connected"
  | "disconnected"
  | "error";

export const VEHICLE_MODE_LABELS: Record<VehicleMode, string> = {
  auto: "Solar + Off-Peak",
  vacation: "Solar Only",
  charge_now: "Charge Now",
  stop: "Stop",
};

const WAITING_REASONS = new Set([
  "energy_unavailable",
  "power_limit",
  "battery_priority",
  "grace_period",
  "cooldown",
  "blockout",
  "solar_tracking",
]);

export function formatChargingPower(chargePowerKw: number): string {
  if (!Number.isFinite(chargePowerKw) || chargePowerKw < 0) return "—";
  const watts = Math.round(chargePowerKw * 1000);
  if (watts < 1000) return `${watts} W`;
  return `${(watts / 1000).toFixed(1)} kW`;
}

export function getChargeStatusKind({
  state,
  mode,
  controllerReason,
  vehicleError,
  commandsDisabled = false,
}: {
  state: VehicleChargeState;
  mode: VehicleMode;
  controllerReason?: string | null;
  vehicleError?: string | null;
  commandsDisabled?: boolean;
}): ChargeStatusKind {
  if (vehicleError || commandsDisabled || !state.isOnline) return "error";
  if (!state.isPluggedIn) return "disconnected";
  if (state.isCharging) return "charging";
  if (mode === "stop") return "connected";
  if (mode === "vacation" || WAITING_REASONS.has(controllerReason ?? "")) {
    return "waiting";
  }
  return "connected";
}

export function getStatusHeadline(
  kind: ChargeStatusKind,
  state: VehicleChargeState,
  mode: VehicleMode,
): string {
  if (kind === "charging") {
    return `Charging · ${formatChargingPower(state.chargePowerKw)}`;
  }
  if (kind === "waiting") return "Waiting";
  if (kind === "connected") {
    return mode === "stop" ? "Connected · Stopped" : "Connected";
  }
  if (kind === "disconnected") return "Disconnected";
  return "Error";
}

export function getStatusDetail(
  state: VehicleChargeState,
  mode: VehicleMode,
  atHome: boolean | null | undefined,
  controllerReason: string | null | undefined,
): string {
  if (!state.isOnline) return "Vehicle offline";
  if (!state.isPluggedIn) return "Unplugged";
  if (atHome === false) {
    return state.isCharging ? "Charging away from home" : "Plugged in away";
  }
  if (mode === "stop") {
    return state.isCharging ? "Stop requested" : "Charging stopped";
  }
  if (state.isCharging) {
    if (controllerReason === "schedule") return "Scheduled charging";
    if (controllerReason === "solar_tracking" || mode === "vacation") {
      return "Solar charging";
    }
    if (controllerReason === "power_limit") return "Power limited";
    if (controllerReason === "energy_unavailable") return "Safe minimum charge";
    if (mode === "charge_now") return "Manual charging";
    return "Charging";
  }
  if (controllerReason === "energy_unavailable") {
    return "Waiting for energy data";
  }
  if (controllerReason === "power_limit") return "Waiting for available power";
  if (controllerReason === "battery_priority") return "Home battery priority";
  if (controllerReason === "grace_period") return "Waiting for stable solar";
  if (controllerReason === "cooldown") return "Waiting for solar";
  if (controllerReason === "blockout") return "Paused by schedule";
  if (mode === "vacation" || controllerReason === "solar_tracking") {
    return "Waiting for solar";
  }
  if (mode === "charge_now") return "Starting charge";
  return "Plugged in · Ready";
}
