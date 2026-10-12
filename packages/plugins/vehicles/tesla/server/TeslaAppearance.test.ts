import { assertEquals } from "@std/assert";
import { buildVehicleChargeState } from "@chargeha/shared/test-factories";
import type { VehicleAdapter } from "@chargeha/shared";
import { Logger } from "@chargeha/server/lib/Logger";
import { TeslaVehicleMiddleware } from "./TeslaVehicleMiddleware.ts";
import { MockTeslaAdapter } from "./test-helpers/MockTeslaAdapter.ts";
import { parseAppearance, readAppearance } from "./TeslaAppearance.ts";

Deno.test("appearance survives restart offline without a Tesla call or changed charging state", async () => {
  let saved = "{}";
  const adapter = new MockTeslaAdapter();
  Object.assign(adapter.state, {
    carType: "model3",
    exteriorColor: "DeepBlue",
    wheelType: "StilettoRefresh19",
  });
  const logger = new Logger("appearance-test", "error");
  const first = new TeslaVehicleMiddleware(
    adapter as unknown as VehicleAdapter,
    logger,
    {
      initial: {},
      save: (value) => {
        saved = JSON.stringify(value);
        return Promise.resolve();
      },
    },
  );
  await first.requestState({
    origin: "test",
    traceId: "test",
    hasSolar: false,
    hasSchedule: false,
    hasBlockout: false,
    isHome: true,
  });
  const offline = new MockTeslaAdapter();
  offline.isOnline = false;
  const restored = new TeslaVehicleMiddleware(
    offline as unknown as VehicleAdapter,
    logger,
    { initial: parseAppearance(saved), save: () => Promise.resolve() },
  );
  assertEquals(restored.getCachedState(), null);
  const seed = buildVehicleChargeState({
    isCharging: false,
    isPluggedIn: false,
    batteryLevel: 23,
  });
  restored.seedState(seed);
  assertEquals(readAppearance(restored.getCachedState()), {
    carType: "model3",
    exteriorColor: "DeepBlue",
    wheelType: "StilettoRefresh19",
  });
  assertEquals(restored.getCachedState()?.batteryLevel, 23);
  assertEquals(restored.getCachedState()?.isCharging, false);
  assertEquals(restored.getCachedState()?.isOnline, false);
  assertEquals(offline.getChargeStateCalls, 0);
  assertEquals(offline.wakeVehicleCalls, 0);
  assertEquals(
    parseAppearance('{"isCharging":true,"carType":"modely","batteryLevel":99}'),
    { carType: "modely" },
  );
  assertEquals(parseAppearance("broken"), {});
});
