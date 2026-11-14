import type { DayOfWeek } from "../types.ts";

type Window = { startTime: string; endTime: string; days: readonly string[] };
const days: readonly DayOfWeek[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];
function intervals(window: Window): number[][] {
  const minutes = (time: string) => {
    const [hours, mins] = time.split(":").map(Number);
    return hours * 60 + mins;
  };
  const start = minutes(window.startTime), end = minutes(window.endTime);
  if (start === end) return [];
  return window.days.flatMap((day) => {
    const base = days.indexOf(day as DayOfWeek) * 1440;
    const finish = base + end + (end < start ? 1440 : 0);
    return finish <= 10080
      ? [[base + start, finish]]
      : [[base + start, 10080], [0, finish - 10080]];
  });
}

/** Half-open intervals on the week, including an overnight Sunday window. */
export function schedulesOverlap(first: Window, second: Window): boolean {
  return intervals(first).some(([a, b]) =>
    intervals(second).some(([c, d]) => a < d && c < b)
  );
}
