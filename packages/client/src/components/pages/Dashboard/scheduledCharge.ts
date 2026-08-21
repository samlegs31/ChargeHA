import type {
  ChargeSchedule,
  DayOfWeek,
  Schedule,
  VehicleMode,
} from "@chargeha/shared";
import { isScheduleActiveNow } from "@chargeha/shared/engine";

export interface ScheduledChargeDisplay {
  scheduleId: string;
  status: "active" | "upcoming" | "inactive_mode";
  title: string;
  detail: string;
}

const DAY_INDEX: Record<DayOfWeek, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface ZonedClock {
  day: number;
  minutes: number;
}

function clockInTimezone(now: Date, timezone: string): ZonedClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: WEEKDAY_INDEX[value("weekday")] ?? now.getDay(),
    minutes: Number(value("hour")) % 24 * 60 + Number(value("minute")),
  };
}

function timeMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function nextDayOffset(
  schedule: ChargeSchedule,
  clock: ZonedClock,
): number {
  const startMinutes = timeMinutes(schedule.startTime);
  return schedule.days
    .map((day) => (DAY_INDEX[day] - clock.day + 7) % 7)
    .map((offset) => offset === 0 && startMinutes <= clock.minutes ? 7 : offset)
    .reduce((smallest, offset) => Math.min(smallest, offset), 7);
}

function scheduledTitle(
  status: ScheduledChargeDisplay["status"],
  dayOffset: number,
  clock: ZonedClock,
): string {
  if (status === "active") return "Programmed charge in progress";
  if (status === "inactive_mode") return "Programmed charge is saved";
  if (dayOffset === 0) return "Charge programmed for today";
  if (dayOffset === 1) return "Charge programmed for tomorrow";
  return `Charge programmed for ${DAY_LABELS[(clock.day + dayOffset) % 7]}`;
}

function scheduledDetail(
  schedule: ChargeSchedule,
  status: ScheduledChargeDisplay["status"],
): string {
  if (status === "active") {
    return `Until ${schedule.endTime} · Target ${schedule.chargeLimitPct}%`;
  }
  const window =
    `${schedule.startTime}–${schedule.endTime} · Target ${schedule.chargeLimitPct}%`;
  return status === "inactive_mode"
    ? `${window} · Turn on Smart Charge`
    : window;
}

function chargeSchedulesForVehicle(
  schedules: Schedule[],
  vehicleId: string,
): ChargeSchedule[] {
  return schedules.filter((schedule): schedule is ChargeSchedule =>
    schedule.scheduleType === "charge" && schedule.enabled &&
    schedule.vehicleId === vehicleId && schedule.days.length > 0
  );
}

function displayStatus(
  mode: VehicleMode,
  active: boolean,
): ScheduledChargeDisplay["status"] {
  if (mode !== "auto") return "inactive_mode";
  return active ? "active" : "upcoming";
}

export function getScheduledChargeDisplay(
  schedules: Schedule[],
  vehicleId: string,
  mode: VehicleMode,
  now: Date,
  timezone: string,
): ScheduledChargeDisplay | null {
  const clock = clockInTimezone(now, timezone);
  const candidates = chargeSchedulesForVehicle(schedules, vehicleId)
    .map((schedule) => ({
      schedule,
      active: isScheduleActiveNow(schedule, now, timezone),
      dayOffset: nextDayOffset(schedule, clock),
      startMinutes: timeMinutes(schedule.startTime),
    }));
  const selected = candidates.reduce<(typeof candidates)[number] | null>(
    (best, candidate) => {
      if (!best) return candidate;
      if (best.active) return best;
      if (candidate.active) return candidate;
      if (candidate.dayOffset !== best.dayOffset) {
        return candidate.dayOffset < best.dayOffset ? candidate : best;
      }
      return candidate.startMinutes < best.startMinutes ? candidate : best;
    },
    null,
  );
  if (!selected) return null;

  const status = displayStatus(mode, selected.active);
  return {
    scheduleId: selected.schedule.id,
    status,
    title: scheduledTitle(status, selected.dayOffset, clock),
    detail: scheduledDetail(selected.schedule, status),
  };
}
