import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { VehicleChargeState } from "@chargeha/shared";
import type { VehicleRow } from "../db/types.ts";
import { AppDatabase } from "../db/AppDatabase.ts";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import { Logger } from "../lib/Logger.ts";
import { MockMiddleware } from "../test-helpers/MockMiddleware.ts";
import { MockEventEmitter } from "../test-helpers/MockEventEmitter.ts";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import { VehicleManager } from "./VehicleManager.ts";

const state: VehicleChargeState = {
  vehicleId: "edith",
  batteryLevel: 75,
  chargeLimit: 100,
  isCharging: true,
  isPluggedIn: true,
  isOnline: true,
  chargeAmps: 20,
  chargeAmpsMax: 20,
  chargeAmpsMin: 6,
  chargePowerKw: 4.6,
  chargerVoltage: 230,
  chargerPhases: 1,
  energyAddedKwh: 8.9,
  minutesToFull: 215,
  chargePortOpen: true,
  vehicleName: "E.D.I.T.H.",
  lastUpdated: new Date().toISOString(),
  latitude: 43.6,
  longitude: 1.5,
  isHome: true,
};

const commandContext = { origin: "controller:test", traceId: "test" };

describe("VehicleManager Wattpilot safety gate", () => {
  let db: AppDatabase;
  let manager: VehicleManager;
  let middleware: MockMiddleware;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    middleware = new MockMiddleware(state);

    const registry = {
      get: () => ({
        id: "tesla",
        createMiddleware: () => Promise.resolve(middleware),
      }),
    } as unknown as VehiclePluginRegistry;

    manager = new VehicleManager(
      db,
      new MockEventEmitter() as unknown as TypedEventEmitter,
      new Logger("VehicleManagerWattpilotTest", "error"),
      registry,
    );

    await db.upsertVehicle({
      id: "edith",
      name: "E.D.I.T.H.",
      adapterType: "tesla",
      priority: 2,
      config: '{"chargeController":"wattpilot"}',
      mode: "vacation",
    });
    const row = await db.getVehicle("edith");
    if (!row) throw new Error("Test vehicle missing");
    await manager.addVehicle(row as VehicleRow);
    await manager.requestState("edith", {
      origin: "test",
      traceId: "test",
      hasSolar: false,
      hasSchedule: false,
      hasBlockout: false,
    });
  });

  afterEach(() => db.close());

  it("does not send start or amp commands when the controller requests a change", async () => {
    const result = await manager.startChargingAt(
      "edith",
      16,
      commandContext,
      state,
    );

    expect(result.success).toBe(true);
    expect(middleware.setAmpsCalls).toHaveLength(0);
    expect(middleware.startCalls).toHaveLength(0);
  });

  it("does not send a stop command while Wattpilot owns charging", async () => {
    const result = await manager.stopCharging(
      "edith",
      commandContext,
      state,
      { force: true },
    );

    expect(result.success).toBe(true);
    expect(middleware.stopCalls).toHaveLength(0);
  });
});
