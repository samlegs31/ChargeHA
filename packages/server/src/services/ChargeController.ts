import { commandMetrics, controllerMetrics } from "../lib/RuntimeMetrics.ts";
import { externalChargingVehicles } from "./ExternalCharging.ts";
import {
  OSCILLATION_BY_VEHICLE_KEY,
  parseOscillationByVehicle,
} from "./Overseer.ts";
import {
  type ControllerAction,
  createTraceId,
  type EnergyData,
  type VehicleChargeState,
  type VehicleMode,
} from "@chargeha/shared";
import {
  ControllerEngine,
  DecisionChecks,
  isScheduleActiveNow,
  SolarAllocator,
} from "@chargeha/shared/engine";
import type {
  ControllerConfig,
  DecisionCheck,
  DecisionReason,
  EngineOutput,
  EngineVehicleInput,
  VehicleDecision,
} from "@chargeha/shared/engine";
import type { AppDatabase } from "../db/AppDatabase.ts";
import { toSqliteDatetime } from "../db/repositories/sqliteHelpers.ts";
import type {
  ControllerLogInput,
  ScheduleRow,
  SystemAlert,
  VehicleRow,
} from "../db/types.ts";
import type { CommandResult, VehicleManager } from "./VehicleManager.ts";
import type { EnergyPoller } from "./EnergyPoller.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { Logger } from "../lib/Logger.ts";

// Default loop interval (overridden by config)
const DEFAULT_LOOP_MS = 30_000;

// Prune old log entries every N loops
const PRUNE_EVERY_N_LOOPS = 100;

// Persist identical "none" decisions at most every 5 minutes per vehicle
const LOG_HEARTBEAT_MS = 5 * 60_000;

/** Structured inputs snapshot captured each decision cycle. */
export interface DecisionInputs {
  energy: {
    solarProductionW: number;
    gridPowerW: number;
    homeConsumptionW: number;
    batterySoc: number | null;
    batteryPowerW?: number | null;
  } | null;
  vehicleState: {
    isPluggedIn: boolean;
    isCharging: boolean;
    batteryLevel: number;
    chargeLimit: number;
    chargeAmps: number;
    chargeAmpsMin: number;
    chargeAmpsMax: number;
    chargePowerKw: number;
    latitude: number | null;
    longitude: number | null;
  } | null;
  config: ControllerConfig;
  activeSchedules: Array<{
    id: string;
    type: string;
    startTime: string;
    endTime: string;
  }>;
}

/** Decision log entry built per vehicle per loop iteration. */
interface DecisionLogEntry {
  vehicleId: string;
  vehicleName: string;
  mode: VehicleMode;
  inputs: DecisionInputs;
  checks: DecisionCheck[];
  action: ControllerAction;
  reason: DecisionReason;
  actionDetail: string;
  targetAmps: number | null;
  /** When true, polling can be suspended for this vehicle. */
  suspendable?: boolean;
  /** Set when an active charge schedule's target limit was reached. */
  scheduleLimitContext?: { scheduleLimitPct: number; batteryLevel: number };
}

interface EnergyAvailability {
  unavailable: boolean;
  detail: string;
}

export class ChargeController {
  private readonly vehicleManager: VehicleManager;
  private readonly poller: EnergyPoller;
  private readonly db: AppDatabase;
  private readonly configService: ConfigService;
  private readonly eventEmitter: TypedEventEmitter;
  private readonly logger: Logger;
  private readonly engine = new ControllerEngine();
  // Keep enforcing an unapproved start until STOP succeeds or charging is allowed.
  private readonly unapprovedStarts = new Set<string>();
  private readonly oscillationPausedVehicleIds = new Set<string>();
  private readonly lastPersistedLogs = new Map<
    string,
    { signature: string; persistedAt: number }
  >();
  private energyUnavailable = false;
  private energyRecoveryReadings = 0;
  private lastRecoveryReadingAt: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loopCount = 0;
  private stopped = true;
  private looping = false;
  private refreshPending = false;
  private lastLoopStartedAt = 0;
  private nextScheduledAt = 0;
  private unsubscribeUpdates: Array<() => void> = [];
  private inFlight: Promise<ControllerConfig> | null = null;

  constructor(
    vehicleManager: VehicleManager,
    poller: EnergyPoller,
    db: AppDatabase,
    configService: ConfigService,
    eventEmitter: TypedEventEmitter,
    logger: Logger,
  ) {
    this.vehicleManager = vehicleManager;
    this.poller = poller;
    this.db = db;
    this.configService = configService;
    this.eventEmitter = eventEmitter;
    this.logger = logger;
    this.vehicleManager.setPowerEnergyReader(() => ({
      energy: this.poller.tryGetRealtimeSnapshot()?.realtime ?? null,
      maxAgeMs: this.poller.getRealtimeMaxAgeMs(),
    }));
    this.start();
  }

  private start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.unsubscribeUpdates = [
      this.eventEmitter.subscribe(
        "energy_update",
        () => this.requestEarlyCycle(),
      ),
      this.eventEmitter.subscribe(
        "vehicle_plug_changed",
        () => this.requestEarlyCycle(),
      ),
      this.eventEmitter.subscribe(
        "vehicle_mode_changed",
        () => this.requestEarlyCycle(),
      ),
      this.eventEmitter.subscribe(
        "config_changed",
        () => this.requestEarlyCycle(),
      ),
    ];
    this.logger.info("Started");
    this.scheduleNext(DEFAULT_LOOP_MS);
  }

  stop(): void {
    this.stopped = true;
    this.refreshPending = false;
    this.unsubscribeUpdates.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeUpdates = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private requestEarlyCycle(): void {
    if (this.stopped) return;
    if (this.looping) {
      this.refreshPending = true;
      return;
    }
    this.scheduleNext(
      Math.min(
        5_000,
        Math.max(0, 5_000 - (Date.now() - this.lastLoopStartedAt)),
      ),
      true,
    );
  }

  private scheduleNext(delayMs: number, earlierOnly = false): void {
    if (this.stopped) return;
    const due = Date.now() + delayMs;
    if (earlierOnly && this.timer && this.nextScheduledAt <= due) return;
    this.nextScheduledAt = due;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      this.timer = null;
      await this.loop();
    }, delayMs);
  }

  /** Run a single iteration of the control loop without scheduling the next.
   *  Used by the simulator to step the controller one tick at a time.
   *  Returns the loaded config so the loop scheduler can read controllerLoopSeconds
   *  without a redundant DB round-trip. */
  runOnce(): Promise<ControllerConfig> {
    return this.inFlight ??= this.runMeasuredCycle();
  }

  private async runMeasuredCycle(): Promise<ControllerConfig> {
    const started = performance.now();
    let success = false;
    try {
      const config = await this.runCycle();
      success = true;
      return config;
    } finally {
      controllerMetrics.record(performance.now() - started, success);
      this.inFlight = null;
    }
  }

  private async runCycle(): Promise<ControllerConfig> {
    const traceId = createTraceId();
    const timestamp = Date.now();
    const config = await this.loadConfig();
    const external = await externalChargingVehicles(this.db);
    const vehicles = (await this.db.getVehicles()).filter((v) =>
      !external.has(v.id)
    );
    const schedules = await this.db.getSchedules();
    const energySnapshot = this.poller.tryGetRealtimeSnapshot();
    const now = new Date(timestamp);
    const energy = energySnapshot?.realtime ?? null;
    const energyAvailability = this.evaluateEnergyAvailability(
      energy,
      timestamp,
    );
    this.logLoop(vehicles.length, schedules.length, energy);

    // Compute context for middleware requests
    const hasSolar = !energyAvailability.unavailable && energy !== null &&
      energy.solarProductionW >= config.minSolarGenerationKw * 1000;
    // Request fresh state for each vehicle via middleware
    const engineVehicles: EngineVehicleInput[] = await Promise.all(
      vehicles.map(async (v) => {
        const applicable = schedules.filter((s) =>
          this.isScheduleApplicable(s, v.id, now, config.timezone)
        );
        const isSolarMode = v.mode === "auto" || v.mode === "vacation";
        const activeChargeSchedule = v.mode === "auto"
          ? applicable.find((s) => s.scheduleType === "charge")
          : undefined;
        const hasActiveBlockout = applicable.some(
          (s) => s.scheduleType === "blockout",
        );
        const hasApplicableBlockout = isSolarMode &&
          activeChargeSchedule === undefined && hasActiveBlockout;
        const cachedState = await this.vehicleManager.getState(v.id);
        const hasUsefulSolar = isSolarMode && hasSolar && energy !== null &&
          this.hasEnoughSolarToCharge(cachedState, energy, config);
        await this.vehicleManager.requestState(v.id, {
          origin: "controller",
          traceId,
          // Production alone is not a charging opportunity. Passing the broad
          // signal used to wake a sleeping Tesla hourly even when household
          // load consumed all available solar.
          hasSolar: hasUsefulSolar,
          hasDaylight: !energyAvailability.unavailable &&
            (energy?.solarProductionW ?? 0) > 0,
          hasSchedule: activeChargeSchedule !== undefined,
          hasBlockout: hasApplicableBlockout,
          isHome: cachedState?.isHome ?? null,
          scheduleChargeLimitPct: activeChargeSchedule?.chargeLimitPct ?? null,
        });
        const state = await this.vehicleManager.getState(v.id);
        return {
          id: v.id,
          name: v.name,
          mode: v.mode,
          priority: v.priority,
          state,
        };
      }),
    );

    const engineOutput = this.decideWithRuntimeProtection(
      config,
      schedules,
      engineVehicles,
      energy,
      now,
      timestamp,
      energyAvailability,
    );
    const output = this.applyVehicleAvailabilityStops(
      engineOutput,
      engineVehicles,
    );
    const scheduledVehicleIds = new Set(
      vehicles
        .filter((v) =>
          config.chargingEnabled &&
          output.decisions.get(v.id)?.reason === "schedule"
        )
        .map((v) => v.id),
    );
    for (const vehicleId of scheduledVehicleIds) {
      this.oscillationPausedVehicleIds.delete(vehicleId);
      this.unapprovedStarts.delete(vehicleId);
    }

    const logEntries: ControllerLogInput[] = await vehicles.reduce(
      async (prevPromise, vehicle) => {
        const acc = await prevPromise;
        const decision = output.decisions.get(vehicle.id);
        if (!decision) return acc;
        const logInput = await this.processVehicleDecision(
          vehicle,
          decision,
          output,
          config,
          schedules,
          energy,
          now,
          traceId,
        );
        return [...acc, logInput];
      },
      Promise.resolve([] as ControllerLogInput[]),
    );

    await this.finishLoop(logEntries, timestamp);
    await this.clearSafetyTripsForScheduledVehicles(
      scheduledVehicleIds,
      vehicles,
    );
    return config;
  }

  /** Clear persisted and in-memory safety-trip/oscillation flags and advance
   *  oscillation log cutoffs for vehicles under an active charge schedule so
   *  no residual safety lock can interrupt or survive the schedule window. */
  private async clearSafetyTripsForScheduledVehicles(
    scheduledIds: ReadonlySet<string>,
    vehicles: VehicleRow[],
  ): Promise<void> {
    if (scheduledIds.size === 0) return;

    const [
      oscillationPausedRaw,
      globalTripAt,
      systemAlertRaw,
      oscillationByVehicleRaw,
      recentStateChanges,
    ] = await Promise.all([
      this.db.getConfig("oscillation_paused"),
      this.db.getConfig("oscillation_trip_at"),
      this.db.getConfig("system_alert"),
      this.db.getPluginConfig(OSCILLATION_BY_VEHICLE_KEY),
      this.db.getRecentStateChanges(60),
    ]);

    const globalPaused = oscillationPausedRaw === "true";
    let alert: SystemAlert | null = null;
    if (systemAlertRaw) {
      try {
        alert = JSON.parse(systemAlertRaw) as SystemAlert;
      } catch {
        alert = null;
      }
    }

    const byVehicle = parseOscillationByVehicle(oscillationByVehicleRaw);
    const nowSqlite = toSqliteDatetime(new Date().toISOString());
    let byVehicleMutated = false;

    if (
      globalPaused &&
      Object.values(byVehicle).every((entry) => !entry.paused) &&
      alert?.vehicleId &&
      !scheduledIds.has(alert.vehicleId)
    ) {
      byVehicle[alert.vehicleId] = {
        paused: true,
        tripAt: globalTripAt ?? nowSqlite,
        vehicleName: alert.vehicleName ?? alert.vehicleId,
        alertMessage: alert.message,
      };
      byVehicleMutated = true;
    }

    let maxScheduledCutoff = "";
    for (const vehicleId of scheduledIds) {
      const existing = byVehicle[vehicleId];
      let latestRowTs = "";
      for (const row of recentStateChanges) {
        if (row.vehicleId === vehicleId && row.timestamp > latestRowTs) {
          latestRowTs = row.timestamp;
        }
      }

      const isPausedForVehicle = existing?.paused === true ||
        (globalPaused && (!alert?.vehicleId || alert.vehicleId === vehicleId));
      const hasUncappedRows = latestRowTs !== "" &&
        (!existing?.tripAt || latestRowTs > existing.tripAt);

      if (!isPausedForVehicle && !hasUncappedRows) continue;

      const cutoff = [nowSqlite, existing?.tripAt ?? "", latestRowTs].reduce(
        (max, value) => (value > max ? value : max),
        "",
      );
      const vehicleName = existing?.vehicleName ??
        vehicles.find((v) => v.id === vehicleId)?.name ?? vehicleId;
      byVehicle[vehicleId] = {
        ...(existing ?? {}),
        paused: false,
        tripAt: cutoff,
        vehicleName,
      };
      byVehicleMutated = true;
      if (cutoff > maxScheduledCutoff) {
        maxScheduledCutoff = cutoff;
      }
    }

    if (byVehicleMutated) {
      await this.db.setPluginConfig(
        OSCILLATION_BY_VEHICLE_KEY,
        JSON.stringify(byVehicle),
      );
    }

    const remainingPaused = Object.entries(byVehicle).filter(
      ([, entry]) => entry.paused,
    );

    if (remainingPaused.length === 0) {
      if (globalPaused) {
        const nextGlobalTripAt = [
          nowSqlite,
          globalTripAt ?? "",
          maxScheduledCutoff,
        ].reduce((max, value) => (value > max ? value : max), "");
        if (nextGlobalTripAt !== (globalTripAt ?? "")) {
          await this.db.setConfig("oscillation_trip_at", nextGlobalTripAt);
        }
        await this.db.setConfig("oscillation_paused", "false");
        if (systemAlertRaw) {
          await this.db.setConfig("system_alert", "");
        }
      } else if (
        maxScheduledCutoff !== "" &&
        maxScheduledCutoff > (globalTripAt ?? "")
      ) {
        // Overseer.syncByVehicleState(false) reconciles a single-entry map
        // against global oscillation_trip_at, so keep both in lockstep.
        await this.db.setConfig("oscillation_trip_at", maxScheduledCutoff);
      }
    } else if (
      byVehicleMutated && alert?.vehicleId && scheduledIds.has(alert.vehicleId)
    ) {
      const [nextVehicleId, nextEntry] = remainingPaused[0];
      await this.db.setConfig("oscillation_trip_at", nextEntry.tripAt);
      if (nextEntry.alertMessage) {
        const nextAlert: SystemAlert = {
          message: nextEntry.alertMessage,
          timestamp: new Date().toISOString(),
          vehicleId: nextVehicleId,
          vehicleName: nextEntry.vehicleName,
        };
        await this.db.setConfig("system_alert", JSON.stringify(nextAlert));
      } else if (systemAlertRaw) {
        await this.db.setConfig("system_alert", "");
      }
    }
  }

  /** A failed vehicle refresh must not leave an automatic charge running from
   *  an indefinitely stale snapshot. Explicit Charge Now remains authoritative. */
  private applyVehicleAvailabilityStops(
    output: EngineOutput,
    vehicles: EngineVehicleInput[],
  ): EngineOutput {
    const decisions = vehicles.reduce((acc, vehicle) => {
      const error = this.vehicleManager.getVehicleFetchError(vehicle.id);
      const automaticMode = vehicle.mode === "auto" ||
        vehicle.mode === "vacation";
      if (
        !error || !automaticMode
      ) return acc;

      const previous = output.decisions.get(vehicle.id);
      acc.set(vehicle.id, {
        action: vehicle.state?.isCharging ? "stop" : "none",
        reason: "vehicle_unavailable",
        detail: `${
          vehicle.state?.isCharging ? "Stop" : "Wait"
        } — vehicle state refresh failed: ${error.message}`,
        targetAmps: null,
        checks: previous?.checks ?? [],
      });
      return acc;
    }, new Map(output.decisions));
    return { ...output, decisions };
  }

  private logLoop(
    vehicles: number,
    schedules: number,
    energy: EnergyData | null,
  ): void {
    const solarW = energy && Math.round(energy.solarProductionW);
    const gridW = energy && Math.round(energy.gridPowerW);
    const summary = energy ? `solar=${solarW}W grid=${gridW}W` : "none";
    this.logger.debug(
      `Loop: ${vehicles} vehicles, ${schedules} schedules, energy=${summary}`,
    );
  }

  private async finishLoop(
    logEntries: ControllerLogInput[],
    timestamp = Date.now(),
  ): Promise<void> {
    const entriesToPersist = logEntries.filter((entry) =>
      this.shouldPersistLogEntry(entry, timestamp)
    );
    // Batch-insert log entries
    if (entriesToPersist.length > 0) {
      await this.db.insertControllerLogEntries(entriesToPersist);
    }

    // Periodic pruning
    this.loopCount++;
    if (this.loopCount % PRUNE_EVERY_N_LOOPS === 0) {
      const system = await this.configService.getSystem();
      await this.db.pruneControllerLogs(system.logRetentionDays);
    }
  }

  private shouldPersistLogEntry(
    entry: ControllerLogInput,
    timestamp: number,
  ): boolean {
    const signature = JSON.stringify([
      entry.mode,
      entry.action,
      entry.actionDetail,
      entry.targetAmps,
      entry.checksJson,
    ]);
    if (entry.action !== "none") {
      this.lastPersistedLogs.set(entry.vehicleId, {
        signature,
        persistedAt: timestamp,
      });
      return true;
    }
    const previous = this.lastPersistedLogs.get(entry.vehicleId);
    if (
      !previous ||
      previous.signature !== signature ||
      timestamp - previous.persistedAt >= LOG_HEARTBEAT_MS ||
      timestamp < previous.persistedAt
    ) {
      this.lastPersistedLogs.set(entry.vehicleId, {
        signature,
        persistedAt: timestamp,
      });
      return true;
    }
    return false;
  }

  /** Apply runtime safety overrides without changing persisted settings. */
  private decideWithRuntimeProtection(
    config: ControllerConfig,
    schedules: ScheduleRow[],
    vehicles: EngineVehicleInput[],
    energy: EnergyData | null,
    now: Date,
    timestamp: number,
    energyAvailability: EnergyAvailability,
  ): EngineOutput {
    const externalAmpChangeVehicleIds = new Set(
      vehicles.filter((vehicle) => this.hasExternalAmpChange(vehicle)).map(
        (vehicle) => vehicle.id,
      ),
    );
    // Scheduled charging intentionally permits grid use. Home-battery SOC
    // and discharge must not hide its schedule; the engine applies battery
    // protection again outside the window. Electrical and availability
    // safeguards remain enforced for every mode.
    const runtimeConfigOverrides = this.runtimeConfigOverridesByVehicle(
      externalAmpChangeVehicleIds,
    );

    for (const vehicle of vehicles) {
      const previous = this.engine.getControlState(vehicle.id).prevState;
      if (vehicle.state?.isCharging === false) {
        this.unapprovedStarts.delete(vehicle.id);
      } else if (
        vehicle.state?.isCharging === true &&
        (!previous?.isCharging || !previous.isPluggedIn)
      ) {
        this.unapprovedStarts.add(vehicle.id);
      }
      if (this.unapprovedStarts.has(vehicle.id)) {
        runtimeConfigOverrides.set(vehicle.id, {
          ...runtimeConfigOverrides.get(vehicle.id),
          gracePeriodMinutes: 0,
          batteryDischargeGraceMinutes: 0,
        });
      }
    }

    if (externalAmpChangeVehicleIds.size > 0) {
      this.logger.debug(
        `External/manual charge-current change detected for ${
          [...externalAmpChangeVehicleIds].join(", ")
        }; bypassing amp debounce only for affected vehicles`,
      );
    }
    const output = this.engine.decide({
      schedules,
      config,
      vehicles,
      energy,
      now,
      timestamp,
      energyUnavailable: energyAvailability.unavailable,
      energyUnavailableDetail: energyAvailability.detail,
      runtimeConfigOverrides,
    });
    for (const [id, decision] of output.decisions) {
      // A genuine solar allocation or active schedule authorizes the session.
      // A failed STOP must never earn a grace period on the next iteration.
      if (
        decision.targetAmps !== null && decision.action !== "stop" &&
        ["solar_tracking", "schedule", "charge_now", "vacation"].includes(
          decision.reason,
        )
      ) {
        this.unapprovedStarts.delete(id);
      }
    }
    return output;
  }

  private runtimeConfigOverridesByVehicle(
    externalAmpChangeVehicleIds: ReadonlySet<string>,
  ): Map<string, Partial<ControllerConfig>> {
    const overrides = new Map<string, Partial<ControllerConfig>>();
    const patch = (vehicleId: string, value: Partial<ControllerConfig>) => {
      overrides.set(vehicleId, { ...overrides.get(vehicleId), ...value });
    };
    externalAmpChangeVehicleIds.forEach((vehicleId) =>
      patch(vehicleId, { ampDebounceThreshold: 0 })
    );
    this.oscillationPausedVehicleIds.forEach((vehicleId) =>
      patch(vehicleId, { oscillationPaused: true })
    );
    return overrides;
  }

  private evaluateEnergyAvailability(
    energy: EnergyData | null,
    timestamp: number,
  ): EnergyAvailability {
    const unavailable = (detail: string): EnergyAvailability => {
      this.energyUnavailable = true;
      this.energyRecoveryReadings = 0;
      this.lastRecoveryReadingAt = null;
      return { unavailable: true, detail };
    };

    if (!energy) return unavailable("No live energy data");
    if (energy.pollFailed === true) {
      return unavailable("Energy inverter poll failed");
    }

    const required = [
      energy.solarProductionW,
      energy.gridPowerW,
      energy.homeConsumptionW,
    ];
    const optional = [
      energy.batteryPowerW,
      energy.batterySoc,
      energy.gridVoltageV,
    ];
    if (
      required.some((value) => !Number.isFinite(value)) ||
      optional.some((value) => value != null && !Number.isFinite(value))
    ) {
      return unavailable("Energy data contains non-finite measurements");
    }

    const observedAt = Date.parse(energy.lastUpdated);
    const maxAgeMs = this.poller.getRealtimeMaxAgeMs();
    if (!Number.isFinite(observedAt)) {
      return unavailable("Energy data timestamp is invalid");
    }
    const ageMs = timestamp - observedAt;
    if (ageMs > maxAgeMs || ageMs < -maxAgeMs) {
      return unavailable(
        `Energy data is stale (${Math.max(0, Math.round(ageMs / 1000))}s old)`,
      );
    }

    if (!this.energyUnavailable) {
      return { unavailable: false, detail: "Energy data available" };
    }

    if (this.lastRecoveryReadingAt !== energy.lastUpdated) {
      this.lastRecoveryReadingAt = energy.lastUpdated;
      this.energyRecoveryReadings++;
    }
    if (this.energyRecoveryReadings < 2) {
      return {
        unavailable: true,
        detail:
          `Energy data recovering (${this.energyRecoveryReadings}/2 valid readings)`,
      };
    }

    this.energyUnavailable = false;
    this.energyRecoveryReadings = 0;
    this.lastRecoveryReadingAt = null;
    return { unavailable: false, detail: "Energy data available" };
  }

  /** Detect a charge-current change that happened outside the controller.
   *  Controller commands update the cached post-state before prevState is
   *  stored, so a difference here represents a user/app/vehicle-side change. */
  private hasExternalAmpChange(vehicle: EngineVehicleInput): boolean {
    const state = vehicle.state;
    const previous = this.engine.getControlState(vehicle.id).prevState;
    return state?.isCharging === true && previous?.isCharging === true &&
      state.chargeAmps !== previous.chargeAmps;
  }

  /** Conservative pre-fetch check used only to decide whether waking a
   * sleeping vehicle is worthwhile. The engine still makes the authoritative
   * charging decision after state refresh. With no cache we allow one fetch to
   * establish the vehicle's electrical and location state. */
  private hasEnoughSolarToCharge(
    state: VehicleChargeState | null,
    energy: EnergyData,
    config: ControllerConfig,
  ): boolean {
    if (!state) return true;
    const voltage = SolarAllocator.resolveVoltage(state, energy, config);
    const phases = SolarAllocator.resolvePhases(state, config);
    const availableW = SolarAllocator.calculateAvailableSolar(
      config,
      energy,
      state,
      voltage,
      phases,
    );
    const minimumW = Math.max(
      state.chargeAmpsMin * voltage * phases,
      (config.minExcessSolarKw ?? 0) * 1000,
    );
    return availableW >= minimumW;
  }

  /** Execute a decision by issuing the appropriate adapter command. */
  private async executeDecision(
    vehicleId: string,
    decision: VehicleDecision,
    state: VehicleChargeState | null,
    traceId: string,
  ): Promise<CommandResult | null> {
    if (decision.action === "none") return null;
    if (!state) {
      return { success: false, error: "Vehicle state unavailable" };
    }

    const ctx = { origin: `controller:${decision.reason}`, traceId };
    switch (decision.action) {
      case "start":
      case "adjust_amps":
        if (decision.targetAmps !== null) {
          return await this.vehicleManager.startChargingAt(
            vehicleId,
            decision.targetAmps,
            ctx,
            state,
          );
        }
        return { success: false, error: "Missing target amperage" };
      case "stop":
        // Safety STOPs must bypass a backoff created by an earlier START or
        // SET failure. The stop command maintains its own failure reporting.
        return await this.vehicleManager.stopCharging(
          vehicleId,
          ctx,
          state,
          { force: true },
        );
    }
  }

  /** Execute a single vehicle's decision and produce its log entry.
   *  Handles: adapter commands, polling suspension, event emission,
   *  transition tracking. */
  private async processVehicleDecision(
    vehicle: VehicleRow,
    decision: VehicleDecision,
    output: EngineOutput,
    config: ControllerConfig,
    schedules: ScheduleRow[],
    energy: EnergyData | null,
    now: Date,
    traceId: string,
  ): Promise<ControllerLogInput> {
    const state = await this.vehicleManager.getState(vehicle.id);
    const preState = state;

    const commandStarted = performance.now();
    let commandResult: CommandResult | null = null;
    try {
      commandResult = await this.executeDecision(
        vehicle.id,
        decision,
        state,
        traceId,
      );
    } finally {
      if (decision.action !== "none") {
        commandMetrics.record(
          performance.now() - commandStarted,
          commandResult?.success === true,
        );
      }
    }
    const commandFailed = commandResult?.success === false;
    const commandFailureDetail = `Command not executed — ${
      commandResult?.error ?? "unknown error"
    }; ${decision.detail}`;
    const actionDetail = commandFailed ? commandFailureDetail : decision.detail;

    const inputs = this.buildInputsSnapshot(
      state,
      decision.reason === "schedule"
        ? { ...config, oscillationPaused: false }
        : this.oscillationPausedVehicleIds.has(vehicle.id)
        ? { ...config, oscillationPaused: true }
        : config,
      schedules,
      energy,
      now,
    );
    const checks = [...decision.checks];
    const cs = this.engine.getControlState(vehicle.id);

    // Add allocation check when multi-vehicle allocation is active
    if (cs.allocatedAmps !== null) {
      const mode = config.priorityChargingEnabled ? "waterfall" : "equal";
      const totalAmps = [...output.decisions.keys()]
        .map((id) => this.engine.getControlState(id).allocatedAmps ?? 0)
        .reduce((sum, a) => sum + a, 0);
      checks.push(DecisionChecks.solarAllocation(
        cs.allocatedAmps,
        totalAmps,
        mode,
        vehicle.priority,
      ));
    }

    const entry: DecisionLogEntry = {
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
      mode: vehicle.mode,
      inputs,
      checks,
      action: commandFailed ? "none" : decision.action,
      reason: decision.reason,
      actionDetail,
      targetAmps: decision.targetAmps,
      suspendable: decision.suspendable,
      scheduleLimitContext: decision.scheduleLimitContext,
    };

    this.emitControllerStatus(vehicle.id, entry);

    // Post-command state (may differ from preState after commands)
    const postState = await this.vehicleManager.getState(vehicle.id);

    if (!cs.initialized) {
      cs.initialized = true;
      cs.lastActiveScheduleIds = new Set(
        schedules
          .filter((s) =>
            this.isScheduleApplicable(s, vehicle.id, now, config.timezone)
          )
          .map((s) => s.id),
      );
    } else {
      this.emitControllerEvents(
        vehicle,
        preState,
        postState,
        entry,
        schedules,
        now,
        config.timezone,
        config.gracePeriodMinutes,
      );
    }
    cs.prevState = postState;

    return {
      vehicleId: entry.vehicleId,
      vehicleName: entry.vehicleName,
      mode: entry.mode,
      inputsJson: JSON.stringify(entry.inputs),
      checksJson: JSON.stringify(entry.checks),
      action: entry.action,
      actionDetail: entry.actionDetail,
      targetAmps: entry.targetAmps,
      traceId,
    };
  }

  private async loop(): Promise<void> {
    if (this.looping) {
      this.refreshPending = true;
      return;
    }
    this.looping = true;
    this.lastLoopStartedAt = Date.now();
    const nextIntervalMs = await this.runOnce()
      .then((config) => config.controllerLoopSeconds * 1000)
      .catch((error) => {
        this.logger.error("Loop error:", error);
        return DEFAULT_LOOP_MS;
      });

    this.looping = false;
    const refresh = this.refreshPending;
    this.refreshPending = false;
    if (refresh) this.requestEarlyCycle();
    else this.scheduleNext(nextIntervalMs);
  }

  /** Push the latest controller decision to the frontend via SSE. */
  private emitControllerStatus(
    vehicleId: string,
    entry: DecisionLogEntry,
  ): void {
    this.eventEmitter.emit("controller_status", {
      vehicleId,
      action: entry.action,
      reason: entry.reason,
      detail: entry.actionDetail,
      targetAmps: entry.targetAmps,
      checksJson: JSON.stringify(entry.checks),
      observedAt: new Date().toISOString(),
    }, vehicleId);
  }

  /** Detect state transitions and emit controller events.
   *  @param preState   — polled state at the start of this loop (before commands)
   *  @param postState  — state after commands (may differ from preState) */
  private emitControllerEvents(
    vehicle: VehicleRow,
    preState: VehicleChargeState | null,
    postState: VehicleChargeState | null,
    entry: DecisionLogEntry,
    schedules: ScheduleRow[],
    now: Date,
    timezone: string,
    gracePeriodMinutes: number,
  ): void {
    const controlState = this.engine.getControlState(vehicle.id);
    const prevState = controlState.prevState;

    const wasCharging = prevState?.isCharging ?? false;
    const isPolledCharging = preState?.isCharging ?? false;
    const isNowCharging = postState?.isCharging ?? false;

    // External charge: vehicle is charging but the engine actively wants to
    // stop it (no schedule, no solar, blockout, mode_stop, idle, etc.).
    // The engine encodes "should not charge while charging" as action=stop,
    // so trusting that signal avoids false positives when the engine is
    // happy with the existing charge (charge_now/adjust_amps/none).
    if (isPolledCharging && !wasCharging && entry.action === "stop") {
      this.eventEmitter.emit("controller_external_charge", {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
      });
    }

    // Controller started charging: not charging at start → charging after commands
    if (isNowCharging && !isPolledCharging && entry.action === "start") {
      this.eventEmitter.emit("controller_charge_started", {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        actionDetail: entry.actionDetail,
        reason: entry.reason,
      });
    }

    // Charging stopped: fire when controller decides stop OR battery just
    // reached its charge limit (vehicle may stop on its own at the limit).
    // Listener routes to "Charge Complete" message when reason is
    // battery_at_limit, "Charging Stopped" otherwise.
    const wasAtLimit = prevState
      ? prevState.batteryLevel >= prevState.chargeLimit
      : false;
    const nowAtLimit = preState
      ? preState.batteryLevel >= preState.chargeLimit
      : false;
    const justHitLimit = nowAtLimit && !wasAtLimit;
    if (entry.action === "stop" || justHitLimit) {
      this.eventEmitter.emit("controller_charge_stopped", {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        actionDetail: entry.actionDetail,
        reason: justHitLimit ? "battery_at_limit" : entry.reason,
        batteryLevel: preState?.batteryLevel,
        chargeLimit: preState?.chargeLimit,
        scheduleLimitContext: entry.scheduleLimitContext,
      });
    }

    // Low solar: grace period just started
    if (controlState.graceStartedAt !== null && !controlState.graceNotified) {
      controlState.graceNotified = true;
      this.eventEmitter.emit("controller_low_solar", {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        gracePeriodMinutes,
      });
    }

    // Schedule activation: new schedule IDs not active last cycle
    const activeScheduleIds = new Set<string>(
      schedules
        .filter((s) => this.isScheduleApplicable(s, vehicle.id, now, timezone))
        .map((s) => s.id),
    );
    const newlyActiveSchedules = [...activeScheduleIds]
      .filter((id) => !controlState.lastActiveScheduleIds.has(id))
      .map((id) => schedules.find((s) => s.id === id))
      .filter((s): s is ScheduleRow => s !== undefined);

    if (newlyActiveSchedules.length > 0) {
      newlyActiveSchedules.forEach((sched) => {
        this.eventEmitter.emit("controller_schedule_activated", {
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          scheduleType: sched.scheduleType,
          startTime: sched.startTime,
          endTime: sched.endTime,
          isPluggedIn: postState?.isPluggedIn ?? false,
          isHome: postState?.isHome ?? null,
        });
      });
    }
    controlState.lastActiveScheduleIds = activeScheduleIds;
  }

  private buildInputsSnapshot(
    state: VehicleChargeState | null,
    config: ControllerConfig,
    schedules: ScheduleRow[],
    energy: EnergyData | null,
    now: Date,
  ): DecisionLogEntry["inputs"] {
    const activeSchedules = schedules
      .filter((s) => s.enabled && isScheduleActiveNow(s, now, config.timezone))
      .map((s) => ({
        id: s.id,
        type: s.scheduleType,
        startTime: s.startTime,
        endTime: s.endTime,
      }));

    return {
      energy: this.mapEnergyInputs(energy),
      vehicleState: this.mapVehicleStateInputs(state),
      config,
      activeSchedules,
    };
  }

  private mapEnergyInputs(
    energy: EnergyData | null,
  ): DecisionLogEntry["inputs"]["energy"] {
    if (!energy) return null;
    return {
      solarProductionW: energy.solarProductionW,
      gridPowerW: energy.gridPowerW,
      homeConsumptionW: energy.homeConsumptionW,
      batterySoc: energy.batterySoc,
      batteryPowerW: energy.batteryPowerW,
    };
  }

  private mapVehicleStateInputs(
    state: VehicleChargeState | null,
  ): DecisionLogEntry["inputs"]["vehicleState"] {
    if (!state) return null;
    return {
      isPluggedIn: state.isPluggedIn,
      isCharging: state.isCharging,
      batteryLevel: state.batteryLevel,
      chargeLimit: state.chargeLimit,
      chargeAmps: state.chargeAmps,
      chargeAmpsMin: state.chargeAmpsMin,
      chargeAmpsMax: state.chargeAmpsMax,
      chargePowerKw: state.chargePowerKw,
      latitude: state.latitude,
      longitude: state.longitude,
    };
  }

  private isScheduleApplicable(
    s: ScheduleRow,
    vehicleId: string,
    now: Date,
    timezone: string,
  ): boolean {
    if (!s.enabled || !isScheduleActiveNow(s, now, timezone)) return false;
    return s.scheduleType === "blockout" || s.vehicleId === vehicleId ||
      s.vehicleId === null;
  }

  private isActiveBlockout(
    s: ScheduleRow,
    now: Date,
    timezone: string,
  ): boolean {
    return s.scheduleType === "blockout" && s.enabled &&
      isScheduleActiveNow(s, now, timezone);
  }

  private async loadConfig(): Promise<ControllerConfig> {
    const [
      charging,
      solar,
      battery,
      system,
      oscillationPaused,
      systemAlertRaw,
      oscillationByVehicleRaw,
    ] = await Promise.all([
      this.configService.getCharging(),
      this.configService.getSolar(),
      this.configService.getBattery(),
      this.configService.getSystem(),
      this.db.getConfig("oscillation_paused"),
      this.db.getConfig("system_alert"),
      this.db.getPluginConfig(OSCILLATION_BY_VEHICLE_KEY),
    ]);

    this.oscillationPausedVehicleIds.clear();
    if (oscillationPaused === "true") {
      const byVehicle = parseOscillationByVehicle(oscillationByVehicleRaw);
      for (const [vehicleId, state] of Object.entries(byVehicle)) {
        if (state.paused) this.oscillationPausedVehicleIds.add(vehicleId);
      }
      if (this.oscillationPausedVehicleIds.size === 0 && systemAlertRaw) {
        try {
          const alert = JSON.parse(systemAlertRaw) as { vehicleId?: string };
          if (alert.vehicleId) {
            this.oscillationPausedVehicleIds.add(alert.vehicleId);
          }
        } catch {
          // Ignore malformed alert payload
        }
      }
    }

    return {
      vehicleSolarCurrentLimits: charging.vehicleSolarCurrentLimits,
      vehicleCurrentLimits: charging.vehicleCurrentLimits,
      maxGridImportKw: charging.maxGridImportKw,
      chargingEnabled: charging.chargingEnabled,
      oscillationPaused: oscillationPaused === "true" &&
        this.oscillationPausedVehicleIds.size === 0,
      controllerLoopSeconds: system.controllerLoopSeconds,
      solarTrackingEnabled: solar.solarTrackingEnabled,
      solarTrackingMode: solar.solarTrackingMode,
      solarReference: solar.solarReference,
      solarMarginKw: solar.solarMarginKw,
      minSolarGenerationKw: solar.minSolarGenerationKw,
      minExcessSolarKw: solar.minExcessSolarKw,
      gridVoltage: solar.gridVoltage,
      threePhaseCharger: solar.threePhaseCharger,
      consumptionExcludesCharging: solar.consumptionExcludesCharging,
      gracePeriodMinutes: solar.gracePeriodMinutes,
      cooldownPeriodMinutes: solar.cooldownPeriodMinutes,
      ampDebounceThreshold: solar.ampDebounceThreshold,
      ampDebounceSettleMinutes: solar.ampDebounceSettleMinutes,
      batteryPriorityEnabled: battery.batteryPriorityEnabled,
      batteryPriorityLimit: battery.batteryPriorityLimit,
      batteryDischargeToleranceW: battery.batteryDischargeToleranceW,
      batteryDischargeGraceMinutes: battery.batteryDischargeGraceMinutes,
      priorityChargingEnabled: charging.priorityChargingEnabled,
      timezone: system.timezone,
    };
  }
}
