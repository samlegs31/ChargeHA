import { expect } from "@std/expect";
import { ControllerEngine } from "../ControllerEngine.ts";
import { makeInput } from "../test-helpers/controller-engine.ts";

for (const phases of [1, 3]) {
  for (const drop of [1, 2]) {
    Deno.test(`solar reduction ${drop}A / ${phases} phase(s) avoids debounce grid import`, () => {
      const engine = new ControllerEngine();
      const wattsPerAmp = 230 * phases;
      const target = 16 - drop;
      let amps = 16;
      let importedWh = 0;
      let firstAdjustmentSeconds: number | null = null;
      for (let seconds = 0; seconds <= 180; seconds += 10) {
        const output = engine.decide(makeInput({
          timestamp: Date.UTC(2026, 0, 1, 12) + seconds * 1000,
          vehicle: {
            state: {
              isCharging: true,
              chargeAmps: amps,
              chargeAmpsActual: amps,
              chargePowerKw: amps * wattsPerAmp / 1000,
              chargerPhases: phases,
            },
          },
          configOverrides: { threePhaseCharger: phases === 3 },
          energyOverrides: {
            solarProductionW: 15000,
            gridPowerW: (amps - target) * wattsPerAmp - 1,
          },
        }));
        const decision = output.decisions.get("V1");
        if (decision?.action === "adjust_amps") {
          amps = decision.targetAmps!;
          firstAdjustmentSeconds ??= seconds;
        }
        importedWh += Math.max(0, amps - target) * wattsPerAmp * 10 / 3600;
      }
      console.log(
        "SOLAR_RESPONSE",
        JSON.stringify({ drop, phases, firstAdjustmentSeconds, importedWh }),
      );
      expect(firstAdjustmentSeconds).toBe(0);
      expect(importedWh).toBe(0);
    });
  }
}

Deno.test("a solar reduction cancels pending increase and keeps upward settling", () => {
  const engine = new ControllerEngine();
  const decide = (current: number, target: number, seconds: number) =>
    engine.decide(makeInput({
      timestamp: Date.UTC(2026, 0, 1, 12) + seconds * 1000,
      vehicle: {
        state: {
          isCharging: true,
          chargeAmps: current,
          chargePowerKw: current * 0.23,
        },
      },
      energyOverrides: { gridPowerW: (current - target) * 230 - 1 },
    })).decisions.get("V1");
  expect(decide(8, 9, 0)?.action).toBe("none");
  expect(decide(8, 7, 10)?.targetAmps).toBe(7);
  expect(decide(7, 8, 20)?.action).toBe("none");
  expect(decide(7, 8, 190)?.action).toBe("none");
  expect(decide(7, 8, 200)?.targetAmps).toBe(8);
});
