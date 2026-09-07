import type { EngineSchedule } from "@chargeha/shared/engine";
import { isScheduleActiveNow } from "@chargeha/shared/engine";
import type { ConfigRepository } from "../db/repositories/ConfigRepository.ts";

const KEY = "runtime.battery_schedule_blocks_v1";

/** Persist only the current occurrence: tomorrow's schedule must start clean. */
export class BatteryScheduleMemory {
  private loaded = false;
  private saved = "";
  constructor(
    private readonly config: Pick<ConfigRepository, "getConfig" | "setConfig">,
  ) {}

  async restore(
    keys: Set<string>,
    schedules: EngineSchedule[],
    now: Date,
    timezone: string,
  ): Promise<void> {
    if (this.loaded) return;
    const raw = await this.config.getConfig(KEY);
    const data = parseBlocks(raw);
    Object.entries(data).reduce((result, [key, occurrence]) => {
      const schedule = schedules.find((s) => s.id === key.split("\u0000")[1]);
      if (
        schedule && occurrence === activeOccurrence(schedule, now, timezone)
      ) result.add(key);
      return result;
    }, keys);
    this.loaded = true;
  }

  async persist(
    keys: Set<string>,
    schedules: EngineSchedule[],
    now: Date,
    timezone: string,
  ): Promise<void> {
    const entries = [...keys].flatMap((key) => {
      const schedule = schedules.find((s) => s.id === key.split("\u0000")[1]);
      const occurrence = schedule
        ? activeOccurrence(schedule, now, timezone)
        : null;
      return occurrence ? [[key, occurrence]] : [];
    });
    const serialized = JSON.stringify(Object.fromEntries(entries));
    if (serialized === this.saved) return;
    await this.config.setConfig(KEY, serialized);
    this.saved = serialized;
  }
}

function parseBlocks(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => typeof v === "string"),
    );
  } catch {
    return {};
  }
}

export function activeOccurrence(
  schedule: EngineSchedule,
  now: Date,
  timezone: string,
): string | null {
  if (!schedule.enabled || !isScheduleActiveNow(schedule, now, timezone)) {
    return null;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  const localTime = `${value("hour")}:${value("minute")}`;
  const previousDay = schedule.startTime > schedule.endTime &&
    localTime < schedule.endTime;
  const date = new Date(
    Date.UTC(
      Number(value("year")),
      Number(value("month")) - 1,
      Number(value("day")) - Number(previousDay),
    ),
  );
  return `${
    date.toISOString().slice(0, 10)
  }:${schedule.startTime}:${schedule.endTime}:${timezone}`;
}
