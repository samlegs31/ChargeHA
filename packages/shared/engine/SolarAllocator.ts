import { allocatePower } from "./PowerAllocation.ts";
import type { EnergyData, VehicleChargeState } from "../types.ts";
import type { ControllerConfig, EngineVehicleInput } from "./types.ts";

/** Eligible vehicle enriched with resolved electrical parameters. */
export interface AllocationEntry {
  id: string;
  name: string;
  priority: number;
  state: VehicleChargeState;
  voltage: number;
  phases: number;
}

interface AllocationContext {
  eligible: AllocationEntry[];
  availableW: number;
}

/** Solar calculation and multi-vehicle amp allocation. */
export class SolarAllocator {
  /** Resolve charger voltage: trust the vehicle if >= 100V, otherwise fall
   *  back to the inverter grid reading, then the user's configured value. */
  static resolveVoltage(
    state: VehicleChargeState,
    energy: EnergyData | null,
    config: ControllerConfig,
  ): number {
    if (state.chargerVoltage >= 100) return state.chargerVoltage;
    return energy?.gridVoltageV ?? config.gridVoltage;
  }

  /** Resolve charger phases: a live single-phase reading while charging
   *  overrides the threePhaseCharger flag (e.g. a three-phase install
   *  charging from a regular wall socket). Vehicles only report phases while
   *  charging, so the flag stands until a real reading arrives. */
  static resolvePhases(
    state: VehicleChargeState,
    config: ControllerConfig,
  ): number {
    if (state.isCharging && state.chargerPhases === 1) return 1;
    return config.threePhaseCharger ? 3 : state.chargerPhases;
  }

  /** Surplus solar in watts, before the safety margin.
   *
   *  Starts from grid export, then:
   *  - Subtracts home battery discharge. Power leaving the battery is not
   *    solar. Without this, a battery operating in self-consumption won't be
   *    drawing from the grid, and would makes the EV's own draw reappear as
   *    "available solar" through the add-back below, and the car would charge
   *    off the home battery.
   *  - Adds back the EV's charge power when the meter includes EV load in
   *    consumption (the default), since the car's own draw suppresses export.
   *  - Once the enabled home-battery reserve is reached, includes power still
   *    charging that battery so the EV can start without waiting for export.
   *  - Caps at solar production: surplus can never exceed what the panels are
   *    making right now.
   *
   *  `addBackW` is the charge power to add back — 0 when the meter excludes EV
   *  load or nothing is charging. */
  static surplusW(
    energy: EnergyData,
    addBackW: number,
    config: ControllerConfig,
  ): number {
    const batteryDischargeW = Math.max(0, energy.batteryPowerW ?? 0);
    const batteryChargeW = SolarAllocator.reclaimableBatteryChargeW(
      config,
      energy,
    );
    // Once the reserve is met, redirect solar still going into the home
    // battery to the EV. Subtracting grid import keeps grid-fed battery
    // charging from being mistaken for available solar.
    const exportW = -energy.gridPowerW - batteryDischargeW + batteryChargeW;
    return Math.min(exportW + addBackW, energy.solarProductionW);
  }

  static reclaimableBatteryChargeW(
    config: Pick<
      ControllerConfig,
      "batteryPriorityEnabled" | "batteryPriorityLimit"
    >,
    energy: EnergyData,
  ): number {
    if (!config.batteryPriorityEnabled || energy.batterySoc === null) return 0;
    const soc = energy.batterySoc;
    if (!Number.isFinite(soc) || soc > 100) return 0;
    if (soc < config.batteryPriorityLimit) return 0;
    if (!Number.isFinite(energy.batteryPowerW)) return 0;
    return Math.max(0, -(energy.batteryPowerW ?? 0));
  }

  /** Charge power to add back for one vehicle — zero when the meter already
   *  excludes EV load, or the vehicle isn't drawing anything.
   *
   *  Uses state.chargeAmps (kept current by VehicleManager.startChargingAt
   *  after confirmed commands) rather than the vehicle-reported chargePowerKw,
   *  which can lag. */
  static addBackW(
    config: ControllerConfig,
    state: VehicleChargeState,
    voltage: number,
    phases: number,
  ): number {
    if (config.consumptionExcludesCharging || !state.isCharging) return 0;
    return state.chargeAmps * voltage * phases;
  }

  /** Available watts after the reference mode and safety margin are applied.
   *  `addBackW` is the total charge power to add back across all vehicles
   *  being considered. */
  static resolveAvailableW(
    config: ControllerConfig,
    energy: EnergyData,
    addBackW: number,
  ): number {
    const marginW = config.solarMarginKw * 1000;

    // Gross mode: total panel output, as-is. No add-back — panel output never
    // had the car's draw subtracted from it, so adding it would double-count.
    if (config.solarReference === "gross") {
      return Math.max(0, energy.solarProductionW - marginW);
    }

    return Math.max(
      0,
      SolarAllocator.surplusW(energy, addBackW, config) - marginW,
    );
  }

  /** Calculate available solar power in watts for a single vehicle's charging. */
  static calculateAvailableSolar(
    config: ControllerConfig,
    energy: EnergyData,
    state: VehicleChargeState,
    voltage: number,
    phases: number,
  ): number {
    return SolarAllocator.resolveAvailableW(
      config,
      energy,
      SolarAllocator.addBackW(config, state, voltage, phases),
    );
  }

  /** Top-level allocation dispatcher: waterfall or equal based on config. */
  static allocate(
    vehicles: EngineVehicleInput[],
    config: ControllerConfig,
    energy: EnergyData | null,
  ): Map<string, number> {
    return config.priorityChargingEnabled
      ? SolarAllocator.waterfall(vehicles, config, energy)
      : SolarAllocator.equal(vehicles, config, energy);
  }

  /** Equal allocation: share watts, convert for each vehicle, redistribute leftovers.
   *  When the split gives any vehicle less than its chargeAmpsMin, progressively
   *  drops lowest-priority vehicles until the split is viable. */
  static equal(
    vehicles: EngineVehicleInput[],
    config: ControllerConfig,
    energy: EnergyData | null,
  ): Map<string, number> {
    const ctx = SolarAllocator.getContext(vehicles, config, energy);
    if (!ctx) return new Map();
    const { eligible, availableW } = ctx;
    const groupSizes = Array.from(
      { length: eligible.length },
      (_, i) => eligible.length - i,
    );
    const canShare = (n: number) =>
      eligible.slice(0, n).every((e) => {
        const buffer = e.state.isCharging ? 0 : 2;
        return availableW / n >=
          (e.state.chargeAmpsMin + buffer) * e.voltage * e.phases;
      });
    const groupSize = groupSizes.find(canShare) ?? 1;
    const recipients = eligible.slice(0, groupSize);
    const allocated = allocatePower(
      recipients.map((e) => ({
        id: e.id,
        wattsPerAmp: e.voltage * e.phases,
        maxAmps: e.state.chargeAmpsMax,
      })),
      availableW,
      true,
    );
    return new Map([
      ...allocated,
      ...eligible.slice(groupSize).map((e) => [e.id, 0] as const),
    ]);
  }

  /** Waterfall allocation: priority 1 takes watts up to its current limit,
   *  overflow goes to priority 2, then priority 3, etc. */
  static waterfall(
    vehicles: EngineVehicleInput[],
    config: ControllerConfig,
    energy: EnergyData | null,
  ): Map<string, number> {
    const ctx = SolarAllocator.getContext(vehicles, config, energy);
    if (!ctx) return new Map();
    return allocatePower(
      ctx.eligible.map((e) => ({
        id: e.id,
        wattsPerAmp: e.voltage * e.phases,
        maxAmps: e.state.chargeAmpsMax,
      })),
      ctx.availableW,
      false,
    );
  }

  /** Build the allocation context: filter eligible vehicles, compute total
   *  available amps. Returns null when allocation doesn't apply (< 2 eligible
   *  vehicles, no energy data, or solar tracking disabled). */
  private static getContext(
    vehicles: EngineVehicleInput[],
    config: ControllerConfig,
    energy: EnergyData | null,
  ): AllocationContext | null {
    if (!energy || !config.solarTrackingEnabled || vehicles.length < 2) {
      return null;
    }

    // Filter to eligible: either stored solar mode (auto or vacation), plugged
    // in, positively confirmed at home, and below the vehicle charge limit.
    const eligible = vehicles
      .filter((v): v is EngineVehicleInput & { state: VehicleChargeState } =>
        (v.mode === "auto" || v.mode === "vacation") &&
        v.state?.isPluggedIn === true &&
        v.state.isHome === true &&
        v.state.batteryLevel < v.state.chargeLimit
      )
      .map((v) => {
        const state = v.state;
        const voltage = SolarAllocator.resolveVoltage(state, energy, config);
        const phases = SolarAllocator.resolvePhases(state, config);
        return {
          id: v.id,
          name: v.name,
          priority: v.priority,
          state,
          voltage,
          phases,
        };
      })
      .sort((a, b) => a.priority - b.priority);

    if (eligible.length < 2) return null;

    // Add back ALL charging vehicles' power — in excess mode the grid export
    // is suppressed by every car's draw, not just one.
    const chargingAddBackW = eligible.reduce(
      (sum, e) =>
        sum + SolarAllocator.addBackW(config, e.state, e.voltage, e.phases),
      0,
    );

    const availableW = SolarAllocator.resolveAvailableW(
      config,
      energy,
      chargingAddBackW,
    );

    return { eligible, availableW };
  }
}
