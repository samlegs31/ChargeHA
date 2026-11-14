import { SolarAllocator } from "@chargeha/shared/engine";
import type { ControllerConfig } from "@chargeha/shared/engine";
import type { EnergyData, VehicleChargeState } from "@chargeha/shared";
import { commandMetrics, controllerMetrics } from "../../lib/RuntimeMetrics.ts";
import { externalChargingVehicles } from "../../services/ExternalCharging.ts";
import { publicProcedure, router } from "../trpc.ts";

function ageMs(timestamp: string | undefined, now: number): number | null {
  const value = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(value) && value <= now ? now - value : null;
}

export type EffectiveLimitCause =
  | "charging_disabled"
  | "battery_priority"
  | "command_debounce"
  | "grid_import_guard"
  | "electrical_limit"
  | "solar_ceiling"
  | "solar_surplus"
  | "vehicle_hardware_max";

interface EffectiveLimitSummary {
  effectiveLimitAmps: number;
  effectiveLimitKw: number;
  effectiveLimitCause: EffectiveLimitCause;
  effectiveLimitLabel: string;
}

function computeEffectiveLimit(params: {
  state: VehicleChargeState;
  charging: Awaited<
    ReturnType<
      import("../../services/ConfigService.ts").ConfigService["getCharging"]
    >
  >;
  solar: Awaited<
    ReturnType<
      import("../../services/ConfigService.ts").ConfigService["getSolar"]
    >
  >;
  battery: Awaited<
    ReturnType<
      import("../../services/ConfigService.ts").ConfigService["getBattery"]
    >
  >;
  energy: EnergyData | undefined;
  energyStale: boolean;
  decision:
    | {
      action: string;
      reason: string;
      detail: string;
      targetAmps: number | null;
      checksJson: string;
      observedAt?: string;
    }
    | undefined;
}): EffectiveLimitSummary {
  const { state, charging, solar, battery, energy, energyStale, decision } =
    params;
  const controllerCfg = {
    ...charging,
    ...solar,
    ...battery,
  } as unknown as ControllerConfig;
  const voltage = SolarAllocator.resolveVoltage(
    state,
    energy ?? null,
    controllerCfg,
  );
  const phases = SolarAllocator.resolvePhases(state, controllerCfg);
  const wattsPerAmp = Math.max(1, voltage * phases);
  const toKw = (amps: number) =>
    Math.round(((amps * wattsPerAmp) / 1000) * 10) / 10;
  const formatSummary = (
    amps: number,
    cause: EffectiveLimitCause,
    reasonText: string,
  ): EffectiveLimitSummary => {
    const kw = toKw(amps);
    return {
      effectiveLimitAmps: amps,
      effectiveLimitKw: kw,
      effectiveLimitCause: cause,
      effectiveLimitLabel: `${amps} A (${kw.toFixed(1)} kW) — ${reasonText}`,
    };
  };

  if (!charging.chargingEnabled) {
    return formatSummary(
      0,
      "charging_disabled",
      "Automatic charging disabled",
    );
  }

  const isScheduleOrBoost = decision?.reason === "schedule" ||
    decision?.reason === "charge_now";
  const batterySocBelowLimit = battery.batteryPriorityEnabled &&
    !isScheduleOrBoost &&
    energy !== undefined &&
    !energyStale &&
    energy.batterySoc !== null &&
    energy.batterySoc < battery.batteryPriorityLimit;
  const batteryDischarging = battery.batteryPriorityEnabled &&
    !isScheduleOrBoost &&
    energy !== undefined &&
    !energyStale &&
    energy.batteryPowerW !== null &&
    energy.batteryPowerW > battery.batteryDischargeToleranceW;

  if (
    decision?.reason === "battery_priority" ||
    batterySocBelowLimit ||
    batteryDischarging
  ) {
    return formatSummary(0, "battery_priority", "Home battery protection");
  }

  const hasDebounce = decision?.reason === "cooldown" ||
    Boolean(
      decision?.checksJson &&
        decision.checksJson.toLowerCase().includes("debounce"),
    );
  if (hasDebounce) {
    const debouncedAmps = decision?.targetAmps ??
      (state.isCharging ? state.chargeAmps : 0);
    return formatSummary(
      debouncedAmps,
      "command_debounce",
      decision?.reason === "cooldown"
        ? "Cooldown / command delay"
        : "Command debounce",
    );
  }

  const candidates: Array<{
    amps: number;
    cause: EffectiveLimitCause;
    text: string;
  }> = [
    {
      amps: typeof state.chargeAmpsMax === "number" &&
          Number.isFinite(state.chargeAmpsMax)
        ? state.chargeAmpsMax
        : 32,
      cause: "vehicle_hardware_max",
      text: `Vehicle maximum (${state.chargeAmpsMax ?? 32} A)`,
    },
  ];

  const electricalLimit = charging.vehicleCurrentLimits?.[state.vehicleId] ??
    null;
  if (electricalLimit !== null) {
    candidates.push({
      amps: electricalLimit,
      cause: "electrical_limit",
      text: `Vehicle electrical limit (${electricalLimit} A)`,
    });
  }

  if (
    charging.maxGridImportKw !== null &&
    state.isHome === true &&
    energy !== undefined &&
    !energyStale &&
    Number.isFinite(energy.gridPowerW)
  ) {
    const measuredPower = Math.max(
      0,
      Math.min(state.chargePowerKw * 1000, state.chargeAmps * wattsPerAmp),
    );
    const baselineW = state.isCharging && Number.isFinite(measuredPower)
      ? measuredPower
      : 0;
    const reclaimW = SolarAllocator.reclaimableBatteryChargeW(battery, energy);
    const availableGridW = Math.max(
      0,
      charging.maxGridImportKw * 1000 -
        energy.gridPowerW +
        baselineW +
        reclaimW,
    );
    const gridGuardAmps = Math.max(0, Math.floor(availableGridW / wattsPerAmp));
    candidates.push({
      amps: gridGuardAmps,
      cause: "grid_import_guard",
      text: `Grid import guard (${charging.maxGridImportKw} kW)`,
    });
  }

  if (!isScheduleOrBoost) {
    const solarCeiling =
      charging.vehicleSolarCurrentLimits?.[state.vehicleId] ?? null;
    if (solarCeiling !== null) {
      candidates.push({
        amps: solarCeiling,
        cause: "solar_ceiling",
        text: `Configured solar ceiling (${solarCeiling} A)`,
      });
    }
    if (energy !== undefined && !energyStale) {
      const availableSolarW = SolarAllocator.calculateAvailableSolar(
        {
          ...controllerCfg,
          solarTrackingEnabled: true,
          solarTrackingMode: "solar_only",
          solarReference: "excess",
        },
        energy,
        state,
        voltage,
        phases,
      );
      const rawSolarAmps = Math.max(
        0,
        Math.floor(availableSolarW / wattsPerAmp),
      );
      const usableSolarAmps = rawSolarAmps >= state.chargeAmpsMin
        ? rawSolarAmps
        : 0;
      candidates.push({
        amps: usableSolarAmps,
        cause: "solar_surplus",
        text: "Available solar surplus",
      });
    }
  }

  const winning = candidates.reduce((best, current) =>
    current.amps < best.amps ? current : best
  );
  return formatSummary(winning.amps, winning.cause, winning.text);
}

function tryOptionalSync<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

async function tryOptionalAsync<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export const healthRouter = router({
  // Protected by the HTTP auth middleware, like every non-auth tRPC procedure.
  // Reads cached states only: opening diagnostics must never wake a vehicle.
  regulation: publicProcedure.query(async ({ ctx }) => {
    const [states, config, solar, battery, external] = await Promise.all([
      ctx.vehicleManager.getAllStates(),
      ctx.configService.getCharging(),
      tryOptionalAsync(
        () => ctx.configService.getSolar(),
        {
          solarTrackingEnabled: true,
          solarTrackingMode: "solar_only" as const,
          solarReference: "excess" as const,
          solarSurplusMarginW: 200,
          solarDeficitToleranceW: 100,
          solarVoltageV: 230,
          solarPhases: 1,
        } as unknown as Awaited<ReturnType<typeof ctx.configService.getSolar>>,
      ),
      tryOptionalAsync(
        () => ctx.configService.getBattery(),
        {
          batteryPriorityEnabled: false,
          batteryPriorityLimit: 80,
          batteryDischargeToleranceW: 100,
          reclaimBatteryChargePower: false,
          batteryCapacityWh: null,
        } as unknown as Awaited<
          ReturnType<typeof ctx.configService.getBattery>
        >,
      ),
      externalChargingVehicles(ctx.db),
    ]);
    const now = Date.now();
    const energy = ctx.poller.tryGetRealtimeSnapshot()?.realtime;
    const energyAgeMs = ageMs(energy?.lastUpdated, now);
    const energyStale = energyAgeMs === null ||
      energyAgeMs > ctx.poller.getRealtimeMaxAgeMs();
    const decisions = ctx.eventEmitter.getRetained("controller_status");
    const totalCommandQueueDepth = tryOptionalSync(
      () =>
        typeof ctx.vehicleManager.getCommandQueueDepth === "function"
          ? ctx.vehicleManager.getCommandQueueDepth()
          : 0,
      0,
    );
    return {
      sampledAt: new Date(now).toISOString(),
      chargingEnabled: config.chargingEnabled,
      energyAgeMs,
      energyStale,
      gridPowerW: energy?.gridPowerW ?? null,
      commandQueueDepth: totalCommandQueueDepth,
      controller: controllerMetrics.snapshot(),
      commands: commandMetrics.snapshot(),
      vehicles: [...states.values()].map((state) => {
        const decision = external.has(state.vehicleId)
          ? undefined
          : decisions.find((value) => value.vehicleId === state.vehicleId);
        const effective = computeEffectiveLimit({
          state,
          charging: config,
          solar,
          battery,
          energy,
          energyStale,
          decision,
        });
        const commandQueueDepth = tryOptionalSync(
          () =>
            typeof ctx.vehicleManager.getCommandQueueDepth === "function"
              ? ctx.vehicleManager.getCommandQueueDepth(state.vehicleId)
              : 0,
          0,
        );
        const commandInFlight = tryOptionalSync(
          () =>
            typeof ctx.vehicleManager.isCommandInFlight === "function"
              ? ctx.vehicleManager.isCommandInFlight(state.vehicleId)
              : false,
          false,
        );
        return {
          id: state.vehicleId,
          name: state.vehicleName,
          external: external.has(state.vehicleId),
          telemetryAgeMs: ageMs(state.lastUpdated, now),
          actualAmps: state.chargeAmpsActual ?? null,
          requestedAmps: decision?.targetAmps ?? null,
          reportedSetpointAmps: state.chargeAmps,
          solarLimitAmps: config.vehicleSolarCurrentLimits?.[state.vehicleId] ??
            null,
          electricalLimitAmps: config.vehicleCurrentLimits?.[state.vehicleId] ??
            null,
          effectiveLimitAmps: effective.effectiveLimitAmps,
          effectiveLimitKw: effective.effectiveLimitKw,
          effectiveLimitCause: effective.effectiveLimitCause,
          effectiveLimitLabel: effective.effectiveLimitLabel,
          commandQueueDepth,
          commandInFlight,
          reason: decision?.reason ?? null,
          decisionAgeMs: ageMs(decision?.observedAt, now),
        };
      }),
    };
  }),
  // Check if ENCRYPTION_KEY is configured
  encryption: publicProcedure.query(({ ctx }) =>
    ctx.healthService.checkEncryption()
  ),

  // Collect user-facing warnings from all failed plugin health checks
  pluginWarnings: publicProcedure.query(({ ctx }) =>
    ctx.healthService.getPluginWarnings()
  ),
});
