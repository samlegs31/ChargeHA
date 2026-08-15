import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { VehicleChargeState } from "@chargeha/shared";
import type { VehicleRow } from "../db/types.ts";
import { AppDatabase } from "../db/AppDatabase.ts";
import { VehicleManager } from "./VehicleManager.ts";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import { Logger } from "../lib/Logger.ts";
import { MockMiddleware } from "../test-helpers/MockMiddleware.ts";
import { MockEventEmitter } from "../test-helpers/MockEventEmitter.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";

const STATE: VehicleChargeState = {
  vehicleId: "VIN1",
  batteryLevel: 68,
  chargeLimit: 80,
  isCharging: false,
  isPluggedIn: true,
  isOnline: true,
  chargeAmps: 16,
  chargeAmpsMax: 32,
  chargeAmpsMin: 5,
  chargePowerKw: 0,
  chargerVoltage: 240,
  chargerPhases: 1,
  energyAddedKwh: 0,
  minutesToFull: 0,
  chargePortOpen: true,
  vehicleName: "F.R.I.D.A.Y.",
  lastUpdated: "2026-08-15T13:00:00.000Z",
  latitude: null,
  longitude: null,
  isHome: null,
};

const ROW: VehicleRow = {
  id: "VIN1",
  name: "F.R.I.D.A.Y.",
  adapterType: "tesla",
  priority: 1,
  config: "{}",
  mode: "vacation",
  createdAt: "2026-08-15",
  updatedAt: "2026-08-15",
};

const REQUEST_CONTEXT = {
  origin: "test",
  traceId: "test",
  hasSolar: true,
  hasSchedule: false,
  hasBlockout: false,
};

const CMD_CTX = { origin: "controller:vacation", traceId: "test" };

describe("VehicleManager unplugged command race", () => {
  const logger = new Logger("VehicleManager", "error");
  let db: AppDatabase;
  let middleware: MockMiddleware;
  let manager: VehicleManager;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    middleware = new MockMiddleware(STATE);
    const registry = {
      get: () => ({
        id: "tesla",
        createMiddleware: () => Promise.resolve(middleware),
      }),
    } as unknown as VehiclePluginRegistry;
    manager = new VehicleManager(
      db,
      new MockEventEmitter() as unknown as TypedEventEmitter,
      logger,
      registry,
    );
    await manager.addVehicle(ROW);
  });

  afterEach(() => db.close());

  it("does not persist a command error when refreshed state shows unplugged", async () => {
    middleware.nextState = { ...STATE, isPluggedIn: false, chargePortOpen: false };
    await manager.requestState("VIN1", REQUEST_CONTEXT);

    middleware.startResult = false;
    const result = await manager.startChargingAt(
      "VIN1",
      16,
      CMD_CTX,
      { ...STATE, isPluggedIn: true },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Vehicle unplugged");
    expect(result.state?.isPluggedIn).toBe(false);
    expect(manager.getVehicleError("VIN1")).toBeNull();

    middleware.startResult = true;
    const retry = await manager.startChargingAt(
      "VIN1",
      16,
      CMD_CTX,
      { ...STATE, isPluggedIn: true },
    );
    expect(retry.error).not.toBe("Command backoff active");
  });

  it("clears an obsolete command error after fresh unplugged telemetry", async () => {
    manager.reportVehicleError(
      "VIN1",
      "F.R.I.D.A.Y.",
      "startCharging rejected by vehicle",
      "command",
    );
    expect(manager.getVehicleError("VIN1")).not.toBeNull();

    middleware.nextState = { ...STATE, isPluggedIn: false, chargePortOpen: false };
    await manager.requestState("VIN1", REQUEST_CONTEXT);

    expect(manager.getVehicleError("VIN1")).toBeNull();
  });
});
