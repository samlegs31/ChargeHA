import { schedulesOverlap } from "../../../shared/engine/ScheduleOverlap.ts";
import { ServiceError } from "../lib/ServiceError.ts";
import type { DayOfWeek } from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { Logger } from "../lib/Logger.ts";
import { isScheduleActiveNow } from "@chargeha/shared/engine";

function rowToSchedule(
  row: {
    id: string;
    vehicleId: string | null;
    scheduleType: string;
    startTime: string;
    endTime: string;
    days: string[];
    chargeAmps: number | null;
    chargeLimitPct: number | null;
    enabled: boolean;
  },
) {
  if (row.scheduleType === "charge") {
    return {
      id: row.id,
      vehicleId: row.vehicleId as string,
      scheduleType: row.scheduleType as "charge",
      startTime: row.startTime,
      endTime: row.endTime,
      days: row.days as DayOfWeek[],
      chargeAmps: row.chargeAmps as number,
      chargeLimitPct: row.chargeLimitPct as number,
      enabled: row.enabled,
    };
  }
  return {
    id: row.id,
    vehicleId: null,
    scheduleType: row.scheduleType as "blockout",
    startTime: row.startTime,
    endTime: row.endTime,
    days: row.days as DayOfWeek[],
    enabled: row.enabled,
  };
}

export class ScheduleService {
  private writeQueue: Promise<unknown> = Promise.resolve();
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(action, action);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }
  create(input: Parameters<ScheduleService["createUnlocked"]>[0]) {
    return this.serialize(() => this.createUnlocked(input));
  }
  update(input: Parameters<ScheduleService["updateUnlocked"]>[0]) {
    return this.serialize(() => this.updateUnlocked(input));
  }
  constructor(
    private db: AppDatabase,
    private logger: Logger,
  ) {}

  async list() {
    const rows = await this.db.getSchedules();
    return { schedules: rows.map(rowToSchedule) };
  }

  /** Return schedules that are currently active based on the configured timezone. */
  async getActiveSchedules() {
    const timezone = await this.getTimezone();
    const rows = await this.db.getSchedules();
    const now = new Date();
    return rows
      .filter((s) => s.enabled && isScheduleActiveNow(s, now, timezone))
      .map(rowToSchedule);
  }

  /** Active charge schedule for a specific vehicle right now, or null.
   *  Blockouts are excluded — they're not vehicle charge targets. */
  async getActiveChargeForVehicle(vehicleId: string) {
    const active = await this.getActiveSchedules();
    const found = active.find(
      (s) => s.scheduleType === "charge" && s.vehicleId === vehicleId,
    );
    return found && found.scheduleType === "charge" ? found : null;
  }

  private async getTimezone(): Promise<string> {
    return (await this.db.getConfig("timezone")) ?? "UTC";
  }

  private async createUnlocked(input: {
    scheduleType: "charge" | "blockout";
    vehicleId?: string | null;
    startTime: string;
    endTime: string;
    days: DayOfWeek[];
    chargeAmps?: number | null;
    chargeLimitPct?: number | null;
  }) {
    // Additional validation for charge schedules
    if (input.scheduleType === "charge") {
      if (!input.vehicleId) {
        throw new ServiceError(
          "vehicleId is required for charge schedules",
          "BAD_REQUEST",
        );
      }
      if (!input.chargeAmps || input.chargeAmps < 1) {
        throw new ServiceError(
          "chargeAmps must be a positive number",
          "BAD_REQUEST",
        );
      }
      if (
        !input.chargeLimitPct || input.chargeLimitPct < 1 ||
        input.chargeLimitPct > 100
      ) {
        throw new ServiceError(
          "chargeLimitPct must be between 1 and 100",
          "BAD_REQUEST",
        );
      }
    }

    await this.assertNoOverlap(input);

    const id = crypto.randomUUID();
    const isCharge = input.scheduleType === "charge";
    await this.db.createSchedule({
      id,
      vehicleId: isCharge ? (input.vehicleId ?? null) : null,
      scheduleType: input.scheduleType,
      startTime: input.startTime,
      endTime: input.endTime,
      days: input.days,
      chargeAmps: isCharge ? (input.chargeAmps ?? null) : null,
      chargeLimitPct: isCharge ? (input.chargeLimitPct ?? null) : null,
    });

    const row = await this.db.getSchedule(id);
    if (!row) {
      throw new ServiceError(
        "Failed to create schedule",
        "INTERNAL_SERVER_ERROR",
      );
    }

    this.logger.info(`Schedule created: ${input.scheduleType} (${id})`);
    return { schedule: rowToSchedule(row) };
  }

  private async updateUnlocked(input: {
    id: string;
    vehicleId?: string | null;
    scheduleType?: "charge" | "blockout";
    startTime?: string;
    endTime?: string;
    days?: DayOfWeek[];
    chargeAmps?: number | null;
    chargeLimitPct?: number | null;
    enabled?: boolean;
  }) {
    const existing = await this.db.getSchedule(input.id);
    if (!existing) {
      throw new ServiceError("Schedule not found", "NOT_FOUND");
    }

    if (
      input.enabled !== false &&
      (input.enabled === true || input.startTime !== undefined ||
        input.endTime !== undefined || input.days !== undefined ||
        input.vehicleId !== undefined || input.scheduleType !== undefined)
    ) {
      await this.assertNoOverlap({ ...existing, ...input }, input.id);
    }

    await this.db.updateSchedule(input.id, {
      vehicleId: input.vehicleId,
      scheduleType: input.scheduleType,
      startTime: input.startTime,
      endTime: input.endTime,
      days: input.days,
      chargeAmps: input.chargeAmps,
      chargeLimitPct: input.chargeLimitPct,
      enabled: input.enabled,
    });

    const row = await this.db.getSchedule(input.id);
    if (!row) {
      throw new ServiceError(
        "Schedule not found after update",
        "INTERNAL_SERVER_ERROR",
      );
    }

    this.logger.info(`Schedule updated: ${row.scheduleType} (${input.id})`);
    return { schedule: rowToSchedule(row) };
  }

  private async assertNoOverlap(input: {
    scheduleType: string;
    vehicleId?: string | null;
    startTime: string;
    endTime: string;
    days: readonly string[];
  }, excludeId?: string) {
    if (input.scheduleType !== "charge") return;
    const rows = await this.db.getSchedules();
    if (
      rows.some((row) =>
        row.id !== excludeId && row.scheduleType === "charge" &&
        row.vehicleId === input.vehicleId && schedulesOverlap(input, row)
      )
    ) {
      throw new ServiceError(
        "This schedule overlaps with an existing charge schedule for the same vehicle.",
        "BAD_REQUEST",
      );
    }
  }

  async delete(id: string) {
    const existing = await this.db.getSchedule(id);
    if (!existing) {
      throw new ServiceError("Schedule not found", "NOT_FOUND");
    }

    await this.db.deleteSchedule(id);
    this.logger.info(`Schedule deleted: ${id}`);
    return { success: true };
  }
}
