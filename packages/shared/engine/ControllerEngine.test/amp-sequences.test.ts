import { expect } from "@std/expect";
import { ControllerEngine } from "../ControllerEngine.ts";
import { makeInput } from "../test-helpers/controller-engine.ts";

// One-minute samples, 3-minute settle, 2A threshold. Feedback reflects each
// accepted command; grid export is chosen to request the exact target amps.
const cases = [
  { targets: [5, 6, 7, 6, 7, 6], commands: [5, 5, 5, 5, 7, 7] },
  { targets: [5, 7, 6, 8, 7], commands: [5, 5, 5, 8, 8] },
  { targets: [5, 6, 5, 6, 5], commands: [5, 5, 5, 5, 5] },
  { targets: [5, 8], commands: [5, 8] },
  { targets: [5, 10], commands: [5, 10] },
  { targets: [5, 16], commands: [5, 16] },
];
for (const { targets, commands } of cases) {
  Deno.test(`solar sequence ${targets.join("→")} with command feedback`, () => {
    const engine = new ControllerEngine();
    let actual = 5;
    const observed: number[] = [];
    targets.forEach((target, index) => {
      const timestamp = Date.UTC(2026, 0, 1, 12) + index * 60_000;
      const output = engine.decide(makeInput({
        timestamp,
        now: new Date(timestamp),
        vehicle: {
          state: {
            isCharging: true,
            chargeAmps: actual,
            chargeAmpsActual: actual,
            chargePowerKw: actual * 0.23,
          },
        },
        energyOverrides: { gridPowerW: -(target - actual) * 230 - 1 },
      }));
      const decision = output.decisions.get("V1");
      if (decision?.action === "adjust_amps") actual = decision.targetAmps!;
      observed.push(actual);
    });
    expect(observed).toEqual(commands);
  });
}
