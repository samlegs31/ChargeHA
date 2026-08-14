import type { DayOfWeek } from "../types.ts";
import type { EngineSchedule } from "./types.ts";

const DAY_MAP: Record<string, DayOfWeek> = {
  "0": "sun",
  "1": "mon",
  "2": "tue",
  "3": "wed",
  "4": "thu",
  "5": "fri",
  "6": "sat",
};

const WEEKDAY_TO_DAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function parseTimezone(
  now: Date,
  timezone: string,
): { day: number; hours: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  return {
    day: WEEKDAY_TO_DAY[
      parts.find((p) => p.type === "weekday")?.value ?? ""
    ] ?? now.getDay(),
    hours: Number(parts.find((p) => p.type === "hour")?.value ?? 0),
    minutes: Number(parts.find((p) => p.type === "minute")?.value ?? 0),
  };
}

/** Check whether a schedule is active at the given time. */
export function isScheduleActiveNow(
  schedule: EngineSchedule,
  now: Date,
  timezone: string,
): boolean {
  // Get the current time in the configured timezone (schedules are defined
  // in the user's timezone, not the server's local time)
  const { day, hours, minutes } = timezone
    ? parseTimezone(now, timezone)
    : { day: now.getDay(), hours: now.getHours(), minutes: now.getMinutes() };

  const dayKey = DAY_MAP[String(day)];

  // Parse time strings
  const currentMinutes = hours * 60 + minutes;
  const [startH, startM] = schedule.startTime.split(":").map(Number);
  const [endH, endM] = schedule.endTime.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Normal range: the current calendar day must be selected.
    return schedule.days.includes(dayKey) &&
      currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // Overnight range (e.g. Monday 22:00 - Tuesday 06:00).
  // Before midnight, the window belongs to the current day. After midnight,
  // it belongs to the previous day — the day on which the schedule started.
  if (currentMinutes >= startMinutes) {
    return schedule.days.includes(dayKey);
  }
  if (currentMinutes < endMinutes) {
    const previousDay = DAY_MAP[String((day + 6) % 7)];
    return schedule.days.includes(previousDay);
  }
  return false;
}
