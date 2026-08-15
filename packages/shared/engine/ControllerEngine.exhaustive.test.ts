import { assertEquals, assertGreater } from "@std/assert";
import { scheduleCreateInput } from "../schemas.ts";
import type { VehicleMode } from "../types.ts";
import { ControllerEngine } from "./ControllerEngine.ts";
import type { EngineSchedule } from "./types.ts";
import { makeInput } from "./test-helpers/controller-engine.ts";

const BOOLS = [false, true] as const;
const MODES: VehicleMode[] = ["auto", "vacation", "charge_now", "stop"];
const HOME_STATES = [true, false, null] as const;

function activeSchedule(
  scheduleType: "charge" | "blockout",
  chargeAmps: number | null = 16,
): EngineSchedule {
  return {
    id: `${scheduleType}-1`,
    vehicleId: "V1",
    scheduleType,
    startTime: "00:00",
    endTime: "23:59",
    days: ["thu"],
    chargeAmps: scheduleType === "charge" ? chargeAmps : null,
    chargeLimitPct: null,
    enabled: true,
  };
}

function schedulesFor(kind: "none" | "charge" | "blockout" | "both") {
  if (kind === "charge") return [activeSchedule("charge")];
  if (kind === "blockout") return [activeSchedule("blockout")];
  if (kind === "both") {
    return [activeSchedule("charge"), activeSchedule("blockout")];
  }
  return [];
}

Deno.test("ControllerEngine exhaustive safety matrix", () => {
  const batteryLevels = [0, 20, 79, 80, 99, 100] as const;
  const chargeLimits = [80, 100] as const;
  const scheduleKinds = ["none", "charge", "blockout", "both"] as const;
  const violations: string[] = [];
  let cases = 0;
  let activeDecisions = 0;

  for (const chargingEnabled of BOOLS) {
    for (const mode of MODES) {
      for (const isPluggedIn of BOOLS) {
        for (const isHome of HOME_STATES) {
          for (const isCharging of BOOLS) {
            for (const batteryLevel of batteryLevels) {
              for (const chargeLimit of chargeLimits) {
                for (const scheduleKind of scheduleKinds) {
                  const engine = new ControllerEngine();
                  const input = makeInput({
                    configOverrides: {
                      chargingEnabled,
                      batteryPriorityEnabled: false,
                    },
                    vehicle: {
                      mode,
                      state: {
                        isPluggedIn,
                        isHome,
                        isCharging,
                        batteryLevel,
                        chargeLimit,
                        chargeAmps: isCharging ? 16 : 0,
                        chargeAmpsMin: 5,
                        chargeAmpsMax: 32,
                      },
                    },
                    schedules: schedulesFor(scheduleKind),
                    // Plenty of export so the solar path is eligible whenever
                    // no stronger precondition/mode/schedule blocks it.
                    energyOverrides: {
                      solarProductionW: 10_000,
                      gridPowerW: -8_000,
                      homeConsumptionW: 2_000,
                    },
                  });

                  const decision = engine.decide(input).decisions.get("V1");
                  if (!decision) {
                    violations.push("missing decision for V1");
                    continue;
                  }

                  cases++;
                  const energising = decision.action === "start" ||
                    decision.action === "adjust_amps";
                  if (energising) activeDecisions++;

                  const mustNeverEnergise = !chargingEnabled ||
                    !isPluggedIn ||
                    isHome === false ||
                    batteryLevel >= chargeLimit ||
                    mode === "stop";

                  if (mustNeverEnergise && energising) {
                    violations.push(
                      `unsafe energise action=${decision.action} mode=${mode} enabled=${chargingEnabled} plugged=${isPluggedIn} home=${isHome} charging=${isCharging} soc=${batteryLevel}/${chargeLimit} schedule=${scheduleKind}`,
                    );
                  }

                  if (energising) {
                    if (decision.targetAmps == null) {
                      violations.push(
                        `energise without target amps mode=${mode} schedule=${scheduleKind}`,
                      );
                    } else if (
                      decision.targetAmps < 5 || decision.targetAmps > 32
                    ) {
                      violations.push(
                        `target outside vehicle bounds: ${decision.targetAmps}A mode=${mode} schedule=${scheduleKind}`,
                      );
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  assertGreater(cases, 9_000);
  assertGreater(activeDecisions, 0);
  assertEquals(violations, []);
  console.log(
    `controller safety matrix: ${cases} cases, ${activeDecisions} start/adjust decisions, 0 safety violations`,
  );
});

Deno.test("ControllerEngine respects home-battery reserve outside charge schedules", () => {
  const batterySocs = [null, 19, 20, 21] as const;
  const modes: VehicleMode[] = ["auto", "vacation"];
  const violations: string[] = [];
  let cases = 0;

  for (const mode of modes) {
    for (const isCharging of BOOLS) {
      for (const batterySoc of batterySocs) {
        for (const hasChargeSchedule of BOOLS) {
          const engine = new ControllerEngine();
          const input = makeInput({
            configOverrides: {
              batteryPriorityEnabled: true,
              batteryPriorityLimit: 20,
              batteryDischargeToleranceW: 300,
              batteryDischargeGraceMinutes: 5,
            },
            vehicle: {
              mode,
              state: {
                isCharging,
                isPluggedIn: true,
                isHome: true,
                batteryLevel: 20,
                chargeLimit: 80,
                chargeAmps: isCharging ? 16 : 0,
              },
            },
            schedules: hasChargeSchedule ? [activeSchedule("charge")] : [],
            energyOverrides: {
              batterySoc,
              batteryPowerW: 0,
              solarProductionW: 10_000,
              gridPowerW: -8_000,
              homeConsumptionW: 2_000,
            },
          });

          const decision = engine.decide(input).decisions.get("V1");
          if (!decision) {
            violations.push("missing battery-priority decision");
            continue;
          }
          cases++;

          // Charge schedules are intentionally authoritative in SOLAR + CLOCK
          // (mode=auto). In all other paths, being below reserve must prevent a
          // start/amp increase and must stop an already-running solar charge.
          const scheduleBypassesBattery = mode === "auto" && hasChargeSchedule;
          const belowReserve = batterySoc !== null && batterySoc < 20;
          if (belowReserve && !scheduleBypassesBattery) {
            if (
              decision.action === "start" ||
              decision.action === "adjust_amps"
            ) {
              violations.push(
                `battery reserve bypassed mode=${mode} charging=${isCharging} soc=${batterySoc} schedule=${hasChargeSchedule}`,
              );
            }
            if (isCharging && decision.action !== "stop") {
              violations.push(
                `running solar charge not stopped below reserve mode=${mode} soc=${batterySoc}`,
              );
            }
          }
        }
      }
    }
  }

  assertEquals(cases, 32);
  assertEquals(violations, []);
});

Deno.test("schema-valid schedule currents never exceed vehicle hardware limits", () => {
  // These values are all currently accepted by scheduleCreateInput (min 1,
  // no integer/max constraint). The engine must still never ask the vehicle
  // for a current outside its advertised 5..32 A range.
  const scheduleAmps = [1, 4, 4.5, 5, 16, 31.5, 32, 33, 40, 48] as const;
  const violations: string[] = [];

  for (const amps of scheduleAmps) {
    const parsed = scheduleCreateInput.safeParse({
      scheduleType: "charge",
      startTime: "00:00",
      endTime: "23:59",
      days: ["thu"],
      vehicleId: "V1",
      chargeAmps: amps,
      chargeLimitPct: 80,
    });
    if (!parsed.success) {
      violations.push(`${amps}A unexpectedly rejected by schedule schema`);
      continue;
    }

    const engine = new ControllerEngine();
    const input = makeInput({
      vehicle: {
        mode: "auto",
        state: {
          isPluggedIn: true,
          isHome: true,
          isCharging: false,
          batteryLevel: 20,
          chargeLimit: 80,
          chargeAmpsMin: 5,
          chargeAmpsMax: 32,
        },
      },
      schedules: [activeSchedule("charge", amps)],
    });

    const decision = engine.decide(input).decisions.get("V1");
    if (!decision) {
      violations.push(`${amps}A produced no decision`);
      continue;
    }

    const target = decision.targetAmps;
    if (target == null || target < 5 || target > 32) {
      violations.push(
        `${amps}A schema input -> ${String(target)}A engine target (${decision.action})`,
      );
    }
  }

  assertEquals(violations, []);
});
