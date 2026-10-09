import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type { ControllerAction } from "@chargeha/shared";
import { AppDatabase } from "../db/AppDatabase.ts";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { EventMap } from "./TypedEventEmitter.ts";
import { Overseer } from "./Overseer.ts";
import { Logger } from "../lib/Logger.ts";
import { makeState } from "../../../shared/engine/test-helpers/controller-engine.ts";
import { testable } from "../test-helpers/Testable.ts";

describe("Overseer", () => {
  const testLogger = new Logger("Overseer", "error");

  let db: AppDatabase;
  let eventEmitter: TypedEventEmitter;
  let safetyTrips: Array<EventMap["safety_trip"]>;
  let overseer: Overseer;
  let stopCalls: number;
  let stopSuccess: boolean;
  let missingState: boolean;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    eventEmitter = new TypedEventEmitter();
    safetyTrips = [];
    eventEmitter.subscribe("safety_trip", (data) => safetyTrips.push(data));
    stopCalls = 0;
    stopSuccess = true;
    missingState = false;
    await db.setConfig("charging_enabled", "true");
    overseer = new Overseer(db, eventEmitter, testLogger, {
      getState: () =>
        Promise.resolve(missingState ? null : makeState({ isCharging: true })),
      stopCharging: (_id, _ctx, _state, options) => {
        expect(options?.force).toBe(true);
        stopCalls++;
        return Promise.resolve({
          success: stopSuccess,
          error: stopSuccess ? undefined : "Tesla refused STOP",
        });
      },
    });
  });

  afterEach(() => {
    overseer.stop();
    db.close();
  });

  // Helper to seed controller logs with start/stop transitions
  async function seedStateChanges(
    vehicleId: string,
    vehicleName: string,
    actions: ControllerAction[],
  ): Promise<void> {
    await actions.reduce(async (prev, action) => {
      await prev;
      await db.insertControllerLogEntries([{
        vehicleId,
        vehicleName,
        mode: "auto",
        inputsJson: "{}",
        checksJson: "{}",
        action,
        actionDetail: `${action} charging`,
        targetAmps: null,
        traceId: "test",
      }]);
    }, Promise.resolve());
  }

  describe("check (oscillation detection)", () => {
    it("does nothing when no state changes exist", async () => {
      await testable(overseer).check();
      expect(safetyTrips).toHaveLength(0);
    });

    it("does nothing when transitions are within limit", async () => {
      await seedStateChanges("VIN1", "Car 1", ["start", "stop", "start"]);

      await testable(overseer).check();
      expect(safetyTrips).toHaveLength(0);

      // Charging should still be enabled
      const enabled = await db.getConfig("charging_enabled");
      expect(enabled).toBe("true");
    });

    it("trips when transitions exceed limit and last action is stop", async () => {
      // More than 3 transitions, ending on stop so vehicle is already stopped
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
      ]);

      await testable(overseer).check();

      // Safety latch must not change the user switch
      const enabled = await db.getConfig("charging_enabled");
      expect(enabled).toBe("true");
      expect(await db.getConfig("oscillation_paused")).toBe("true");

      // Should have set system alert
      const alertRaw = await db.getConfig("system_alert");
      assertExists(alertRaw);
      const alert = JSON.parse(alertRaw);
      expect(alert.vehicleId).toBe("VIN1");
      expect(alert.vehicleName).toBe("Car 1");

      // Should have emitted safety_trip event
      expect(safetyTrips).toHaveLength(1);
      expect(safetyTrips[0].vehicleId).toBe("VIN1");
      expect(safetyTrips[0].vehicleName).toBe("Car 1");
      expect(safetyTrips[0].cycles).toBeGreaterThan(0);
    });

    it("stops an actively charging vehicle when oscillation trips", async () => {
      // Oscillation requires a real STOP even when the last action was START.
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
      ]);

      await testable(overseer).check();

      // The switch stays enabled; the safety latch and real STOP protect the car.
      const enabled = await db.getConfig("charging_enabled");
      expect(enabled).toBe("true");
      expect(stopCalls).toBe(1);
      expect(safetyTrips).toHaveLength(1);
    });

    it("only trips once per check even with multiple oscillating vehicles", async () => {
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
      ]);
      await seedStateChanges("VIN2", "Car 2", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
      ]);

      await testable(overseer).check();

      // Should only send one notification (trips on first vehicle, then returns)
      expect(safetyTrips).toHaveLength(1);
    });

    it("does not re-trip on same transitions after re-enabling charging", async () => {
      // Oscillation triggers a trip
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
      ]);
      await testable(overseer).check();
      expect(await db.getConfig("charging_enabled")).toBe("true");
      expect(await db.getConfig("oscillation_paused")).toBe("true");
      expect(safetyTrips).toHaveLength(1);

      // User dismisses the safety pause.
      await db.setConfig("oscillation_paused", "false");

      // Next check should NOT re-trip — same transitions are before the trip timestamp
      await testable(overseer).check();
      expect(await db.getConfig("charging_enabled")).toBe("true");
      expect(safetyTrips).toHaveLength(1); // no new notification
    });

    it("trips again if new oscillation occurs after re-enable", async () => {
      // First oscillation + trip
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
      ]);
      await testable(overseer).check();
      expect(await db.getConfig("charging_enabled")).toBe("true");
      expect(await db.getConfig("oscillation_paused")).toBe("true");

      // User dismisses the safety pause.
      await db.setConfig("oscillation_paused", "false");

      // Backdate the trip marker so new entries (at datetime('now')) come after it.
      // In production there's always a real time gap; in tests everything is
      // within the same second.
      await db.setConfig("oscillation_trip_at", "2000-01-01 00:00:00");

      // New oscillation after re-enable
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
      ]);
      await testable(overseer).check();

      // Should trip again on the new transitions
      expect(await db.getConfig("charging_enabled")).toBe("true");
      expect(await db.getConfig("oscillation_paused")).toBe("true");
      expect(safetyTrips).toHaveLength(2);
    });

    it("reports rejected STOP and retains the latch and manual switch", async () => {
      stopSuccess = false;
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
      ]);
      await testable(overseer).check();
      expect(stopCalls).toBe(1);
      expect(await db.getConfig("system_alert")).toContain(
        "Emergency STOP failed: Tesla refused STOP",
      );
      expect(await db.getConfig("oscillation_paused")).toBe("true");
      expect(await db.getConfig("charging_enabled")).toBe("true");
    });

    it("reports unavailable state rather than implying STOP succeeded", async () => {
      missingState = true;
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
      ]);
      await testable(overseer).check();
      expect(await db.getConfig("system_alert")).toContain(
        "Emergency STOP failed:",
      );
      expect(stopCalls).toBe(0);
    });

    it("excludes vehicles controlled by an external charger", async () => {
      await db.setConfig(
        "external_charging_vehicles",
        JSON.stringify({ VIN1: true }),
      );
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
      ]);
      await testable(overseer).check();
      expect(stopCalls).toBe(0);
      expect(safetyTrips).toHaveLength(0);
    });

    it("logs error when check throws", async () => {
      const original = db.getRecentStateChanges;
      db.getRecentStateChanges = () => Promise.reject(new Error("db failure"));
      try {
        await testable(overseer).check();
        // Should not throw — error is caught internally
        expect(safetyTrips).toHaveLength(0);
      } finally {
        db.getRecentStateChanges = original;
      }
    });
  });
});
