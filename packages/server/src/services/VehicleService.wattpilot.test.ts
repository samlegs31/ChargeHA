import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { VehicleChargeState } from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { VehicleRow } from "../db/types.ts";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import { Logger } from "../lib/Logger.ts";
import { ServiceError } from "../lib/ServiceError.ts";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import { VehicleService } from "./VehicleService.ts";

describe("VehicleService Wattpilot charge control", () => {
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

  const makeService = () => {
    let row: VehicleRow = {
      id: "edith",
      name: "E.D.I.T.H.",
      adapterType: "tesla",
      priority: 2,
      config: '{"existing":"kept"}',
      mode: "vacation",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    let cleared = 0;
    let directCommands = 0;
    let wakeRequests = 0;

    const db = {
      getVehicle: () => Promise.resolve(row),
      getVehicles: () => Promise.resolve([row]),
      upsertVehicle: (next: VehicleRow) => {
        row = { ...row, ...next };
        return Promise.resolve();
      },
      updateVehicleMode: () => Promise.resolve(),
      updateVehiclePriority: () => Promise.resolve(),
    } as unknown as AppDatabase;

    const manager = {
      getVehicleError: () => null,
      getState: () => Promise.resolve(state),
      clearVehicleError: () => {
        cleared++;
      },
      startChargingAt: () => {
        directCommands++;
        return Promise.resolve({ success: true, state });
      },
      stopCharging: () => {
        directCommands++;
        return Promise.resolve({ success: true, state });
      },
      requestState: () => {
        wakeRequests++;
        return Promise.resolve(state);
      },
    } as unknown as VehicleManager;

    const registry = {
      get: () => ({
        getCommandStatus: () =>
          Promise.resolve({
            commandsDisabled: true,
            reason: "Virtual key is not paired",
          }),
      }),
      getAll: () => [],
    } as unknown as VehiclePluginRegistry;

    const service = new VehicleService(
      db,
      manager,
      registry,
      new TypedEventEmitter(),
      new Logger("VehicleServiceWattpilotTest", "error"),
    );

    return {
      service,
      getRow: () => row,
      getCleared: () => cleared,
      getDirectCommands: () => directCommands,
      getWakeRequests: () => wakeRequests,
    };
  };

  const expectConflict = async (promise: Promise<unknown>) => {
    try {
      await promise;
      throw new Error("Expected a conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).code).toBe("CONFLICT");
      expect((error as Error).message).toContain("Wattpilot");
    }
  };

  it("stores Wattpilot control without losing existing vehicle config", async () => {
    const h = makeService();

    const result = await h.service.setChargeController("edith", "wattpilot");

    expect(result).toEqual({ success: true, chargeController: "wattpilot" });
    expect(JSON.parse(h.getRow().config)).toEqual({
      existing: "kept",
      chargeController: "wattpilot",
    });
    expect(h.getCleared()).toBe(1);
  });

  it("does not report Tesla command-readiness as a Wattpilot problem", async () => {
    const h = makeService();
    await h.service.setChargeController("edith", "wattpilot");

    expect(await h.service.getCommandStatus("edith")).toEqual({
      commandsDisabled: false,
      reason: null,
    });
  });

  it("rejects direct start, stop, amps and mode commands", async () => {
    const h = makeService();
    await h.service.setChargeController("edith", "wattpilot");

    await expectConflict(h.service.executeCommand("edith", "start"));
    await expectConflict(h.service.executeCommand("edith", "stop"));
    await expectConflict(h.service.setAmps("edith", 16));
    await expectConflict(h.service.setMode("edith", "stop"));
    expect(h.getDirectCommands()).toBe(0);
  });

  it("still allows a state refresh/wake request", async () => {
    const h = makeService();
    await h.service.setChargeController("edith", "wattpilot");

    const result = await h.service.executeCommand("edith", "wake");

    expect(result.success).toBe(true);
    expect(h.getWakeRequests()).toBe(1);
  });
});
