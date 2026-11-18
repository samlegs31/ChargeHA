import type { EnergyData, VehicleChargeState } from "@chargeha/shared";
import {
  batteryConfigDef,
  chargingConfigDef,
  deserializeSection,
  solarConfigDef,
} from "@chargeha/shared/configSections";
import { SolarAllocator } from "@chargeha/shared/engine";
import type { ControllerConfig } from "@chargeha/shared/engine";
import type { AppDatabase } from "../db/AppDatabase.ts";

export interface GuardEnergy {
  energy: EnergyData | null;
  maxAgeMs: number;
}

/** Last check before any start/current command, including direct API commands. */
export class CommandPowerGuard {
  private energyReader: (() => GuardEnergy) | null = null;
  private sampleId: string | null = null;
  private reservations = new Map<
    string,
    { baselineW: number; extraW: number }
  >();

  constructor(private readonly db: Pick<AppDatabase, "getConfig">) {}

  setEnergyReader(reader: () => GuardEnergy): void {
    this.energyReader = reader;
  }

  async limit(
    state: VehicleChargeState,
    requested: number,
    options?: { allowUnavailableEnergy?: boolean },
  ): Promise<number> {
    const [raw, rawGrid] = await Promise.all([
      this.db.getConfig("vehicle_current_limits"),
      this.db.getConfig("max_grid_import_kw"),
    ]);
    const config = deserializeSection(chargingConfigDef, {
      vehicle_current_limits: raw,
      max_grid_import_kw: rawGrid,
    });
    const capped = Math.min(
      requested,
      state.chargeAmpsMax,
      config.vehicleCurrentLimits[state.vehicleId] ?? state.chargeAmpsMax,
    );
    if (!Number.isFinite(capped)) return 0;
    if (config.maxGridImportKw === null || state.isHome === false) {
      return capped;
    }
    if (state.isHome !== true) return 0;
    return this.gridLimit(
      state,
      capped,
      config.maxGridImportKw,
      options?.allowUnavailableEnergy === true,
    );
  }

  private async gridLimit(
    state: VehicleChargeState,
    requested: number,
    limitKw: number,
    allowUnavailableEnergy = false,
  ): Promise<number> {
    const snapshot = this.energyReader?.();
    const energy = snapshot?.energy;
    const age = energy ? Date.now() - Date.parse(energy.lastUpdated) : Infinity;
    if (
      !energy || energy.pollFailed || !Number.isFinite(age) || age < -5000 ||
      age > (snapshot?.maxAgeMs ?? 0) || !Number.isFinite(energy.gridPowerW)
    ) return allowUnavailableEnergy ? requested : 0;
    if (this.sampleId !== energy.lastUpdated) {
      this.sampleId = energy.lastUpdated;
      this.reservations.clear();
    }
    const [
      gridVoltage,
      threePhaseCharger,
      batteryPriorityEnabled,
      batteryPriorityLimit,
    ] = await Promise.all([
      this.db.getConfig("grid_voltage"),
      this.db.getConfig("three_phase_charger"),
      this.db.getConfig("battery_priority_enabled"),
      this.db.getConfig("battery_priority_limit"),
    ]);
    const solar = deserializeSection(solarConfigDef, {
      grid_voltage: gridVoltage,
      three_phase_charger: threePhaseCharger,
    });
    const electrical = solar as ControllerConfig;
    const wattsPerAmp =
      SolarAllocator.resolveVoltage(state, energy, electrical) *
      SolarAllocator.resolvePhases(state, electrical);
    if (!Number.isFinite(wattsPerAmp) || wattsPerAmp <= 0) return 0;
    const existing = this.reservations.get(state.vehicleId);
    const measuredPower = Math.max(
      0,
      Math.min(state.chargePowerKw * 1000, state.chargeAmps * wattsPerAmp),
    );
    const measuredW = state.isCharging && Number.isFinite(measuredPower)
      ? measuredPower
      : 0;
    const baselineW = existing?.baselineW ?? measuredW;
    const otherW = [...this.reservations].reduce(
      (sum, [id, r]) => sum + (id === state.vehicleId ? 0 : r.extraW),
      0,
    );
    const battery = deserializeSection(batteryConfigDef, {
      battery_priority_enabled: batteryPriorityEnabled,
      battery_priority_limit: batteryPriorityLimit,
    });
    const reclaimW = SolarAllocator.reclaimableBatteryChargeW(battery, energy);
    const availableW = Math.max(
      0,
      limitKw * 1000 - energy.gridPowerW - otherW + baselineW + reclaimW,
    );
    const allowed = Math.min(requested, Math.floor(availableW / wattsPerAmp));
    // Never spend a reduction again until a fresh meter reading confirms it.
    this.reservations.set(state.vehicleId, {
      baselineW,
      extraW: Math.max(
        existing?.extraW ?? 0,
        allowed * wattsPerAmp - baselineW,
        0,
      ),
    });
    return allowed;
  }
}
