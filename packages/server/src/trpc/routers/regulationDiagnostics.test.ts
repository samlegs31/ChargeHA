import { expect } from "@std/expect";
import { appRouter } from "../root.ts";
import { createCallerFactory, type TrpcContext } from "../trpc.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";
import { TypedEventEmitter } from "../../services/TypedEventEmitter.ts";
import type { VehicleChargeState } from "@chargeha/shared";

Deno.test("diagnostics use cache only and never substitute requested amps for actual", async () => {
  const emitter = new TypedEventEmitter();
  emitter.emit("controller_status", {
    vehicleId: "car",
    action: "adjust_amps",
    reason: "solar_tracking",
    detail: "private detail must not leak",
    targetAmps: 22,
    checksJson: "[]",
    observedAt: new Date(Date.now() - 5000).toISOString(),
  }, "car");
  const state = {
    vehicleId: "car",
    vehicleName: "Car",
    chargeAmps: 16,
    lastUpdated: new Date(Date.now() - 120000).toISOString(),
    latitude: 42,
  } as VehicleChargeState;
  const ctx = throwingMock<TrpcContext>("context", {
    vehicleManager: throwingMock<TrpcContext["vehicleManager"]>("vehicles", {
      getAllStates: () => Promise.resolve(new Map([["car", state]])),
    }),
    configService: throwingMock<TrpcContext["configService"]>("config", {
      getCharging: () =>
        Promise.resolve(
          {
            chargingEnabled: true,
            vehicleCurrentLimits: {},
            maxGridImportKw: null,
            priorityChargingEnabled: false,
            vehicleSolarCurrentLimits: { car: 22 },
          } as Awaited<ReturnType<TrpcContext["configService"]["getCharging"]>>,
        ),
    }),
    db: throwingMock<TrpcContext["db"]>("db", {
      getConfig: () => Promise.resolve(null),
    }),
    poller: throwingMock<TrpcContext["poller"]>("poller", {
      tryGetRealtimeSnapshot: () => null,
      getRealtimeMaxAgeMs: () => 60000,
    }),
    eventEmitter: emitter,
  });
  const data = await createCallerFactory(appRouter)(ctx).health.regulation();
  expect(data.energyStale).toBe(true);
  expect(data.energyAgeMs).toBeNull();
  expect(data.vehicles[0].actualAmps).toBeNull();
  expect(data.vehicles[0].requestedAmps).toBe(22);
  expect(data.vehicles[0].telemetryAgeMs).toBeGreaterThanOrEqual(120000);
  expect(JSON.stringify(data)).not.toContain("private detail");
  expect(JSON.stringify(data)).not.toContain("latitude");
});
