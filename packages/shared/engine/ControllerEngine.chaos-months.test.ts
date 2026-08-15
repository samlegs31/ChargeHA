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

Deno.test({
  name: "ControllerEngine deterministic multi-month chaos with outages, stale data, recovery order, and restarts",
  fn: () => {
    const worlds = 32;
    const daysPerWorld = 180;
    const monthsPerWorld = 6;
    const stepMs = 5 * 60 * 1000;
    const stepsPerDay = 24 * 60 / 5;
    const baseTime = Date.parse("2026-01-05T00:00:00Z");
    const inverterMaxW = 6000;
    const allDays: EngineSchedule["days"] = [
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
      "sat",
      "sun",
    ];

    type ViolationBucket = { count: number; samples: string[] };
    type RuntimeVehicle = {
      id: string;
      name: string;
      priority: number;
      mode: VehicleMode;
      physical: VehicleChargeState;
      observed: VehicleChargeState | null;
    };
    type FroniusFailure = "stale" | "failed";

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

    const freshState = (
      id: string,
      name: string,
      batteryLevel: number,
    ): VehicleChargeState => ({
      vehicleId: id,
      batteryLevel,
      chargeLimit: 80,
      isCharging: false,
      isPluggedIn: true,
      isOnline: true,
      chargeAmps: 0,
      chargeAmpsMax: 16,
      chargeAmpsMin: 6,
      chargePowerKw: 0,
      chargerVoltage: 230,
      chargerPhases: 1,
      energyAddedKwh: 0,
      minutesToFull: 0,
      chargePortOpen: true,
      vehicleName: name,
      lastUpdated: new Date(baseTime).toISOString(),
      latitude: null,
      longitude: null,
      isHome: true,
    });

    const makeRuntimes = (): RuntimeVehicle[] => [
      {
        id: "V1",
        name: "EV A",
        priority: 1,
        mode: "auto",
        physical: freshState("V1", "EV A", 42),
        observed: freshState("V1", "EV A", 42),
      },
      {
        id: "V2",
        name: "EV B",
        priority: 2,
        mode: "vacation",
        physical: freshState("V2", "EV B", 61),
        observed: freshState("V2", "EV B", 61),
      },
    ];

    const schedule = (
      id: string,
      vehicleId: string | null,
      scheduleType: "charge" | "blockout",
      startTime: string,
      endTime: string,
      chargeAmps: number | null,
      chargeLimitPct: number | null = null,
    ): EngineSchedule => ({
      id,
      vehicleId,
      scheduleType,
      startTime,
      endTime,
      days: allDays,
      chargeAmps,
      chargeLimitPct,
      enabled: true,
    });

    const schedulesForVariant = (variant: number): EngineSchedule[] => {
      switch (variant % 5) {
        case 0:
          return [
            schedule("v1-night", "V1", "charge", "01:10", "06:40", 16, 85),
            schedule("global-block", null, "blockout", "15:30", "16:00", null),
          ];
        case 1:
          return [
            schedule("v1-day", "V1", "charge", "14:40", "17:10", 12, 85),
            schedule("global-block", null, "blockout", "15:30", "16:00", null),
          ];
        case 2:
          return [
            schedule("v1-overnight", "V1", "charge", "22:30", "05:30", 16, 90),
          ];
        case 3:
          return [
            schedule("v1-short", "V1", "charge", "11:50", "12:20", 10, 80),
            schedule("global-block", null, "blockout", "12:00", "12:10", null),
          ];
        default:
          return [
            schedule("global-block", null, "blockout", "03:00", "04:00", null),
          ];
      }
    };

    const config: ControllerConfig = makeConfig({
      chargingEnabled: true,
      controllerLoopSeconds: 10,
      timezone: "",
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
      priorityChargingEnabled: true,
      ampDebounceThreshold: 2,
      ampDebounceSettleMinutes: 3,
    });

    const baselineSolarW = (timestamp: number): number => {
      const now = new Date(timestamp);
      const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
      if (hour < 6 || hour >= 20) return 0;
      const phase = ((hour - 6) / 14) * Math.PI;
      return Math.max(0, Math.round(Math.sin(phase) * inverterMaxW));
    };

    const buildActualEnergy = (
      timestamp: number,
      runtimes: RuntimeVehicle[],
      cloudFactor: number,
      homeConsumptionW: number,
      batterySoc: number | null,
      batteryPowerW: number | null,
    ): EnergyData => {
      const solarProductionW = Math.min(
        inverterMaxW,
        Math.round(baselineSolarW(timestamp) * cloudFactor),
      );
      const chargingLoadW = runtimes.reduce((sum, runtime) => {
        const state = runtime.physical;
        if (!state.isCharging || !state.isPluggedIn || state.isHome === false) {
          return sum;
        }
        return sum + state.chargeAmps * state.chargerVoltage;
      }, 0);
      const batteryContributionW = batteryPowerW ?? 0;
      return makeEnergy({
        solarProductionW,
        gridPowerW: homeConsumptionW + chargingLoadW - solarProductionW -
          batteryContributionW,
        homeConsumptionW,
        batterySoc,
        batteryPowerW,
        gridVoltageV: 230,
        lastUpdated: new Date(timestamp).toISOString(),
      });
    };

    const engineVehicles = (runtimes: RuntimeVehicle[]): EngineVehicleInput[] =>
      runtimes.map((runtime) => ({
        id: runtime.id,
        name: runtime.name,
        priority: runtime.priority,
        mode: runtime.mode,
        state: runtime.observed ? { ...runtime.observed } : null,
      }));

    const isChargeScheduleActive = (
      runtime: RuntimeVehicle,
      schedules: EngineSchedule[],
      now: Date,
    ): boolean => runtime.mode === "auto" && schedules.some((candidate) =>
      candidate.scheduleType === "charge" && candidate.enabled &&
      (candidate.vehicleId === runtime.id || candidate.vehicleId === null) &&
      isScheduleActiveNow(candidate, now, config.timezone)
    );

    const evolvePhysical = (runtime: RuntimeVehicle): void => {
      const state = runtime.physical;
      let batteryLevel = state.batteryLevel;
      if (state.isCharging && state.isPluggedIn && state.isHome !== false) {
        const powerKw = state.chargeAmps * state.chargerVoltage / 1000;
        batteryLevel += powerKw * (stepMs / 3_600_000) / 60 * 100;
      } else if (state.isHome === false) {
        batteryLevel -= 0.08;
      }
      batteryLevel = Math.max(0, Math.min(100, batteryLevel));
      const reachedLimit = batteryLevel >= state.chargeLimit;
      runtime.physical = {
        ...state,
        batteryLevel,
        isCharging: reachedLimit ? false : state.isCharging,
        chargeAmps: reachedLimit ? 0 : state.chargeAmps,
        chargePowerKw: reachedLimit ? 0 : state.chargePowerKw,
      };
    };

    const copyFreshTelemetry = (
      runtime: RuntimeVehicle,
      timestamp: number,
    ): void => {
      runtime.observed = {
        ...runtime.physical,
        isOnline: true,
        lastUpdated: new Date(timestamp).toISOString(),
      };
    };

    const mutatePhysical = (runtime: RuntimeVehicle, rng: Rng): void => {
      const state = runtime.physical;
      switch (rng.int(8)) {
        case 0: {
          const plugged = !state.isPluggedIn;
          runtime.physical = {
            ...state,
            isPluggedIn: plugged,
            chargePortOpen: plugged,
            isCharging: plugged ? state.isCharging : false,
            chargeAmps: plugged ? state.chargeAmps : 0,
            chargePowerKw: plugged ? state.chargePowerKw : 0,
          };
          break;
        }
        case 1: {
          const home = state.isHome === false ? true : false;
          runtime.physical = {
            ...state,
            isHome: home,
            isPluggedIn: home ? state.isPluggedIn : false,
            isCharging: home ? state.isCharging : false,
            chargeAmps: home ? state.chargeAmps : 0,
            chargePowerKw: home ? state.chargePowerKw : 0,
          };
          break;
        }
        case 2:
          runtime.mode = rng.pick<VehicleMode>([
            "auto",
            "vacation",
            "charge_now",
            "stop",
          ]);
          break;
        case 3: {
          const chargeLimit = rng.pick([60, 70, 80, 90, 100]);
          runtime.physical = {
            ...state,
            chargeLimit,
            batteryLevel: rng.pick([
              20,
              50,
              Math.max(0, chargeLimit - 1),
              chargeLimit,
            ]),
          };
          break;
        }
        case 4:
          if (state.isPluggedIn && state.isHome !== false) {
            const amps = rng.pick([6, 8, 12, 16]);
            runtime.physical = {
              ...state,
              isCharging: true,
              chargeAmps: amps,
              chargePowerKw: amps * state.chargerVoltage / 1000,
            };
          }
          break;
        case 5:
          runtime.physical = {
            ...state,
            batteryLevel: Math.max(5, Math.min(99, state.batteryLevel + rng.pick([-10, -3, 3, 10]))),
          };
          break;
        case 6:
          runtime.physical = { ...state, isOnline: !state.isOnline };
          break;
        case 7:
          runtime.mode = runtime.mode === "stop" ? "auto" : runtime.mode;
          break;
      }
    };

    let virtualDays = 0;
    let decisionsChecked = 0;
    let randomEvents = 0;
    let froniusOutages = 0;
    let teslaOutages = 0;
    let fullNetworkOutages = 0;
    let serverRestarts = 0;
    let recoveryOrderTransitions = 0;
    let staleEnergyCycles = 0;
    let failedEnergyCycles = 0;
    let deferredCommands = 0;
    let staleTeslaCommandRaces = 0;
    let targetedRestartChecks = 0;
    let violationCount = 0;
    const violations = new Map<string, ViolationBucket>();

    const recordViolation = (category: string, message: string): void => {
      violationCount++;
      const bucket = violations.get(category) ?? { count: 0, samples: [] };
      bucket.count++;
      if (bucket.samples.length < 5) bucket.samples.push(message);
      violations.set(category, bucket);
    };

    const validateDecision = (
      runtime: RuntimeVehicle,
      decision: VehicleDecision | undefined,
      observedEnergy: EnergyData | null,
      actualEnergy: EnergyData,
      schedules: EngineSchedule[],
      now: Date,
      timestamp: number,
      context: string,
      teslaReachable: boolean,
    ): void => {
      if (!decision) {
        recordViolation("missingDecision", `${context} vehicle=${runtime.id}`);
        return;
      }
      decisionsChecked++;
      const observed = runtime.observed;
      const energising = decision.action === "start" ||
        decision.action === "adjust_amps";

      if (!observed) {
        if (energising || decision.reason !== "no_state") {
          recordViolation(
            "noState",
            `${context} vehicle=${runtime.id} action=${decision.action} reason=${decision.reason}`,
          );
        }
        return;
      }

      const nearFullGuard = observed.chargeLimit === 100 &&
        observed.batteryLevel >= 99 && !observed.isCharging;
      const hardBlock = !observed.isPluggedIn || observed.isHome === false ||
        observed.batteryLevel >= observed.chargeLimit || nearFullGuard ||
        runtime.mode === "stop";
      if (hardBlock && energising) {
        recordViolation(
          "hardBlock",
          `${context} vehicle=${runtime.id} action=${decision.action} reason=${decision.reason} plugged=${observed.isPluggedIn} home=${observed.isHome} soc=${observed.batteryLevel}/${observed.chargeLimit} mode=${runtime.mode}`,
        );
      }

      if (energising) {
        if (decision.targetAmps === null || !Number.isFinite(decision.targetAmps)) {
          recordViolation(
            "invalidTargetAmps",
            `${context} vehicle=${runtime.id} target=${decision.targetAmps}`,
          );
        } else if (
          decision.targetAmps < observed.chargeAmpsMin ||
          decision.targetAmps > observed.chargeAmpsMax
        ) {
          recordViolation(
            "ampBounds",
            `${context} vehicle=${runtime.id} target=${decision.targetAmps} range=${observed.chargeAmpsMin}-${observed.chargeAmpsMax}`,
          );
        }
      }

      const scheduleActive = isChargeScheduleActive(runtime, schedules, now);
      const solarManaged = runtime.mode === "vacation" ||
        (runtime.mode === "auto" && !scheduleActive);

      if (observedEnergy?.pollFailed && solarManaged && energising) {
        recordViolation(
          "failedFroniusEnergise",
          `${context} vehicle=${runtime.id} action=${decision.action} reason=${decision.reason}`,
        );
      }

      if (observedEnergy && solarManaged) {
        const energyAgeMs = timestamp - Date.parse(observedEnergy.lastUpdated);
        if (energyAgeMs > config.gracePeriodMinutes * 60 * 1000) {
          if (energising) {
            recordViolation(
              "staleFroniusEnergise",
              `${context} vehicle=${runtime.id} age=${Math.round(energyAgeMs / 1000)}s action=${decision.action} actualSolar=${actualEnergy.solarProductionW}W actualGrid=${actualEnergy.gridPowerW}W`,
            );
          }
          const actualSolarUnsafe = actualEnergy.solarProductionW <
              config.minSolarGenerationKw * 1000 ||
            actualEnergy.gridPowerW > 200;
          if (
            teslaReachable && runtime.physical.isCharging && actualSolarUnsafe &&
            decision.action !== "stop"
          ) {
            recordViolation(
              "staleFroniusContinuation",
              `${context} vehicle=${runtime.id} age=${Math.round(energyAgeMs / 1000)}s action=${decision.action} reason=${decision.reason} actualSolar=${actualEnergy.solarProductionW}W actualGrid=${actualEnergy.gridPowerW}W`,
            );
          }
        }
      }
    };

    const applyDecision = (
      runtime: RuntimeVehicle,
      decision: VehicleDecision | undefined,
      teslaReachable: boolean,
      timestamp: number,
    ): void => {
      if (!decision || decision.action === "none") return;
      if (!teslaReachable) {
        deferredCommands++;
        return;
      }

      const physical = runtime.physical;
      if (decision.action === "stop") {
        runtime.physical = {
          ...physical,
          isCharging: false,
          chargeAmps: 0,
          chargePowerKw: 0,
        };
        copyFreshTelemetry(runtime, timestamp);
        return;
      }

      const nearFullGuard = physical.chargeLimit === 100 &&
        physical.batteryLevel >= 99 && !physical.isCharging;
      const commandCanSucceed = physical.isPluggedIn && physical.isHome !== false &&
        physical.batteryLevel < physical.chargeLimit && !nearFullGuard;
      if (!commandCanSucceed) {
        staleTeslaCommandRaces++;
        return;
      }
      if (decision.targetAmps === null) return;
      const amps = Math.max(
        physical.chargeAmpsMin,
        Math.min(physical.chargeAmpsMax, Math.round(decision.targetAmps)),
      );
      runtime.physical = {
        ...physical,
        isCharging: true,
        chargeAmps: amps,
        chargePowerKw: amps * physical.chargerVoltage / 1000,
      };
      copyFreshTelemetry(runtime, timestamp);
    };

    for (let world = 0; world < worlds; world++) {
      const rng = new Rng(0x51a7e000 ^ (world + 1) * 0x9e3779b1);
      let engine = new ControllerEngine();
      const runtimes = makeRuntimes();
      let scheduleVariant = 0;
      let cloudFactor = 0.8;
      let homeConsumptionW = 900;
      let batterySoc: number | null = 55;
      let batteryPowerW: number | null = 0;
      let lastGoodEnergy: EnergyData | null = null;
      let teslaDownTicks = 0;
      let froniusDownTicks = 0;
      let froniusFailure: FroniusFailure = "stale";
      let restartColdEnergyTicks = 0;
      let previousTeslaReachable = true;
      let previousFroniusHealthy = true;

      const totalSteps = daysPerWorld * stepsPerDay;
      for (let step = 0; step < totalSteps; step++) {
        const timestamp = baseTime + world * daysPerWorld * 24 * 60 * 60 * 1000 +
          step * stepMs;
        const now = new Date(timestamp);

        if (step % stepsPerDay === 0) {
          virtualDays++;
          scheduleVariant = rng.int(5);
          cloudFactor = rng.pick([0.08, 0.2, 0.45, 0.7, 1]);
          homeConsumptionW = rng.pick([500, 800, 1200, 1800, 2500]);
          batterySoc = rng.pick([15, 19, 20, 21, 35, 55, 80]);
          batteryPowerW = rng.pick<number | null>([
            null,
            -1800,
            -600,
            0,
            300,
            301,
            900,
          ]);
        }

        for (const runtime of runtimes) evolvePhysical(runtime);

        if (rng.int(120) === 0) {
          mutatePhysical(runtimes[rng.int(runtimes.length)], rng);
          randomEvents++;
        }
        if (rng.int(500) === 0) {
          scheduleVariant = rng.int(5);
          randomEvents++;
        }
        if (rng.int(240) === 0) {
          cloudFactor = rng.pick([0.05, 0.15, 0.35, 0.6, 1]);
          randomEvents++;
        }
        if (rng.int(300) === 0) {
          batterySoc = rng.pick([15, 19, 20, 21, 50, 80]);
          batteryPowerW = rng.pick<number | null>([null, -1200, 0, 300, 301, 700]);
          randomEvents++;
        }

        if (teslaDownTicks === 0 && rng.int(240) === 0) {
          teslaDownTicks = 1 + rng.int(12);
          teslaOutages++;
          randomEvents++;
        }
        if (froniusDownTicks === 0 && rng.int(180) === 0) {
          froniusDownTicks = 1 + rng.int(12);
          froniusFailure = rng.pick<FroniusFailure>(["stale", "failed"]);
          froniusOutages++;
          randomEvents++;
        }
        if (rng.int(800) === 0) {
          teslaDownTicks = Math.max(teslaDownTicks, 1 + rng.int(12));
          froniusDownTicks = Math.max(froniusDownTicks, 1 + rng.int(12));
          froniusFailure = "stale";
          fullNetworkOutages++;
          randomEvents++;
        }
        if (rng.int(1000) === 0) {
          engine = new ControllerEngine();
          restartColdEnergyTicks = 1;
          serverRestarts++;
          randomEvents++;
        }

        const teslaReachable = teslaDownTicks === 0;
        const froniusHealthy = froniusDownTicks === 0;
        if (
          (teslaReachable !== previousTeslaReachable ||
            froniusHealthy !== previousFroniusHealthy) &&
          teslaReachable !== froniusHealthy
        ) {
          recoveryOrderTransitions++;
        }
        previousTeslaReachable = teslaReachable;
        previousFroniusHealthy = froniusHealthy;

        if (teslaReachable) {
          for (const runtime of runtimes) copyFreshTelemetry(runtime, timestamp);
        } else {
          for (const runtime of runtimes) {
            if (runtime.observed) {
              runtime.observed = { ...runtime.observed, isOnline: false };
            }
          }
        }

        const actualEnergy = buildActualEnergy(
          timestamp,
          runtimes,
          cloudFactor,
          homeConsumptionW,
          batterySoc,
          batteryPowerW,
        );

        let observedEnergy: EnergyData | null;
        if (restartColdEnergyTicks > 0) {
          observedEnergy = null;
          restartColdEnergyTicks--;
        } else if (froniusHealthy) {
          observedEnergy = { ...actualEnergy };
          lastGoodEnergy = { ...actualEnergy };
        } else if (froniusFailure === "failed") {
          failedEnergyCycles++;
          observedEnergy = makeEnergy({
            solarProductionW: 0,
            gridPowerW: 0,
            homeConsumptionW: 0,
            batteryPowerW: null,
            batterySoc: null,
            gridVoltageV: null,
            lastUpdated: new Date(timestamp).toISOString(),
            pollFailed: true,
            pollError: "chaos: Fronius poll failed",
          });
        } else {
          staleEnergyCycles++;
          observedEnergy = lastGoodEnergy ? { ...lastGoodEnergy } : null;
        }

        const schedules = schedulesForVariant(scheduleVariant);
        const output = engine.decide({
          config,
          vehicles: engineVehicles(runtimes),
          schedules,
          energy: observedEnergy,
          now,
          timestamp,
        });

        for (const runtime of runtimes) {
          const decision = output.decisions.get(runtime.id);
          const context = `world=${world} day=${Math.floor(step / stepsPerDay)} time=${now.toISOString()}`;
          validateDecision(
            runtime,
            decision,
            observedEnergy,
            actualEnergy,
            schedules,
            now,
            timestamp,
            teslaReachable,
            context,
          );
          applyDecision(runtime, decision, teslaReachable, timestamp);
        }

        if (teslaDownTicks > 0) teslaDownTicks--;
        if (froniusDownTicks > 0) froniusDownTicks--;
      }

      const decideOne = (
        probeEngine: ControllerEngine,
        state: VehicleChargeState,
        energy: EnergyData | null,
        timestamp: number,
        probeConfig: ControllerConfig = config,
      ): VehicleDecision => {
        const output = probeEngine.decide({
          config: probeConfig,
          vehicles: [makeVehicle({
            id: "P1",
            name: "Probe EV",
            mode: "vacation",
            state,
          })],
          schedules: [],
          energy,
          now: new Date(timestamp),
          timestamp,
        });
        const decision = output.decisions.get("P1");
        if (!decision) throw new Error("probe decision missing");
        return decision;
      };

      for (let month = 0; month < monthsPerWorld; month++) {
        const t0 = baseTime + world * daysPerWorld * 24 * 60 * 60 * 1000 +
          month * 30 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000;
        const charging = freshState("P1", "Probe EV", 50);
        charging.isCharging = true;
        charging.chargeAmps = 6;
        charging.chargeAmpsMin = 6;
        charging.chargeAmpsMax = 16;
        charging.chargePowerKw = 1.38;
        const lowSolar = makeEnergy({
          solarProductionW: 0,
          gridPowerW: 2200,
          homeConsumptionW: 820,
          batterySoc: 60,
          batteryPowerW: 0,
          gridVoltageV: 230,
          lastUpdated: new Date(t0).toISOString(),
        });
        const highSolar = makeEnergy({
          solarProductionW: 6000,
          gridPowerW: -3500,
          homeConsumptionW: 1000,
          batterySoc: 60,
          batteryPowerW: 0,
          gridVoltageV: 230,
          lastUpdated: new Date(t0).toISOString(),
        });

        let graceEngine = new ControllerEngine();
        decideOne(graceEngine, charging, lowSolar, t0);
        decideOne(graceEngine, charging, lowSolar, t0 + 359_000);
        const baselineGrace = decideOne(
          graceEngine,
          charging,
          lowSolar,
          t0 + 360_000,
        );
        targetedRestartChecks++;
        if (baselineGrace.action !== "stop") {
          recordViolation(
            "probeSetupGraceBoundary",
            `world=${world} month=${month} expected stop at 360s, got ${baselineGrace.action}/${baselineGrace.reason}`,
          );
        }

        graceEngine = new ControllerEngine();
        decideOne(graceEngine, charging, lowSolar, t0);
        decideOne(graceEngine, charging, lowSolar, t0 + 359_000);
        graceEngine = new ControllerEngine();
        const afterGraceRestart = decideOne(
          graceEngine,
          charging,
          lowSolar,
          t0 + 360_000,
        );
        targetedRestartChecks++;
        if (afterGraceRestart.action !== "stop") {
          recordViolation(
            "restartGracePersistence",
            `world=${world} month=${month} restart@359s -> ${afterGraceRestart.action}/${afterGraceRestart.reason} at 360s`,
          );
        }

        let cooldownEngine = new ControllerEngine();
        decideOne(cooldownEngine, charging, lowSolar, t0);
        const cooldownStop = decideOne(
          cooldownEngine,
          charging,
          lowSolar,
          t0 + 360_000,
        );
        const stopped = {
          ...charging,
          isCharging: false,
          chargeAmps: 0,
          chargePowerKw: 0,
        };
        const baselineCooldown = decideOne(
          cooldownEngine,
          stopped,
          highSolar,
          t0 + 361_000,
        );
        targetedRestartChecks++;
        if (
          cooldownStop.action !== "stop" ||
          baselineCooldown.action === "start" ||
          baselineCooldown.action === "adjust_amps"
        ) {
          recordViolation(
            "probeSetupCooldownBoundary",
            `world=${world} month=${month} stop=${cooldownStop.action} next=${baselineCooldown.action}/${baselineCooldown.reason}`,
          );
        }
        cooldownEngine = new ControllerEngine();
        const afterCooldownRestart = decideOne(
          cooldownEngine,
          stopped,
          highSolar,
          t0 + 361_000,
        );
        targetedRestartChecks++;
        if (
          afterCooldownRestart.action === "start" ||
          afterCooldownRestart.action === "adjust_amps"
        ) {
          recordViolation(
            "restartCooldownPersistence",
            `world=${world} month=${month} restart after stop -> ${afterCooldownRestart.action}/${afterCooldownRestart.reason} at +361s`,
          );
        }

        const batteryConfig = makeConfig({
          ...config,
          batteryPriorityEnabled: true,
          batteryPriorityLimit: 20,
          batteryDischargeToleranceW: 300,
          batteryDischargeGraceMinutes: 5,
        });
        const batteryDischarge = makeEnergy({
          solarProductionW: 5000,
          gridPowerW: -1500,
          homeConsumptionW: 1000,
          batterySoc: 60,
          batteryPowerW: 301,
          gridVoltageV: 230,
          lastUpdated: new Date(t0).toISOString(),
        });
        let batteryEngine = new ControllerEngine();
        decideOne(batteryEngine, charging, batteryDischarge, t0, batteryConfig);
        decideOne(
          batteryEngine,
          charging,
          batteryDischarge,
          t0 + 299_000,
          batteryConfig,
        );
        const baselineBattery = decideOne(
          batteryEngine,
          charging,
          batteryDischarge,
          t0 + 300_000,
          batteryConfig,
        );
        targetedRestartChecks++;
        if (baselineBattery.action !== "stop") {
          recordViolation(
            "probeSetupBatteryBoundary",
            `world=${world} month=${month} expected stop at 300s/301W, got ${baselineBattery.action}/${baselineBattery.reason}`,
          );
        }

        batteryEngine = new ControllerEngine();
        decideOne(batteryEngine, charging, batteryDischarge, t0, batteryConfig);
        decideOne(
          batteryEngine,
          charging,
          batteryDischarge,
          t0 + 299_000,
          batteryConfig,
        );
        batteryEngine = new ControllerEngine();
        const afterBatteryRestart = decideOne(
          batteryEngine,
          charging,
          batteryDischarge,
          t0 + 300_000,
          batteryConfig,
        );
        targetedRestartChecks++;
        if (afterBatteryRestart.action !== "stop") {
          recordViolation(
            "restartBatteryTimerPersistence",
            `world=${world} month=${month} restart@299s/301W -> ${afterBatteryRestart.action}/${afterBatteryRestart.reason} at 300s`,
          );
        }

        const failedEnergy = makeEnergy({
          solarProductionW: 0,
          gridPowerW: 0,
          homeConsumptionW: 0,
          batterySoc: null,
          batteryPowerW: null,
          gridVoltageV: null,
          lastUpdated: new Date(t0).toISOString(),
          pollFailed: true,
          pollError: "chaos forced outage",
        });
        let failedEngine = new ControllerEngine();
        decideOne(failedEngine, charging, failedEnergy, t0);
        const failedAtGrace = decideOne(
          failedEngine,
          charging,
          failedEnergy,
          t0 + 360_000,
        );
        targetedRestartChecks++;
        if (failedAtGrace.action !== "stop") {
          recordViolation(
            "froniusFailureGrace",
            `world=${world} month=${month} pollFailed at 360s -> ${failedAtGrace.action}/${failedAtGrace.reason}`,
          );
        }

        const staleHighSolar = {
          ...highSolar,
          lastUpdated: new Date(t0).toISOString(),
        };
        const staleEngine = new ControllerEngine();
        const staleDecision = decideOne(
          staleEngine,
          stopped,
          staleHighSolar,
          t0 + 361_000,
        );
        targetedRestartChecks++;
        if (
          staleDecision.action === "start" ||
          staleDecision.action === "adjust_amps"
        ) {
          recordViolation(
            "forcedStaleFroniusEnergise",
            `world=${world} month=${month} 361s-old 6kW sample -> ${staleDecision.action}/${staleDecision.reason}`,
          );
        }
      }
    }

    console.log(
      `chaos-months: ${worlds} worlds x ${monthsPerWorld} months = ${(worlds * monthsPerWorld).toLocaleString()} virtual months, ${virtualDays.toLocaleString()} virtual days, ${decisionsChecked.toLocaleString()} controller decisions, ${randomEvents.toLocaleString()} random chaos events, ${froniusOutages.toLocaleString()} Fronius outages, ${teslaOutages.toLocaleString()} Tesla outages, ${fullNetworkOutages.toLocaleString()} full-network outages, ${serverRestarts.toLocaleString()} server restarts, ${recoveryOrderTransitions.toLocaleString()} split recovery-order transitions, ${staleEnergyCycles.toLocaleString()} stale-energy cycles, ${failedEnergyCycles.toLocaleString()} failed-energy cycles, ${deferredCommands.toLocaleString()} deferred commands, ${staleTeslaCommandRaces.toLocaleString()} stale-Tesla command races, ${targetedRestartChecks.toLocaleString()} targeted restart/boundary checks, ${violationCount.toLocaleString()} violations`,
    );

    for (const [category, bucket] of violations.entries()) {
      console.log(`violation ${category}: ${bucket.count.toLocaleString()}`);
      for (const sample of bucket.samples) console.log(`  sample: ${sample}`);
    }

    assertEquals(virtualDays, worlds * daysPerWorld);
    assertEquals(violationCount, 0);
  },
});
