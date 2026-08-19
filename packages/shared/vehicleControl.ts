export type VehicleChargeController = "vehicle" | "wattpilot";

function parseVehicleConfig(
  config: string | null | undefined,
): Record<string, unknown> {
  if (!config) return {};
  try {
    const parsed = JSON.parse(config);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/**
 * Returns which system is allowed to control charging for a vehicle.
 * Missing/legacy metadata defaults to direct vehicle control.
 */
export function getVehicleChargeController(
  config: string | null | undefined,
): VehicleChargeController {
  return parseVehicleConfig(config).chargeController === "wattpilot"
    ? "wattpilot"
    : "vehicle";
}

/** Merge charge-controller metadata into the existing per-vehicle JSON config. */
export function setVehicleChargeController(
  config: string | null | undefined,
  controller: VehicleChargeController,
): string {
  const next = parseVehicleConfig(config);
  if (controller === "vehicle") {
    delete next.chargeController;
  } else {
    next.chargeController = controller;
  }
  return JSON.stringify(next);
}

export function isExternallyControlledVehicle(
  config: string | null | undefined,
): boolean {
  return getVehicleChargeController(config) === "wattpilot";
}
