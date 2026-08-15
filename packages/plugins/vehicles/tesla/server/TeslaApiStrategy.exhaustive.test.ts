import { assertEquals, assertGreater } from "@std/assert";
import { buildVehicleChargeState } from "@chargeha/shared/test-factories";
import type { AdapterVehicleChargeState } from "@chargeha/shared";
import type { VehicleRequestContext } from "../../../types.ts";
import { TeslaApiStrategy, type WakeReason } from "./TeslaApiStrategy.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function context(
  hasSolar: boolean,
  hasSchedule: boolean,
  hasBlockout: boolean,
  forceRefresh: boolean,
  scheduleChargeLimitPct?: number | null,
): VehicleRequestContext {
  return {
    origin: "exhaustive-test",
    traceId: "exhaustive-test",
    hasSolar,
    hasSchedule,
    hasBlockout,
    forceRefresh,
    scheduleChargeLimitPct,
  };
}

function expectedStaleness(
  ctx: VehicleRequestContext,
  state: AdapterVehicleChargeState | null,
): number {
  if (!state) return 3 * MINUTE;
  if (state.isOnline && !state.isPluggedIn) return 5 * MINUTE;
  if (ctx.hasSolar || ctx.hasSchedule) return 10 * MINUTE;
  return 20 * MINUTE;
}

function expectedWake(
  ctx: VehicleRequestContext,
  state: AdapterVehicleChargeState | null,
  lastWakeAtMs: number,
  now: number,
): WakeReason | null {
  if (ctx.forceRefresh) return "force_refresh";
  if (ctx.hasBlockout) return null;
  if (!ctx.hasSchedule && !ctx.hasSolar) return null;
  if (state && !state.isPluggedIn) return null;

  if (state) {
    const effectiveLimit = Math.min(
      state.chargeLimit,
      ctx.scheduleChargeLimitPct ?? state.chargeLimit,
    );
    if (state.batteryLevel >= effectiveLimit) return null;
  }

  if ((now - lastWakeAtMs) < HOUR) return null;
  if (ctx.hasSchedule) return "schedule";
  return "solar";
}

Deno.test("TeslaApiStrategy exhaustive bounded state space", () => {
  const strategy = new TeslaApiStrategy();
  const bools = [false, true] as const;
  const batteryLevels = [0, 49, 50, 79, 80, 99, 100] as const;
  const chargeLimits = [50, 80, 100] as const;
  const scheduleLimits = [undefined, null, 50, 80, 100] as const;
  const now = Date.now();
  const wakeAges = [0, HOUR - 1, HOUR, HOUR + 1] as const;

  let stalenessCases = 0;
  let freshnessCases = 0;
  let wakeCases = 0;

  for (const hasSolar of bools) {
    for (const hasSchedule of bools) {
      for (const hasBlockout of bools) {
        for (const forceRefresh of bools) {
          for (const scheduleLimit of scheduleLimits) {
            const ctx = context(
              hasSolar,
              hasSchedule,
              hasBlockout,
              forceRefresh,
              scheduleLimit,
            );

            assertEquals(
              strategy.staleness(ctx, null),
              expectedStaleness(ctx, null),
            );
            stalenessCases++;

            for (const wakeAge of wakeAges) {
              const lastWake = now - wakeAge;
              assertEquals(
                strategy.shouldWake(ctx, null, lastWake),
                expectedWake(ctx, null, lastWake, now),
              );
              wakeCases++;
            }

            for (const isOnline of bools) {
              for (const isPluggedIn of bools) {
                for (const batteryLevel of batteryLevels) {
                  for (const chargeLimit of chargeLimits) {
                    const state = buildVehicleChargeState({
                      isOnline,
                      isPluggedIn,
                      batteryLevel,
                      chargeLimit,
                    });
                    const staleAfter = expectedStaleness(ctx, state);

                    assertEquals(
                      strategy.staleness(ctx, state),
                      staleAfter,
                    );
                    stalenessCases++;

                    for (
                      const age of [
                        0,
                        staleAfter - 1,
                        staleAfter,
                        staleAfter + 1,
                      ]
                    ) {
                      assertEquals(
                        strategy.isCacheFresh(ctx, state, now - age),
                        age < staleAfter,
                      );
                      freshnessCases++;
                    }

                    for (const wakeAge of wakeAges) {
                      const lastWake = now - wakeAge;
                      assertEquals(
                        strategy.shouldWake(ctx, state, lastWake),
                        expectedWake(ctx, state, lastWake, now),
                      );
                      wakeCases++;
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

  // Guards against accidentally shrinking the matrix later.
  assertGreater(stalenessCases, 6_000);
  assertGreater(freshnessCases, 25_000);
  assertGreater(wakeCases, 25_000);

  console.log(
    `exhaustive matrix: ${stalenessCases} staleness, ${freshnessCases} freshness, ${wakeCases} wake decisions`,
  );
});

Deno.test("TeslaApiStrategy safety invariants across all boolean contexts", () => {
  const strategy = new TeslaApiStrategy();
  const bools = [false, true] as const;
  const now = Date.now();
  let cases = 0;

  for (const hasSolar of bools) {
    for (const hasSchedule of bools) {
      for (const hasBlockout of bools) {
        const ctx = context(
          hasSolar,
          hasSchedule,
          hasBlockout,
          false,
          80,
        );

        const unplugged = buildVehicleChargeState({
          isPluggedIn: false,
          batteryLevel: 20,
          chargeLimit: 100,
        });
        assertEquals(strategy.shouldWake(ctx, unplugged, 0), null);

        const full = buildVehicleChargeState({
          isPluggedIn: true,
          batteryLevel: 80,
          chargeLimit: 100,
        });
        assertEquals(strategy.shouldWake(ctx, full, 0), null);

        if (hasBlockout) {
          const eligible = buildVehicleChargeState({
            isPluggedIn: true,
            batteryLevel: 20,
            chargeLimit: 100,
          });
          assertEquals(strategy.shouldWake(ctx, eligible, 0), null);
        }

        const force = { ...ctx, forceRefresh: true };
        assertEquals(
          strategy.shouldWake(force, unplugged, now),
          "force_refresh",
        );
        cases++;
      }
    }
  }

  assertEquals(cases, 8);
});
