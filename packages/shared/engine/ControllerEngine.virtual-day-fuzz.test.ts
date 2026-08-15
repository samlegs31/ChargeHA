import { assertEquals } from "@std/assert";
import type {
  EnergyData,
  VehicleChargeState,
  VehicleMode,
} from "../types.ts";
import { ControllerEngine } from "./ControllerEngine.ts";
import { isScheduleActiveNow } from "./Schedules.ts";
import {
  makeConfig,
  makeEnergy,
  makeVehicle,
} from "./test-helpers/controller-engine.ts";
import type {
  ControllerConfig,
  EngineSchedule,
  EngineVehicleInput,
  VehicleDecision,
} from "./types.ts";

const WEEKS = 1024;
const DAYS_PER_WEEK = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_TIME = Date.parse("2026-01-05T00:00:00Z");
const ALL_DAYS: EngineSchedule["days"] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];
const CRITICAL_DELTAS_MS = [
  1_000,
  10_000,
  59_000,
  60_000,
  179_000,
  180_000,
  299_000,
  300_000,
  359_000,
  360_000,
  599_000,
  899_000,
  900_000,
] as const;

type ViolationBucket = { count: number; samples: string[] };
type RuntimeVehicle = {
  vehicle: EngineVehicleInput;
  scheduleProfile: number;
};
type Environment = {
  cloudFactor: number;
  solarOverrideW: number | null;
  homeConsumptionW: number;
  batterySoc: number | null;
  batteryPowerW: number | null;
};

class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  int(maxExclusive: number): number {
    return this.next() % maxExclusive;
  }

  pick<T>(values: readonly T[]): T {
    return values[this.int(values.length)];
  }
}

function freshState(
  id: string,
  name: string,
  batteryLevel = 50,
): VehicleChargeState {
  return {
    vehicleId: id,
    batteryLevel,
    chargeLimit: 80,
    isCharging: false,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 0,
    chargeAmpsMax: 32,
    chargeAmpsMin: 5,
    chargePowerKw: 0,
    chargerVoltage: 230,
    chargerPhases: 1,
    energyAddedKwh: 0,
    minutesToFull: 0,
    chargePortOpen: true,
    vehicleName: name,
    lastUpdated: "2026-01-05T00:00:00Z",
    latitude: null,
    longitude: null,
    isHome: true,
  };
}

function makeRuntimeVehicles(): RuntimeVehicle[] {
  return [
    {
      vehicle: makeVehicle({
        id: "V1",
        name: "EV A",
        priority: 1,
        mode: "auto",
        state: freshState("V1", "EV A", 45),
      }),
      scheduleProfile: 0,
    },
    {
      vehicle: makeVehicle({
        id: "V2",
        name: "EV B",
        priority: 2,
        mode: "auto",
        state: freshState("V2", "EV B", 60),
      }),
      scheduleProfile: 0,
    },
  ];
}

function schedule(
  id: string,
  vehicleId: string,
  scheduleType: "charge" | "blockout",
  startTime: string,
  endTime: string,
  chargeAmps: number | null,
  chargeLimitPct: number | null = null,
): EngineSchedule {
  return {
    id,
    vehicleId,
    scheduleType,
    startTime,
    endTime,
    days: ALL_DAYS,
    chargeAmps,
    chargeLimitPct,
    enabled: true,
  };
}

function schedulesFor(runtimes: RuntimeVehicle[]): EngineSchedule[] {
  const result: EngineSchedule[] = [];
  for (const runtime of runtimes) {
    const id = runtime.vehicle.id;
    switch (runtime.scheduleProfile) {
      case 1:
        result.push(schedule(`${id}-night`, id, "charge", "01:10", "06:40", 16));
        break;
      case 2:
        result.push(schedule(`${id}-day`, id, "charge", "14:40", "17:10", 12, 85));
        break;
      case 3:
        result.push(schedule(`${id}-block`, id, "blockout", "11:45", "12:15", null));
        break;
      case 4:
        result.push(
          schedule(`${id}-day`, id, "charge", "14:40", "17:10", 16),
          schedule(`${id}-overlap`, id, "blockout", "15:30", "16:00", null),
        );
        break;
      case 5:
        result.push(schedule(`${id}-overnight`, id, "charge", "22:30", "05:30", 20, 90));
        break;
    }
  }
  return result;
}

function formatMinutes(totalMinutes: number): string {
  const normalized = (totalMinutes + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function activeProbeSchedule(
  id: string,
  vehicleId: string,
  scheduleType: "charge" | "blockout",
  now: Date,
  chargeAmps: number | null,
): EngineSchedule {
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return schedule(
    id,
    vehicleId,
    scheduleType,
    formatMinutes(currentMinutes - 1),
    formatMinutes(currentMinutes + 2),
    chargeAmps,
  );
}

function evolveState(
  state: VehicleChargeState | null,
  deltaMs: number,
): VehicleChargeState | null {
  if (!state) return null;
  const hours = deltaMs / 3_600_000;
  let batteryLevel = state.batteryLevel;
  if (state.isCharging && state.isPluggedIn) {
    const powerKw = Math.max(0, state.chargeAmps * state.chargerVoltage) / 1000;
    batteryLevel += (powerKw * hours / 60) * 100;
  } else if (state.isHome === false) {
    batteryLevel -= 1.5 * hours;
  }
  return {
    ...state,
    batteryLevel: Math.max(0, Math.min(100, batteryLevel)),
  };
}

function mutateVehicle(runtime: RuntimeVehicle, rng: Rng): void {
  const vehicle = runtime.vehicle;
  if (!vehicle.state) {
    if (rng.int(3) === 0) {
      vehicle.state = freshState(vehicle.id, vehicle.name, rng.pick([20, 50, 79]));
    }
    return;
  }

  const state = vehicle.state;
  switch (rng.int(9)) {
    case 0:
      vehicle.state = { ...state, isHome: rng.pick([true, false, null]) };
      break;
    case 1: {
      const plugged = rng.int(4) !== 0;
      vehicle.state = {
        ...state,
        isPluggedIn: plugged,
        isOnline: plugged ? rng.int(3) !== 0 : false,
        isCharging: plugged ? state.isCharging : false,
        chargeAmps: plugged ? state.chargeAmps : 0,
      };
      break;
    }
    case 2: {
      const modes: VehicleMode[] = ["auto", "vacation", "charge_now", "stop"];
      vehicle.mode = rng.pick(modes);
      break;
    }
    case 3: {
      const chargeLimit = rng.pick([60, 70, 80, 90, 100]);
      const levels = [
        20,
        50,
        Math.max(0, chargeLimit - 1),
        chargeLimit,
        Math.min(100, chargeLimit + 1),
      ];
      vehicle.state = {
        ...state,
        chargeLimit,
        batteryLevel: rng.pick(levels),
      };
      break;
    }
    case 4: {
      const amps = rng.pick([5, 6, 16, 31, 32]);
      vehicle.state = {
        ...state,
        isPluggedIn: true,
        isHome: true,
        isOnline: true,
        isCharging: true,
        chargeAmps: amps,
      };
      break;
    }
    case 5:
      vehicle.state = { ...state, isOnline: !state.isOnline };
      break;
    case 6:
      vehicle.state = null;
      break;
    case 7:
      vehicle.state = {
        ...state,
        isPluggedIn: true,
        isHome: true,
        isOnline: false,
        isCharging: false,
        chargeAmps: 0,
      };
      break;
    case 8:
      vehicle.state = {
        ...state,
        isPluggedIn: true,
        isHome: true,
        isOnline: true,
      };
      break;
  }
}

function baselineSolarW(timestamp: number): number {
  const now = new Date(timestamp);
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
  if (hour < 6 || hour >= 20) return 0;
  const phase = ((hour - 6) / 14) * Math.PI;
  return Math.max(0, Math.round(Math.sin(phase) * 6000));
}

function buildEnergy(
  timestamp: number,
  runtimes: RuntimeVehicle[],
  environment: Environment,
): EnergyData {
  const solarProductionW = environment.solarOverrideW ??
    Math.round(baselineSolarW(timestamp) * environment.cloudFactor);
  const chargingLoadW = runtimes.reduce((sum, runtime) => {
    const state = runtime.vehicle.state;
    if (!state?.isCharging || !state.isPluggedIn) return sum;
    return sum + state.chargeAmps * state.chargerVoltage;
  }, 0);
  const batteryContributionW = environment.batteryPowerW === null
    ? 0
    : environment.batteryPowerW;
  const gridPowerW = environment.homeConsumptionW + chargingLoadW -
    solarProductionW - batteryContributionW;

  return makeEnergy({
    solarProductionW,
    gridPowerW,
    homeConsumptionW: environment.homeConsumptionW,
    batterySoc: environment.batterySoc,
    batteryPowerW: environment.batteryPowerW,
    gridVoltageV: 230,
    lastUpdated: new Date(timestamp).toISOString(),
  });
}

function applyDecisions(
  runtimes: RuntimeVehicle[],
  decisions: Map<string, VehicleDecision>,
): void {
  for (const runtime of runtimes) {
    const state = runtime.vehicle.state;
    const decision = decisions.get(runtime.vehicle.id);
    if (!state || !decision) continue;

    if (decision.action === "start" || decision.action === "adjust_amps") {
      if (decision.targetAmps !== null) {
        runtime.vehicle.state = {
          ...state,
          isCharging: true,
          chargeAmps: decision.targetAmps,
          chargePowerKw: decision.targetAmps * state.chargerVoltage / 1000,
        };
      }
    } else if (decision.action === "stop") {
      runtime.vehicle.state = {
        ...state,
        isCharging: false,
        chargeAmps: 0,
        chargePowerKw: 0,
      };
    }
  }
}

Deno.test({
  name: "ControllerEngine multi-day deterministic virtual-world fuzz",
  fn: () => {
    const config: ControllerConfig = makeConfig({
      chargingEnabled: true,
      timezone: "UTC",
      solarTrackingEnabled: true,
      solarTrackingMode: "solar_only",
      solarReference: "excess",
      minSolarGenerationKw: 1,
      gracePeriodMinutes: 6,
      cooldownPeriodMinutes: 15,
      batteryPriorityEnabled: true,
      batteryPriorityLimit: 20,
      batteryDischargeToleranceW: 300,
      batteryDischargeGraceMinutes: 5,
      ampDebounceThreshold: 2,
      ampDebounceSettleMinutes: 3,
    });

    let randomEvents = 0;
    let virtualDays = 0;
    let decisionsChecked = 0;
    let probeChecks = 0;
    let startDecisions = 0;
    let adjustDecisions = 0;
    let stopDecisions = 0;
    let violationCount = 0;
    const violations = new Map<string, ViolationBucket>();

    const recordViolation = (category: string, message: string) => {
      violationCount++;
      const bucket = violations.get(category) ?? { count: 0, samples: [] };
      bucket.count++;
      if (bucket.samples.length < 5) bucket.samples.push(message);
      violations.set(category, bucket);
    };

    const validateOutput = (
      runtimes: RuntimeVehicle[],
      schedules: EngineSchedule[],
      energy: EnergyData,
      now: Date,
      timestamp: number,
      output: ReturnType<ControllerEngine["decide"]>,
      context: string,
    ) => {
      for (const runtime of runtimes) {
        const vehicle = runtime.vehicle;
        const state = vehicle.state;
        const decision = output.decisions.get(vehicle.id);
        if (!decision) {
          recordViolation("missingDecision", `${context} vehicle=${vehicle.id}`);
          continue;
        }
        decisionsChecked++;
        if (decision.action === "start") startDecisions++;
        if (decision.action === "adjust_amps") adjustDecisions++;
        if (decision.action === "stop") stopDecisions++;

        const energising = decision.action === "start" ||
          decision.action === "adjust_amps";

        if (!state) {
          if (energising || decision.reason !== "no_state") {
            recordViolation(
              "noState",
              `${context} vehicle=${vehicle.id} action=${decision.action} reason=${decision.reason}`,
            );
          }
          continue;
        }

        const hardBlock = !state.isPluggedIn || state.isHome === false ||
          state.batteryLevel >= state.chargeLimit || vehicle.mode === "stop";
        if (hardBlock && energising) {
          recordViolation(
            "hardBlock",
            `${context} vehicle=${vehicle.id} action=${decision.action} reason=${decision.reason} plugged=${state.isPluggedIn} home=${state.isHome} soc=${state.batteryLevel.toFixed(2)}/${state.chargeLimit} mode=${vehicle.mode}`,
          );
        }

        if (energising) {
          if (decision.targetAmps === null) {
            recordViolation(
              "missingTargetAmps",
              `${context} vehicle=${vehicle.id} action=${decision.action}`,
            );
          } else if (
            !Number.isFinite(decision.targetAmps) ||
            decision.targetAmps < state.chargeAmpsMin ||
            decision.targetAmps > state.chargeAmpsMax
          ) {
            recordViolation(
              "ampBounds",
              `${context} vehicle=${vehicle.id} target=${decision.targetAmps} range=${state.chargeAmpsMin}..${state.chargeAmpsMax} reason=${decision.reason}`,
            );
          }
        }

        const activeBlockout = schedules.some((entry) =>
          entry.scheduleType === "blockout" && entry.enabled &&
          isScheduleActiveNow(entry, now, config.timezone)
        );
        if (
          activeBlockout &&
          (vehicle.mode === "auto" || vehicle.mode === "vacation") && energising
        ) {
          recordViolation(
            "blockout",
            `${context} vehicle=${vehicle.id} mode=${vehicle.mode} action=${decision.action} reason=${decision.reason}`,
          );
        }

        if (
          vehicle.mode === "vacation" && decision.reason === "schedule"
        ) {
          recordViolation(
            "vacationSchedule",
            `${context} vehicle=${vehicle.id} action=${decision.action}`,
          );
        }

        const activeCharge = schedules.some((entry) =>
          entry.scheduleType === "charge" && entry.enabled &&
          (entry.vehicleId === vehicle.id || entry.vehicleId === null) &&
          isScheduleActiveNow(entry, now, config.timezone)
        );
        const scheduleBypassesBattery = vehicle.mode === "auto" && activeCharge &&
          !activeBlockout;
        if (
          energy.batterySoc !== null && energy.batterySoc < 20 &&
          (vehicle.mode === "auto" || vehicle.mode === "vacation") &&
          !scheduleBypassesBattery && energising
        ) {
          recordViolation(
            "batteryReserve",
            `${context} vehicle=${vehicle.id} batterySoc=${energy.batterySoc} mode=${vehicle.mode} reason=${decision.reason}`,
          );
        }

        if (
          vehicle.mode === "charge_now" && state.isPluggedIn &&
          state.isHome !== false && state.batteryLevel < state.chargeLimit
        ) {
          if (decision.targetAmps !== state.chargeAmpsMax) {
            recordViolation(
              "chargeNowTarget",
              `${context} vehicle=${vehicle.id} target=${decision.targetAmps} expected=${state.chargeAmpsMax} action=${decision.action}`,
            );
          }
          if (!state.isCharging && decision.action !== "start") {
            recordViolation(
              "chargeNowStart",
              `${context} vehicle=${vehicle.id} action=${decision.action} reason=${decision.reason}`,
            );
          }
        }

        const controlState = output.controlStates.get(vehicle.id);
        if (controlState) {
          const starts = [
            ["graceStartedAt", controlState.graceStartedAt],
            ["batteryDischargeStartedAt", controlState.batteryDischargeStartedAt],
            ["pendingSince", controlState.pendingSince],
          ] as const;
          for (const [field, value] of starts) {
            if (value !== null && value > timestamp) {
              recordViolation(
                "futureRuntimeTimestamp",
                `${context} vehicle=${vehicle.id} ${field}=${value} now=${timestamp}`,
              );
            }
          }
          if (
            decision.reason === "cooldown" &&
            (controlState.cooldownUntil === null ||
              controlState.cooldownUntil <= timestamp)
          ) {
            recordViolation(
              "invalidCooldown",
              `${context} vehicle=${vehicle.id} cooldownUntil=${controlState.cooldownUntil} now=${timestamp}`,
            );
          }
        }
      }
    };

    const runDecision = (
      engine: ControllerEngine,
      runtimes: RuntimeVehicle[],
      schedules: EngineSchedule[],
      energy: EnergyData,
      timestamp: number,
      context: string,
    ) => {
      const now = new Date(timestamp);
      const output = engine.decide({
        config,
        vehicles: runtimes.map((runtime) => runtime.vehicle),
        schedules,
        energy,
        now,
        timestamp,
      });
      validateOutput(
        runtimes,
        schedules,
        energy,
        now,
        timestamp,
        output,
        context,
      );
      return output;
    };

    const expectForAll = (
      output: ReturnType<ControllerEngine["decide"]>,
      runtimes: RuntimeVehicle[],
      predicate: (decision: VehicleDecision, state: VehicleChargeState) => boolean,
      label: string,
      context: string,
    ) => {
      for (const runtime of runtimes) {
        const state = runtime.vehicle.state;
        const decision = output.decisions.get(runtime.vehicle.id);
        probeChecks++;
        if (!state || !decision || !predicate(decision, state)) {
          recordViolation(
            `probe:${label}`,
            `${context} vehicle=${runtime.vehicle.id} action=${decision?.action ?? "missing"} reason=${decision?.reason ?? "missing"} target=${decision?.targetAmps ?? "null"}`,
          );
        }
      }
    };

    const runCriticalProbe = (
      engine: ControllerEngine,
      runtimes: RuntimeVehicle[],
      startTimestamp: number,
      week: number,
      day: number,
    ): number => {
      let timestamp = startTimestamp;
      const contextBase = `probe week=${week} day=${day}`;
      for (const runtime of runtimes) {
        runtime.vehicle.mode = "auto";
        runtime.vehicle.state = freshState(runtime.vehicle.id, runtime.vehicle.name, 50);
      }

      const strongEnergy = () => makeEnergy({
        solarProductionW: 6000,
        gridPowerW: -5000,
        homeConsumptionW: 1000,
        batterySoc: 80,
        batteryPowerW: 0,
        gridVoltageV: 230,
        lastUpdated: new Date(timestamp).toISOString(),
      });
      const weakEnergy = () => makeEnergy({
        solarProductionW: 900,
        gridPowerW: 1000,
        homeConsumptionW: 1000,
        batterySoc: 80,
        batteryPowerW: 0,
        gridVoltageV: 230,
        lastUpdated: new Date(timestamp).toISOString(),
      });

      // Clear any old cooldown and prove the controller can recover from an
      // arbitrarily messy preceding day without stale runtime memory blocking it.
      timestamp += config.cooldownPeriodMinutes * 60_000 + 1;
      let output = runDecision(
        engine,
        runtimes,
        [],
        strongEnergy(),
        timestamp,
        `${contextBase} clean-restart`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) => decision.action === "start",
        "cleanRestart",
        contextBase,
      );
      applyDecisions(runtimes, output.decisions);

      // Grace boundary: 359 s must still ride through a cloud; exactly 360 s
      // must stop and arm the 15-minute cooldown.
      timestamp += 1_000;
      output = runDecision(
        engine,
        runtimes,
        [],
        weakEnergy(),
        timestamp,
        `${contextBase} grace-start`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) => decision.action !== "stop",
        "graceStart",
        contextBase,
      );
      applyDecisions(runtimes, output.decisions);

      timestamp += 359_000;
      output = runDecision(
        engine,
        runtimes,
        [],
        weakEnergy(),
        timestamp,
        `${contextBase} grace-359`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) => decision.action !== "stop",
        "grace359",
        contextBase,
      );
      applyDecisions(runtimes, output.decisions);

      timestamp += 1_000;
      output = runDecision(
        engine,
        runtimes,
        [],
        weakEnergy(),
        timestamp,
        `${contextBase} grace-360`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) =>
          decision.action === "stop" && decision.reason === "grace_period",
        "grace360",
        contextBase,
      );
      applyDecisions(runtimes, output.decisions);
      const cooldownStartedAt = timestamp;

      timestamp += 1_000;
      output = runDecision(
        engine,
        runtimes,
        [],
        strongEnergy(),
        timestamp,
        `${contextBase} cooldown-immediate`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) => decision.action === "none" && decision.reason === "cooldown",
        "cooldownImmediate",
        contextBase,
      );

      timestamp = cooldownStartedAt + 899_000;
      output = runDecision(
        engine,
        runtimes,
        [],
        strongEnergy(),
        timestamp,
        `${contextBase} cooldown-899`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) => decision.action === "none" && decision.reason === "cooldown",
        "cooldown899",
        contextBase,
      );

      timestamp = cooldownStartedAt + 900_000;
      output = runDecision(
        engine,
        runtimes,
        [],
        strongEnergy(),
        timestamp,
        `${contextBase} cooldown-900`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) => decision.action === "start",
        "cooldown900",
        contextBase,
      );
      applyDecisions(runtimes, output.decisions);

      // Home-battery discharge boundary: 301 W is excessive, 299 s remains
      // inside grace, exactly 300 s stops. Exactly 300 W is tolerated.
      timestamp += 1_000;
      const dischargeEnergy = () => makeEnergy({
        solarProductionW: 6000,
        gridPowerW: -5000,
        homeConsumptionW: 1000,
        batterySoc: 80,
        batteryPowerW: 301,
        gridVoltageV: 230,
        lastUpdated: new Date(timestamp).toISOString(),
      });
      output = runDecision(
        engine,
        runtimes,
        [],
        dischargeEnergy(),
        timestamp,
        `${contextBase} battery-grace-start`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) => decision.action !== "stop",
        "batteryGraceStart",
        contextBase,
      );
      applyDecisions(runtimes, output.decisions);
      const batteryGraceStartedAt = timestamp;

      timestamp = batteryGraceStartedAt + 299_000;
      output = runDecision(
        engine,
        runtimes,
        [],
        dischargeEnergy(),
        timestamp,
        `${contextBase} battery-299`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) => decision.action !== "stop",
        "battery299",
        contextBase,
      );
      applyDecisions(runtimes, output.decisions);

      timestamp = batteryGraceStartedAt + 300_000;
      output = runDecision(
        engine,
        runtimes,
        [],
        dischargeEnergy(),
        timestamp,
        `${contextBase} battery-300`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) =>
          decision.action === "stop" && decision.reason === "battery_priority",
        "battery300",
        contextBase,
      );
      applyDecisions(runtimes, output.decisions);

      timestamp += 1_000;
      const toleranceEnergy = makeEnergy({
        solarProductionW: 6000,
        gridPowerW: -5000,
        homeConsumptionW: 1000,
        batterySoc: 80,
        batteryPowerW: 300,
        gridVoltageV: 230,
        lastUpdated: new Date(timestamp).toISOString(),
      });
      output = runDecision(
        engine,
        runtimes,
        [],
        toleranceEnergy,
        timestamp,
        `${contextBase} battery-tolerance`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) => decision.action === "start",
        "batteryTolerance",
        contextBase,
      );
      applyDecisions(runtimes, output.decisions);

      // A charge schedule is authoritative over home-battery reserve in Auto.
      // Removing that schedule must immediately restore reserve protection.
      for (const runtime of runtimes) {
        runtime.vehicle.mode = "auto";
        runtime.vehicle.state = {
          ...freshState(runtime.vehicle.id, runtime.vehicle.name, 50),
          isCharging: false,
          chargeAmps: 0,
        };
      }
      timestamp += 1_000;
      const now = new Date(timestamp);
      const activeChargeSchedules = runtimes.map((runtime) =>
        activeProbeSchedule(
          `${runtime.vehicle.id}-probe-charge`,
          runtime.vehicle.id,
          "charge",
          now,
          16,
        )
      );
      const lowBatteryEnergy = makeEnergy({
        solarProductionW: 6000,
        gridPowerW: -5000,
        homeConsumptionW: 1000,
        batterySoc: 19,
        batteryPowerW: 0,
        gridVoltageV: 230,
        lastUpdated: now.toISOString(),
      });
      output = runDecision(
        engine,
        runtimes,
        activeChargeSchedules,
        lowBatteryEnergy,
        timestamp,
        `${contextBase} schedule-bypass`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) => decision.action === "start" && decision.reason === "schedule",
        "scheduleBypass",
        contextBase,
      );
      applyDecisions(runtimes, output.decisions);

      timestamp += 1_000;
      output = runDecision(
        engine,
        runtimes,
        [],
        lowBatteryEnergy,
        timestamp,
        `${contextBase} schedule-ended`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) =>
          decision.action === "stop" && decision.reason === "battery_priority",
        "scheduleEnded",
        contextBase,
      );
      applyDecisions(runtimes, output.decisions);

      // Blockout wins over normal Auto schedules, but explicit CHARGE NOW wins
      // over blockout. An unplug immediately afterwards must hard-block output.
      for (const runtime of runtimes) {
        runtime.vehicle.mode = "auto";
        runtime.vehicle.state = freshState(runtime.vehicle.id, runtime.vehicle.name, 50);
      }
      timestamp += 1_000;
      const overlapNow = new Date(timestamp);
      const overlapSchedules = runtimes.flatMap((runtime) => [
        activeProbeSchedule(
          `${runtime.vehicle.id}-probe-charge-overlap`,
          runtime.vehicle.id,
          "charge",
          overlapNow,
          16,
        ),
        activeProbeSchedule(
          `${runtime.vehicle.id}-probe-blockout`,
          runtime.vehicle.id,
          "blockout",
          overlapNow,
          null,
        ),
      ]);
      output = runDecision(
        engine,
        runtimes,
        overlapSchedules,
        strongEnergy(),
        timestamp,
        `${contextBase} blockout-overlap`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) => decision.action === "none" && decision.reason === "blockout",
        "blockoutOverlap",
        contextBase,
      );

      for (const runtime of runtimes) runtime.vehicle.mode = "charge_now";
      timestamp += 1_000;
      output = runDecision(
        engine,
        runtimes,
        overlapSchedules,
        strongEnergy(),
        timestamp,
        `${contextBase} charge-now-overlap`,
      );
      expectForAll(
        output,
        runtimes,
        (decision, state) =>
          decision.action === "start" && decision.reason === "charge_now" &&
          decision.targetAmps === state.chargeAmpsMax,
        "chargeNowOverlap",
        contextBase,
      );
      applyDecisions(runtimes, output.decisions);

      for (const runtime of runtimes) {
        const state = runtime.vehicle.state!;
        runtime.vehicle.mode = "auto";
        runtime.vehicle.state = {
          ...state,
          isPluggedIn: false,
          isCharging: false,
          chargeAmps: 0,
        };
      }
      timestamp += 1_000;
      output = runDecision(
        engine,
        runtimes,
        [],
        strongEnergy(),
        timestamp,
        `${contextBase} unplugged`,
      );
      expectForAll(
        output,
        runtimes,
        (decision) =>
          decision.action === "none" && decision.reason === "not_plugged_in",
        "unplugged",
        contextBase,
      );

      return timestamp;
    };

    for (let week = 0; week < WEEKS; week++) {
      const engine = new ControllerEngine();
      const runtimes = makeRuntimeVehicles();
      const rng = new Rng((0x9e3779b9 ^ Math.imul(week + 1, 0x85ebca6b)) >>> 0);
      let timestamp = BASE_TIME + week * 31 * DAY_MS;
      const environment: Environment = {
        cloudFactor: 1,
        solarOverrideW: null,
        homeConsumptionW: 1200,
        batterySoc: 80,
        batteryPowerW: 0,
      };

      for (let day = 0; day < DAYS_PER_WEEK; day++) {
        virtualDays++;
        const dayEnd = timestamp + DAY_MS;
        let eventsThisDay = 0;

        while (timestamp < dayEnd && eventsThisDay < 1000) {
          const deltaMs = rng.pick(CRITICAL_DELTAS_MS);
          timestamp = Math.min(dayEnd, timestamp + deltaMs);
          eventsThisDay++;
          randomEvents++;

          for (const runtime of runtimes) {
            runtime.vehicle.state = evolveState(runtime.vehicle.state, deltaMs);
          }

          const eventKind = rng.int(12);
          const selected = runtimes[rng.int(runtimes.length)];
          if (eventKind <= 5) {
            mutateVehicle(selected, rng);
            if (rng.int(4) === 0) {
              mutateVehicle(runtimes[(runtimes.indexOf(selected) + 1) % runtimes.length], rng);
            }
          } else if (eventKind === 6) {
            selected.scheduleProfile = rng.int(6);
          } else if (eventKind === 7) {
            environment.cloudFactor = rng.pick([0, 0.1, 0.25, 0.5, 0.8, 1]);
            environment.solarOverrideW = rng.pick([
              null,
              0,
              1,
              899,
              999,
              1000,
              1149,
              1150,
              2349,
              2350,
              3000,
              6000,
            ]);
          } else if (eventKind === 8) {
            environment.batterySoc = rng.pick([null, 19, 20, 21, 50, 79, 80, 100]);
            environment.batteryPowerW = rng.pick([
              null,
              -1000,
              0,
              299,
              300,
              301,
              1000,
            ]);
          } else if (eventKind === 9) {
            environment.homeConsumptionW = rng.pick([500, 800, 1200, 1800, 2500, 3500]);
          } else if (eventKind === 10) {
            selected.vehicle.mode = rng.pick<VehicleMode>([
              "auto",
              "vacation",
              "charge_now",
              "stop",
            ]);
          }

          const schedules = schedulesFor(runtimes);
          const energy = buildEnergy(timestamp, runtimes, environment);
          const output = runDecision(
            engine,
            runtimes,
            schedules,
            energy,
            timestamp,
            `random week=${week} day=${day} event=${eventsThisDay}`,
          );
          applyDecisions(runtimes, output.decisions);
        }

        if (eventsThisDay < 100) {
          recordViolation(
            "insufficientDailyEvents",
            `week=${week} day=${day} events=${eventsThisDay}`,
          );
        }

        timestamp = runCriticalProbe(engine, runtimes, timestamp, week, day);
      }
    }

    console.log(
      `virtual-world fuzz: ${virtualDays.toLocaleString()} virtual days, ${randomEvents.toLocaleString()} random event cycles, ${decisionsChecked.toLocaleString()} controller decisions, ${probeChecks.toLocaleString()} boundary probe checks, ${startDecisions.toLocaleString()} starts, ${adjustDecisions.toLocaleString()} adjustments, ${stopDecisions.toLocaleString()} stops, ${violationCount.toLocaleString()} violations`,
    );

    for (const [category, bucket] of violations.entries()) {
      console.log(`violation ${category}: ${bucket.count.toLocaleString()}`);
      for (const sample of bucket.samples) console.log(`  sample: ${sample}`);
    }

    assertEquals(virtualDays, WEEKS * DAYS_PER_WEEK);
    assertEquals(violationCount, 0);
  },
});
