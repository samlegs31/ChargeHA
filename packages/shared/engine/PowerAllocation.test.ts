import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { allocatePower } from "./PowerAllocation.ts";
import { SolarAllocator } from "./SolarAllocator.ts";
import {
  makeConfig,
  makeEnergy,
  makeVehicle,
} from "./test-helpers/controller-engine.ts";

describe("Shared watt budgets", () => {
  it("conserves power across mono and three-phase solar charging", () => {
    const vehicles = [
      makeVehicle({
        id: "mono",
        priority: 1,
        state: { chargerPhases: 1, isCharging: true },
      }),
      makeVehicle({
        id: "tri",
        priority: 2,
        state: { chargerPhases: 3, isCharging: true },
      }),
    ];
    const allocation = SolarAllocator.equal(
      vehicles,
      makeConfig(),
      makeEnergy({ solarProductionW: 6000, gridPowerW: -6000 }),
    );
    expect(allocation.get("mono")).toBe(26);
    expect(allocation.get("tri")).toBe(0);
    expect(
      (allocation.get("mono") ?? 0) * 230 + (allocation.get("tri") ?? 0) * 690,
    ).toBeLessThanOrEqual(6000);
  });

  it("redistributes power released by a capped vehicle", () => {
    expect([
      ...allocatePower(
        [{ id: "a", wattsPerAmp: 230, maxAmps: 8 }, {
          id: "b",
          wattsPerAmp: 230,
          maxAmps: 32,
        }],
        4600,
        true,
      ).values(),
    ]).toEqual([8, 12]);
  });

  it("conserves the budget for varying circuits, caps and priorities", () => {
    [false, true].forEach((equal) =>
      [120, 230, 240].forEach((voltage) =>
        [1, 3].forEach((phases) => {
          const recipients = [{ id: "a", wattsPerAmp: 230, maxAmps: 16 }, {
            id: "b",
            wattsPerAmp: voltage * phases,
            maxAmps: 32,
          }];
          Array.from({ length: 70 }, (_, i) => i * 173).forEach((budget) => {
            const allocation = allocatePower(recipients, budget, equal);
            expect(recipients.reduce((sum, r) =>
              sum + (allocation.get(r.id) ?? 0) * r.wattsPerAmp, 0))
              .toBeLessThanOrEqual(budget);
            recipients.forEach((r) =>
              expect(allocation.get(r.id)).toBeLessThanOrEqual(r.maxAmps)
            );
          });
        })
      )
    );
  });
});
