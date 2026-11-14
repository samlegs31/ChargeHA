import { sql } from "drizzle-orm";

const formatters = new Map<string, Intl.DateTimeFormat>();
export function timezoneOffsetAt(time: number, zone: string): number {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, format);
  }
  const p = Object.fromEntries(
    format.formatToParts(new Date(time)).map((p) => [p.type, p.value]),
  );
  return (Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour,
    +p.minute,
    +p.second,
  ) - Math.floor(time / 1000) * 1000) / 3600000;
}

const cache = new Map<string, ReturnType<typeof sql>>();
/** SQLite modifier selected using each row's UTC timestamp, not today's offset. */
export function timezoneModifier(zone: string, year: number) {
  if (!Number.isInteger(year) || year < 1900 || year > 9998) {
    throw new Error("Invalid statistics year");
  }
  const key = `${zone}/${year}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const begin = Date.UTC(year, 0, -1), end = Date.UTC(year + 1, 0, 3);
  let previous = timezoneOffsetAt(begin, zone);
  const initial = `${previous} hours`;
  const changes: { time: string; offset: string }[] = [];
  const step = 6 * 3600000;
  for (let time = begin + step; time <= end; time += step) {
    const next = timezoneOffsetAt(time, zone);
    if (next === previous) continue;
    let lo = time - step, hi = time;
    while (hi - lo > 1000) {
      const mid = Math.floor((lo + hi) / 2000) * 1000;
      if (timezoneOffsetAt(mid, zone) === previous) lo = mid;
      else hi = mid;
    }
    changes.push({
      time: new Date(hi).toISOString().slice(0, 19).replace("T", " "),
      offset: `${next} hours`,
    });
    previous = next;
  }
  const modifier = changes.length
    ? sql`CASE ${
      sql.join(
        changes.reverse().map((c) =>
          sql`WHEN timestamp >= ${c.time} THEN ${c.offset}`
        ),
        sql` `,
      )
    } ELSE ${initial} END`
    : sql`${initial}`;
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, modifier);
  return modifier;
}

export function timezoneMidnight(date: string, zone: string): number {
  const wall = Date.parse(`${date}T00:00:00Z`);
  let instant = wall;
  for (let i = 0; i < 6; i++) {
    const next = wall - timezoneOffsetAt(instant, zone) * 3600000;
    if (next === instant) return next;
    instant = next;
  }
  throw new Error(
    `Local midnight is ambiguous or unavailable: ${date} (${zone})`,
  );
}
