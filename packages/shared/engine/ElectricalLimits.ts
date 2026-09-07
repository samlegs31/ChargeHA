import type { EngineInput, VehicleDecision } from "./types.ts";
import { SolarAllocator } from "./SolarAllocator.ts";
import { allocatePower } from "./PowerAllocation.ts";

/** Final guard shared by the controller and simulations, including manual modes. */
export function applyElectricalLimits(
  input: EngineInput,
  decisions: Map<string, VehicleDecision>,
): Map<string, VehicleDecision> {
  const home = input.vehicles.filter((v) => v.state?.isHome === true);
  const entries = home.flatMap((v) => {
    const state = v.state;
    const decision = decisions.get(v.id);
    if (!state || !decision) return [];
    const desired = decision.action === "stop"
      ? 0
      : decision.targetAmps ?? (state.isCharging ? state.chargeAmps : 0);
    return [{
      id: v.id,
      state,
      decision,
      priority: v.priority,
      wattsPerAmp:
        SolarAllocator.resolveVoltage(state, input.energy, input.config) *
        SolarAllocator.resolvePhases(state, input.config),
      maxAmps: Math.min(
        desired,
        state.chargeAmpsMax,
        input.config.vehicleCurrentLimits?.[v.id] ?? state.chargeAmpsMax,
      ),
      desired,
    }];
  }).sort((a, b) => a.priority - b.priority);
  const gridLimit = input.config.maxGridImportKw;
  const gridEnabled = gridLimit != null;
  const currentW = entries.reduce(
    (sum, e) =>
      sum + (e.state.isCharging ? e.state.chargeAmps * e.wattsPerAmp : 0),
    0,
  );
  const energyValid = input.energy && !input.energyUnavailable &&
    !input.energy.pollFailed && Number.isFinite(input.energy.gridPowerW);
  const reclaimW = input.energy
    ? SolarAllocator.reclaimableBatteryChargeW(input.config, input.energy)
    : 0;
  const measuredBudgetW = Math.max(
    0,
    (gridLimit ?? 0) * 1000 - (input.energy?.gridPowerW ?? 0) + currentW +
      reclaimW,
  );
  const budgetW = energyValid ? measuredBudgetW : 0;
  const allocation = gridEnabled
    ? allocatePower(entries, budgetW, !input.config.priorityChargingEnabled)
    : new Map(entries.map((e) => [e.id, e.maxAmps]));
  return new Map([...decisions].map(([id, decision]) => {
    const e = entries.find((entry) => entry.id === id);
    if (!e) return [id, decision];
    const allowed = allocation.get(id) ?? 0;
    if (allowed >= e.desired || e.desired === 0) return [id, decision];
    const canCharge = allowed >= e.state.chargeAmpsMin;
    return [id, {
      ...decision,
      action: limitedAction(canCharge, e.state.isCharging),
      targetAmps: canCharge ? allowed : null,
      reason: "power_limit",
      detail: canCharge
        ? `Charging limited to ${allowed} A by the configured electrical limits`
        : "Waiting for available power within the configured electrical limits",
    }];
  }));
}

function limitedAction(
  canCharge: boolean,
  charging: boolean,
): VehicleDecision["action"] {
  if (canCharge) return charging ? "adjust_amps" : "start";
  return charging ? "stop" : "none";
}
