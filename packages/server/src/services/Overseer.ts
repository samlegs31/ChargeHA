import { externalChargingVehicles } from "./ExternalCharging.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { SystemAlert } from "../db/types.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { Logger } from "../lib/Logger.ts";
import type { VehicleManager } from "./VehicleManager.ts";

const CHECK_INTERVAL_MS = 60_000;
const WINDOW_MINUTES = 60;
const MAX_TRANSITIONS = 3;

export class Overseer {
  private readonly db: AppDatabase;
  private readonly eventEmitter: TypedEventEmitter;
  private readonly logger: Logger;
  private readonly vehicleManager: Pick<
    VehicleManager,
    "getState" | "stopCharging"
  >;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    db: AppDatabase,
    eventEmitter: TypedEventEmitter,
    logger: Logger,
    vehicleManager: Pick<VehicleManager, "getState" | "stopCharging">,
  ) {
    this.db = db;
    this.eventEmitter = eventEmitter;
    this.logger = logger;
    this.vehicleManager = vehicleManager;
    this.start();
  }

  private start(): void {
    this.logger.info("Started — monitoring for charge oscillation");
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check(): Promise<void> {
    try {
      if (await this.db.getConfig("oscillation_paused") === "true") return;
      // Ignore transitions that already caused a previous trip.
      // Without this, re-enabling charging would immediately re-trip
      // because the same transitions are still within the window.
      const tripAt = await this.db.getConfig("oscillation_trip_at");
      const external = await externalChargingVehicles(this.db);
      const rows = (await this.db.getRecentStateChanges(
        WINDOW_MINUTES,
        tripAt ?? undefined,
      )).filter((row) => !external.has(row.vehicleId));
      if (rows.length === 0) return;

      // Group by vehicle
      const byVehicle = Map.groupBy(rows, (row) => row.vehicleId);

      // Count transitions per vehicle and find the first one to trip
      const trippable = [...byVehicle.entries()]
        .map(([vehicleId, actions]) => {
          const { transitions, cycles } = actions.slice(1).reduce(
            (acc, action, i) => {
              if (action.action !== actions[i].action) {
                return {
                  transitions: acc.transitions + 1,
                  cycles: acc.cycles + (action.action === "stop" ? 1 : 0),
                };
              }
              return acc;
            },
            { transitions: 0, cycles: 0 },
          );
          return { vehicleId, actions, transitions, cycles };
        })
        .find(({ transitions }) => transitions > MAX_TRANSITIONS);

      if (trippable) {
        const vehicleName = trippable.actions[0].vehicleName;
        await this.trip(trippable.vehicleId, vehicleName, trippable.cycles);
      }
    } catch (error) {
      this.logger.error("Check error:", error);
    }
  }

  private async trip(
    vehicleId: string,
    vehicleName: string,
    cycles: number,
  ): Promise<void> {
    this.logger.error(
      `SAFETY TRIP — ${vehicleName} (${vehicleId}) had ${cycles} start/stop cycles in the last ${WINDOW_MINUTES} minutes. Pausing automation without changing the user switch.`,
    );

    // Persist the safety latch before attempting STOP, including on failure.
    await this.db.setConfig("oscillation_paused", "true");
    const stopResult = await this.emergencyStop(vehicleId).catch((error) => ({
      success: false,
      error: String(error),
    }));
    const stopFailure = stopResult?.success === false
      ? ` Emergency STOP failed: ${stopResult.error ?? "unknown error"}.`
      : "";

    // Use SQLite datetime format to match controller_logs.timestamp
    await this.db.setConfig(
      "oscillation_trip_at",
      new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
    );
    const alert: SystemAlert = {
      message:
        `Safety pause: ${vehicleName} had ${cycles} start/stop cycles in ${WINDOW_MINUTES} minutes, which may indicate oscillation.${stopFailure} Your Automatic charging switch is unchanged. Dismiss this alert when ready to release the safety pause; automation resumes only if your switch is ON.`,
      timestamp: new Date().toISOString(),
      vehicleId,
      vehicleName,
    };
    await this.db.setConfig("system_alert", JSON.stringify(alert));

    this.eventEmitter.emit("safety_trip", {
      vehicleId,
      vehicleName,
      cycles,
      windowMinutes: WINDOW_MINUTES,
    });
  }

  private async emergencyStop(
    vehicleId: string,
  ): Promise<Awaited<ReturnType<VehicleManager["stopCharging"]>> | null> {
    const state = await this.vehicleManager.getState(vehicleId);
    if (!state) {
      return {
        success: false,
        error: "Vehicle state unavailable; STOP not confirmed",
      };
    }
    if (!state.isCharging) return null;
    return await this.vehicleManager.stopCharging(
      vehicleId,
      { origin: "overseer:safety-trip", traceId: crypto.randomUUID() },
      state,
      { force: true },
    );
  }
}
