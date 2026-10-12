/** Bounded local statistics; observations never issue a vehicle command. */
export type HabitWeather = "low_pv" | "high_pv" | "unknown";
interface Bucket {
  samples: number;
  plugged: number;
}
interface VehicleHabit {
  lastSlot: number;
  hours: Record<string, Bucket>;
  contexts: Record<string, Bucket>;
}
export interface HabitState {
  version: 1;
  timezone: string;
  vehicles: Record<string, VehicleHabit>;
}
export interface HabitEstimate {
  probability: number | null;
  samples: number;
  confidence: "learning" | "low" | "medium";
}
const MAX_VEHICLES = 16;
const SLOT_MS = 60 * 60_000;

export function emptyHabits(timezone: string): HabitState {
  return { version: 1, timezone, vehicles: {} };
}
function hourKey(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "UTC",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  return `${parts.find((p) => p.type === "weekday")!.value}:${
    parts.find((p) => p.type === "hour")!.value
  }`;
}
function contextKey(weather: HabitWeather, batterySoc: number | null): string {
  return `${weather}:${
    batterySoc === null || !Number.isFinite(batterySoc)
      ? "unknown"
      : batterySoc < 50
      ? "low"
      : "high"
  }`;
}
function update(bucket: Bucket | undefined, plugged: boolean): Bucket {
  const weight = bucket && bucket.samples >= 16 ? 15 / 16 : 1;
  return {
    samples: (bucket?.samples ?? 0) * weight + 1,
    plugged: (bucket?.plugged ?? 0) * weight + Number(plugged),
  };
}
export function observeHabit(
  state: HabitState,
  id: string,
  at: Date,
  pluggedAtHome: boolean,
  weather: HabitWeather,
  batterySoc: number | null,
): boolean {
  if (
    !id || id.length > 128 ||
    ["__proto__", "constructor", "prototype"].includes(id)
  ) return false;
  const slot = Math.floor(at.getTime() / SLOT_MS);
  if (!Number.isFinite(slot)) return false;
  let vehicle = Object.hasOwn(state.vehicles, id)
    ? state.vehicles[id]
    : undefined;
  if (vehicle && slot <= vehicle.lastSlot) return false;
  if (!vehicle) {
    if (Object.keys(state.vehicles).length >= MAX_VEHICLES) return false;
    vehicle = { lastSlot: -1, hours: {}, contexts: {} };
    state.vehicles[id] = vehicle;
  }
  const hour = hourKey(at, state.timezone);
  const context = contextKey(weather, batterySoc);
  vehicle.hours[hour] = update(vehicle.hours[hour], pluggedAtHome);
  vehicle.contexts[context] = update(vehicle.contexts[context], pluggedAtHome);
  vehicle.lastSlot = slot;
  return true;
}
export function estimateHabit(
  state: HabitState,
  id: string,
  at: Date,
  weather: HabitWeather,
  batterySoc: number | null,
): HabitEstimate {
  const vehicle = Object.hasOwn(state.vehicles, id)
    ? state.vehicles[id]
    : undefined;
  const bucket = vehicle?.hours[hourKey(at, state.timezone)];
  if (!bucket || bucket.samples < 3) {
    return {
      probability: null,
      samples: bucket?.samples ?? 0,
      confidence: "learning",
    };
  }
  const base = (bucket.plugged + 1) / (bucket.samples + 2);
  const context = vehicle?.contexts[contextKey(weather, batterySoc)];
  const adjusted = context && context.samples >= 6
    ? 0.8 * base + 0.2 * (context.plugged + 1) / (context.samples + 2)
    : base;
  return {
    probability: Math.round(adjusted * 100) / 100,
    samples: Math.floor(bucket.samples),
    confidence: bucket.samples >= 8 ? "medium" : "low",
  };
}
export function parseHabits(raw: string | null, timezone: string): HabitState {
  const empty = emptyHabits(timezone);
  if (!raw || raw.length > 600_000) return empty;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed.version !== 1 || parsed.timezone !== timezone ||
      !parsed.vehicles || typeof parsed.vehicles !== "object"
    ) return empty;
    for (
      const [id, value] of Object.entries(parsed.vehicles).slice(
        0,
        MAX_VEHICLES,
      )
    ) {
      if (
        !id || id.length > 128 ||
        ["__proto__", "constructor", "prototype"].includes(id)
      ) continue;
      const v = value as VehicleHabit;
      if (!Number.isFinite(v?.lastSlot)) continue;
      const clean = (
        input: Record<string, Bucket>,
        hours: boolean,
      ): Record<string, Bucket> => {
        const result: Record<string, Bucket> = {};
        for (
          const [key, b] of Object.entries(input ?? {}).slice(
            0,
            hours ? 168 : 9,
          )
        ) {
          const validKey = hours
            ? /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun):([01][0-9]|2[0-3])$/.test(key)
            : /^(low_pv|high_pv|unknown):(low|high|unknown)$/.test(key);
          if (
            validKey && Number.isFinite(b?.samples) && b.samples > 0 &&
            b.samples <= 16 && Number.isFinite(b.plugged) && b.plugged >= 0 &&
            b.plugged <= b.samples
          ) result[key] = { samples: b.samples, plugged: b.plugged };
        }
        return result;
      };
      empty.vehicles[id] = {
        lastSlot: v.lastSlot,
        hours: clean(v.hours, true),
        contexts: clean(v.contexts, false),
      };
    }
    return empty;
  } catch {
    return empty;
  }
}
