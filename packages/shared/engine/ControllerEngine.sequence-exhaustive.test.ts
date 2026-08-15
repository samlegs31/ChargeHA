import { assertEquals } from "@std/assert";
import type { VehicleMode } from "../types.ts";
import { ControllerEngine } from "./ControllerEngine.ts";
import { makeInput } from "./test-helpers/controller-engine.ts";
import type { EngineSchedule } from "./types.ts";

const RADIX = 4;
const STAGES = 10;
const SEQUENCES = RADIX ** STAGES; // 1,048,576 complete stateful paths
const BASE_TIME = Date.parse("2026-01-01T12:00:00Z");

type ViolationBucket = { count: number; samples: string[] };

function activeSchedule(
  scheduleType: "charge" | "blockout",
): EngineSchedule {
  return {
    id: `${scheduleType}-sequence`,
    vehicleId: "V1",
    scheduleType,
    startTime: "00:00",
    endTime: "23:59",
    days: ["thu"],
    chargeAmps: scheduleType === "charge" ? 16 : null,
    chargeLimitPct: null,
    enabled: true,
  };
}

function schedulesFor(choice: number): EngineSchedule[] {
  if (choice === 1) return [activeSchedule("charge")];
  if (choice === 2) return [activeSchedule("blockout")];
  if (choice === 3) {
    return [activeSchedule("charge"), activeSchedule("blockout")];
  }
  return [];
}

function digit(path: number, stage: number): number {
  return Math.floor(path / (RADIX ** stage)) % RADIX;
}

Deno.test({
  name: "ControllerEngine exhaustive stateful event sequences",
  fn: () => {
    let decisionsChecked = 0;
    let energisingDecisions = 0;
    let stopDecisions = 0;
    let violationCount = 0;
    const violations = new Map<string, ViolationBucket>();

    const recordViolation = (category: string, message: string) => {
      violationCount++;
      const bucket = violations.get(category) ?? { count: 0, samples: [] };
      bucket.count++;
      if (bucket.samples.length < 3) bucket.samples.push(message);
      violations.set(category, bucket);
    };

    for (let path = 0; path < SEQUENCES; path++) {
      const choices = Array.from(
        { length: STAGES },
        (_, stage) => digit(path, stage),
      );
      const engine = new ControllerEngine();

      let elapsedMs = 0;
      let mode: VehicleMode = "auto";
      let schedules: EngineSchedule[] = [];
      let state = {
        isPluggedIn: false,
        isHome: false as boolean | null,
        isOnline: true,
        isCharging: false,
        batteryLevel: 50,
        chargeLimit: 80,
        chargeAmps: 0,
        chargeAmpsMin: 5,
        chargeAmpsMax: 32,
      };
      let energy = {
        solarProductionW: 0,
        gridPowerW: 1200,
        homeConsumptionW: 1200,
        batterySoc: 80 as number | null,
        batteryPowerW: 0 as number | null,
      };

      for (let stage = 0; stage < STAGES; stage++) {
        const choice = choices[stage];

        // Stage 0 — driving/arrival/location transition.
        if (stage === 0) {
          if (choice === 0) state = { ...state, isHome: true };
          if (choice === 1) state = { ...state, isHome: false };
          if (choice === 2) state = { ...state, isHome: null };
          if (choice === 3) {
            state = { ...state, isHome: true, batteryLevel: 79 };
          }
        }

        // Stage 1 — cable connection plus awake/asleep/external-charge cases.
        if (stage === 1) {
          if (choice === 0) {
            state = {
              ...state,
              isPluggedIn: true,
              isOnline: true,
              isCharging: false,
              chargeAmps: 0,
            };
          }
          if (choice === 1) {
            state = {
              ...state,
              isPluggedIn: true,
              isOnline: false,
              isCharging: false,
              chargeAmps: 0,
            };
          }
          if (choice === 2) {
            state = {
              ...state,
              isPluggedIn: false,
              isOnline: false,
              isCharging: false,
              chargeAmps: 0,
            };
          }
          if (choice === 3) {
            state = {
              ...state,
              isPluggedIn: true,
              isOnline: true,
              isCharging: true,
              chargeAmps: 16,
            };
          }
        }

        // Stage 2 — solar appears, from none to very strong export.
        if (stage === 2) {
          const variants = [
            { solarProductionW: 0, gridPowerW: 1200 },
            { solarProductionW: 900, gridPowerW: 300 },
            { solarProductionW: 3000, gridPowerW: -1800 },
            { solarProductionW: 8000, gridPowerW: -6800 },
          ] as const;
          energy = { ...energy, ...variants[choice] };
        }

        // Stage 3 — cloud / recovery transition.
        if (stage === 3) {
          const variants = [
            { solarProductionW: 0, gridPowerW: 1200 },
            { solarProductionW: 990, gridPowerW: 210 },
            { solarProductionW: 2400, gridPowerW: -1200 },
            { solarProductionW: 8000, gridPowerW: -6800 },
          ] as const;
          energy = { ...energy, ...variants[choice] };
        }

        // Stage 4 — cross the 6 min solar grace and 15 min cooldown edges.
        if (stage === 4) {
          const jumps = [10_000, 359_000, 360_000, 960_000] as const;
          elapsedMs += jumps[choice];
        }

        // Stage 5 — home-battery reserve/discharge boundaries.
        if (stage === 5) {
          const variants = [
            { batterySoc: 19, batteryPowerW: 0 },
            { batterySoc: 20, batteryPowerW: 0 },
            { batterySoc: 80, batteryPowerW: 301 },
            { batterySoc: 80, batteryPowerW: 300 },
          ] as const;
          energy = { ...energy, ...variants[choice] };
        }

        // Stage 6 — cross the 5 min battery-discharge grace boundary.
        if (stage === 6) {
          const jumps = [10_000, 299_000, 300_000, 360_000] as const;
          elapsedMs += jumps[choice];
        }

        // Stage 7 — no schedule / charge / blockout / both.
        if (stage === 7) schedules = schedulesFor(choice);

        // Stage 8 — all user modes, including authoritative CHARGE NOW / STOP.
        if (stage === 8) {
          const modes: VehicleMode[] = [
            "auto",
            "vacation",
            "charge_now",
            "stop",
          ];
          mode = modes[choice];
        }

        // Stage 9 — final physical/safety event while any previous charge may run.
        if (stage === 9) {
          if (choice === 0) {
            state = {
              ...state,
              isPluggedIn: false,
              isCharging: false,
              chargeAmps: 0,
            };
          }
          if (choice === 1) state = { ...state, isHome: false };
          if (choice === 2) {
            state = {
              ...state,
              batteryLevel: state.chargeLimit,
              isCharging: true,
            };
          }
          if (choice === 3) {
            state = {
              ...state,
              isPluggedIn: true,
              isHome: true,
              isOnline: true,
              batteryLevel: 50,
            };
          }
        }

        const timestamp = BASE_TIME + elapsedMs + stage * 10_000;
        const input = makeInput({
          configOverrides: {
            chargingEnabled: true,
            batteryPriorityEnabled: true,
            batteryPriorityLimit: 20,
            batteryDischargeToleranceW: 300,
            batteryDischargeGraceMinutes: 5,
            gracePeriodMinutes: 6,
            cooldownPeriodMinutes: 15,
          },
          vehicle: { mode, state },
          schedules,
          energyOverrides: energy,
          now: new Date(timestamp),
          timestamp,
        });

        const decision = engine.decide(input).decisions.get("V1");
        if (!decision) {
          recordViolation("missingDecision", `path=${path} stage=${stage}`);
          continue;
        }

        decisionsChecked++;
        const energising = decision.action === "start" ||
          decision.action === "adjust_amps";
        if (energising) energisingDecisions++;
        if (decision.action === "stop") stopDecisions++;

        const hardBlock = !state.isPluggedIn || state.isHome === false ||
          state.batteryLevel >= state.chargeLimit || mode === "stop";
        if (hardBlock && energising) {
          recordViolation(
            "hardBlock",
            `path=${path} stage=${stage}: unsafe ${decision.action} reason=${decision.reason} plugged=${state.isPluggedIn} home=${state.isHome} soc=${state.batteryLevel}/${state.chargeLimit} mode=${mode}`,
          );
        }

        if (energising) {
          if (decision.targetAmps == null) {
            recordViolation(
              "missingTargetAmps",
              `path=${path} stage=${stage}: ${decision.action} without target amps`,
            );
          } else if (
            decision.targetAmps < state.chargeAmpsMin ||
            decision.targetAmps > state.chargeAmpsMax
          ) {
            recordViolation(
              "ampBounds",
              `path=${path} stage=${stage}: target ${decision.targetAmps}A outside ${state.chargeAmpsMin}..${state.chargeAmpsMax}A`,
            );
          }
        }

        const hasBlockout = schedules.some((s) => s.scheduleType === "blockout");
        if (
          hasBlockout && (mode === "auto" || mode === "vacation") && energising
        ) {
          recordViolation(
            "blockout",
            `path=${path} stage=${stage}: blockout bypassed by mode=${mode} reason=${decision.reason}`,
          );
        }

        const hasChargeSchedule = schedules.some((s) =>
          s.scheduleType === "charge"
        );
        const scheduleBypassesBattery = mode === "auto" && hasChargeSchedule &&
          !hasBlockout;
        if (
          energy.batterySoc !== null && energy.batterySoc < 20 &&
          (mode === "auto" || mode === "vacation") &&
          !scheduleBypassesBattery && energising
        ) {
          recordViolation(
            "batteryReserve",
            `path=${path} stage=${stage}: reserve bypassed soc=${energy.batterySoc} mode=${mode} reason=${decision.reason}`,
          );
        }

        if (
          mode === "charge_now" && state.isPluggedIn && state.isHome !== false &&
          state.batteryLevel < state.chargeLimit
        ) {
          if (decision.targetAmps !== state.chargeAmpsMax) {
            recordViolation(
              "chargeNowTarget",
              `path=${path} stage=${stage}: target=${decision.targetAmps}, expected ${state.chargeAmpsMax}, action=${decision.action} reason=${decision.reason}`,
            );
          }
          if (!state.isCharging && decision.action !== "start") {
            recordViolation(
              "chargeNowStart",
              `path=${path} stage=${stage}: failed to start (${decision.action}) reason=${decision.reason}`,
            );
          }
        }

        if (mode === "vacation" && decision.reason === "schedule") {
          recordViolation(
            "vacationSchedule",
            `path=${path} stage=${stage}: vacation mode used charge schedule action=${decision.action}`,
          );
        }

        // Apply the controller output so the next event sees the resulting
        // charging state. This makes each path stateful rather than a set of
        // independent snapshots.
        if (decision.action === "start" || decision.action === "adjust_amps") {
          if (decision.targetAmps !== null) {
            state = {
              ...state,
              isCharging: true,
              chargeAmps: decision.targetAmps,
            };
          }
        } else if (decision.action === "stop") {
          state = { ...state, isCharging: false, chargeAmps: 0 };
        }
      }
    }

    console.log(
      `sequence matrix: ${SEQUENCES.toLocaleString()} paths, ${decisionsChecked.toLocaleString()} decisions, ${energisingDecisions.toLocaleString()} start/adjust, ${stopDecisions.toLocaleString()} stops, ${violationCount.toLocaleString()} violations`,
    );

    for (const [category, bucket] of violations.entries()) {
      console.log(`violation ${category}: ${bucket.count.toLocaleString()}`);
      for (const sample of bucket.samples) console.log(`  sample: ${sample}`);
    }

    if (violationCount > 0) {
      throw new Error(`${violationCount} sequence invariant violation(s)`);
    }

    assertEquals(decisionsChecked, SEQUENCES * STAGES);
  },
});
