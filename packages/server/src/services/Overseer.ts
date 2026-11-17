import { isScheduleActiveNow } from "@chargeha/shared/engine";
import { externalChargingVehicles } from "./ExternalCharging.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { SystemAlert } from "../db/types.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { Logger } from "../lib/Logger.ts";
import type { VehicleManager } from "./VehicleManager.ts";

const CHECK_INTERVAL_MS = 60_000;
const WINDOW_MINUTES = 60;
const MAX_TRANSITIONS = 3;
const RECOVERY_DELAY_MS = 5 * 60_000;

export const OSCILLATION_BY_VEHICLE_KEY = "runtime.oscillation_by_vehicle";

export interface VehicleOscillationState {
  paused: boolean;
  tripAt: string;
  vehicleName: string;
  alertMessage?: string;
}

export function parseOscillationByVehicle(
  raw: string | null,
): Record<string, VehicleOscillationState> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, VehicleOscillationState>;
  } catch {
    return {};
  }
}

export class Overseer {
  private readonly db: AppDatabase;
  private readonly eventEmitter: TypedEventEmitter;
  private readonly logger: Logger;
  private readonly vehicleManager: Pick<
    VehicleManager,
    "getState" | "stopCharging"
  >;
  private checking = false;
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
    if (this.checking) return;
    this.checking = true;
    try {
      const globalPaused =
        (await this.db.getConfig("oscillation_paused")) === "true";
      const byVehicleState = await this.syncByVehicleState(globalPaused);

      if (globalPaused) {
        const anyRecovered = await this.recoverPause(byVehicleState);
        if (anyRecovered) return;
      }

      const chargingEnabled =
        (await this.db.getConfig("charging_enabled")) !== "false";
      const scheduledVehicleIds = new Set<string>();
      if (chargingEnabled) {
        const [vehicles, schedules, timezone] = await Promise.all([
          this.db.getVehicles(),
          this.db.getSchedules(),
          this.db.getConfig("timezone"),
        ]);
        const now = new Date();
        const tz = timezone ?? "";
        for (const vehicle of vehicles) {
          if (vehicle.mode !== "auto") continue;
          const hasActiveChargeSchedule = schedules.some((s) =>
            s.scheduleType === "charge" &&
            s.enabled &&
            (s.vehicleId === vehicle.id || s.vehicleId === null) &&
            isScheduleActiveNow(s, now, tz)
          );
          if (hasActiveChargeSchedule) {
            scheduledVehicleIds.add(vehicle.id);
          }
        }
      }

      // Ignore transitions that already caused a previous trip.
      // Without this, re-enabling charging would immediately re-trip
      // because the same transitions are still within the window.
      const globalTripAt = await this.db.getConfig("oscillation_trip_at");
      const external = await externalChargingVehicles(this.db);
      const hasPerVehicleState = Object.keys(byVehicleState).length > 0;
      const rows = (await this.db.getRecentStateChanges(
        WINDOW_MINUTES,
        hasPerVehicleState ? undefined : (globalTripAt ?? undefined),
      )).filter((row) => {
        if (external.has(row.vehicleId)) return false;
        if (scheduledVehicleIds.has(row.vehicleId)) return false;
        const vehicleEntry = byVehicleState[row.vehicleId];
        if (vehicleEntry?.paused) return false;
        const cutoff = vehicleEntry?.tripAt ??
          (hasPerVehicleState ? undefined : globalTripAt);
        if (cutoff && row.timestamp <= cutoff) return false;
        return true;
      });
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
        await this.trip(
          trippable.vehicleId,
          vehicleName,
          trippable.cycles,
          byVehicleState,
        );
      }
    } catch (error) {
      this.logger.error("Check error:", error);
    } finally {
      this.checking = false;
    }
  }

  private async syncByVehicleState(
    globalPaused: boolean,
  ): Promise<Record<string, VehicleOscillationState>> {
    const [rawMap, globalTripAt, alertRaw] = await Promise.all([
      this.db.getPluginConfig(OSCILLATION_BY_VEHICLE_KEY),
      this.db.getConfig("oscillation_trip_at"),
      this.db.getConfig("system_alert"),
    ]);
    const map = parseOscillationByVehicle(rawMap);
    let alert: SystemAlert | null = null;
    if (alertRaw) {
      try {
        alert = JSON.parse(alertRaw) as SystemAlert;
      } catch {
        alert = null;
      }
    }

    let mutated = false;
    if (!globalPaused) {
      for (const [vehicleId, entry] of Object.entries(map)) {
        const updatedTripAt =
          (alert?.vehicleId === vehicleId || Object.keys(map).length === 1) &&
            globalTripAt
            ? globalTripAt
            : entry.tripAt;
        if (entry.paused || entry.tripAt !== updatedTripAt) {
          map[vehicleId] = {
            ...entry,
            paused: false,
            tripAt: updatedTripAt,
          };
          mutated = true;
        }
      }
    } else {
      const pausedEntries = Object.entries(map).filter(([, e]) => e.paused);
      if (pausedEntries.length === 0 && alert?.vehicleId) {
        map[alert.vehicleId] = {
          paused: true,
          tripAt: globalTripAt ?? "",
          vehicleName: alert.vehicleName ?? alert.vehicleId,
          alertMessage: alert.message,
        };
        mutated = true;
      } else if (
        alert?.vehicleId &&
        globalTripAt &&
        map[alert.vehicleId]?.paused &&
        map[alert.vehicleId].tripAt !== globalTripAt
      ) {
        map[alert.vehicleId] = {
          ...map[alert.vehicleId],
          tripAt: globalTripAt,
        };
        mutated = true;
      }
    }

    if (mutated) {
      await this.db.setPluginConfig(
        OSCILLATION_BY_VEHICLE_KEY,
        JSON.stringify(map),
      );
    }
    return map;
  }

  /** Release only a confirmed stopped vehicle; never enable the user's switch. */
  private async recoverPause(
    byVehicleState: Record<string, VehicleOscillationState>,
  ): Promise<boolean> {
    const pausedEntries = Object.entries(byVehicleState).filter(
      ([, entry]) => entry.paused,
    );
    if (pausedEntries.length === 0) return false;

    let recoveredCount = 0;
    let lastReleasedAt = "";

    for (const [vehicleId, entry] of pausedEntries) {
      const timestamp = entry.tripAt
        ? Date.parse(entry.tripAt.replace(" ", "T") + "Z")
        : NaN;
      if (!Number.isFinite(timestamp)) continue;
      if (Date.now() - timestamp < RECOVERY_DELAY_MS) continue;
      const state = await this.vehicleManager.getState(vehicleId);
      if (!state || state.isCharging) continue;
      const telemetryAt = Date.parse(state.lastUpdated);
      const age = Date.now() - telemetryAt;
      if (
        !Number.isFinite(age) || age < 0 || age > 90_000 ||
        telemetryAt < timestamp
      ) continue;

      const releasedAt = new Date().toISOString().replace("T", " ").replace(
        /\.\d+Z$/,
        "",
      );
      byVehicleState[vehicleId] = {
        ...entry,
        paused: false,
        tripAt: releasedAt,
      };
      lastReleasedAt = releasedAt;
      recoveredCount++;
      this.logger.info(
        "Oscillation cooldown completed; normal regulation may resume",
      );
    }

    if (recoveredCount === 0) return false;

    await this.db.setPluginConfig(
      OSCILLATION_BY_VEHICLE_KEY,
      JSON.stringify(byVehicleState),
    );

    const remainingPaused = Object.entries(byVehicleState).filter(
      ([, entry]) => entry.paused,
    );
    if (remainingPaused.length === 0) {
      // Exclude the safety STOP and all history during the pause from the next window.
      await this.db.setConfig("oscillation_trip_at", lastReleasedAt);
      await this.db.setConfig("oscillation_paused", "false");
      await this.db.setConfig("system_alert", "");
    } else {
      const [nextVehicleId, nextEntry] = remainingPaused[0];
      await this.db.setConfig("oscillation_trip_at", nextEntry.tripAt);
      if (nextEntry.alertMessage) {
        const alert: SystemAlert = {
          message: nextEntry.alertMessage,
          timestamp: new Date().toISOString(),
          vehicleId: nextVehicleId,
          vehicleName: nextEntry.vehicleName,
        };
        await this.db.setConfig("system_alert", JSON.stringify(alert));
      }
    }
    return true;
  }

  private async trip(
    vehicleId: string,
    vehicleName: string,
    cycles: number,
    byVehicleState: Record<string, VehicleOscillationState>,
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
    const tripAt = new Date().toISOString().replace("T", " ").replace(
      /\.\d+Z$/,
      "",
    );
    await this.db.setConfig("oscillation_trip_at", tripAt);
    const alert: SystemAlert = {
      message:
        `Safety pause: ${vehicleName} had ${cycles} start/stop cycles in ${WINDOW_MINUTES} minutes, which may indicate oscillation.${stopFailure} Your Automatic charging switch is unchanged. Automatic recovery is checked after five minutes, once the vehicle is confirmed stopped. Charging resumes only if your switch is ON and normal regulation permits it.`,
      timestamp: new Date().toISOString(),
      vehicleId,
      vehicleName,
    };
    await this.db.setConfig("system_alert", JSON.stringify(alert));

    byVehicleState[vehicleId] = {
      paused: true,
      tripAt,
      vehicleName,
      alertMessage: alert.message,
    };
    await this.db.setPluginConfig(
      OSCILLATION_BY_VEHICLE_KEY,
      JSON.stringify(byVehicleState),
    );

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
