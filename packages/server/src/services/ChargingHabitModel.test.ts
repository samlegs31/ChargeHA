import { assert, assertEquals } from "@std/assert";
import {
  emptyHabits,
  estimateHabit,
  observeHabit,
  parseHabits,
} from "./ChargingHabitModel.ts";

Deno.test("habits learn weekly plug windows, persist, deduplicate and adapt to new habits", () => {
  const model = emptyHabits("Europe/Paris");
  const start = Date.UTC(2026, 0, 5, 12);
  const week = 7 * 24 * 3600_000;
  assertEquals(
    estimateHabit(model, "Friday", new Date(start), "high_pv", 70).probability,
    null,
  );
  for (let i = 0; i < 12; i++) {
    const at = new Date(start + i * week);
    assert(observeHabit(model, "Friday", at, true, "high_pv", 70));
    assertEquals(observeHabit(model, "Friday", at, false, "low_pv", 20), false);
  }
  // Fixed local hour before the DST change, then explicit UTC model for adaptation.
  const parsed = parseHabits(JSON.stringify(model), "Europe/Paris");
  assertEquals(parsed, model);
  assertEquals(
    estimateHabit(parsed, "Other", new Date(start), "high_pv", 70).probability,
    null,
  );
  assert(
    (estimateHabit(parsed, "Friday", new Date(start), "high_pv", 70)
      .probability ?? 0) > 0.8,
  );
  assertEquals(
    Object.keys(parseHabits(JSON.stringify(model), "UTC").vehicles).length,
    0,
  );
  const adaptive = emptyHabits("UTC");
  for (let i = 0; i < 48; i++) {
    observeHabit(
      adaptive,
      "Friday",
      new Date(start + i * week),
      i < 16,
      "low_pv",
      20,
    );
  }
  assert(
    (estimateHabit(adaptive, "Friday", new Date(start), "low_pv", 20)
      .probability ?? 1) < 0.3,
  );
});

Deno.test("habit memory rejects malformed data and stays bounded", () => {
  const model = emptyHabits("UTC");
  const start = Date.UTC(2026, 0, 5);
  for (let v = 0; v < 20; v++) {
    for (let hour = 0; hour < 350; hour++) {
      observeHabit(
        model,
        `V${v}`,
        new Date(start + hour * 3600_000),
        hour % 2 === 0,
        "unknown",
        null,
      );
    }
  }
  assertEquals(Object.keys(model.vehicles).length, 16);
  assert(
    Object.values(model.vehicles).every((v) =>
      Object.keys(v.hours).length <= 168
    ),
  );
  assertEquals(
    observeHabit(model, "__proto__", new Date(start), true, "unknown", null),
    false,
  );
  assertEquals(parseHabits("{broken", "UTC"), emptyHabits("UTC"));
  assertEquals(
    parseHabits(
      JSON.stringify({
        version: 1,
        timezone: "UTC",
        vehicles: {
          Friday: {
            lastSlot: 1,
            hours: { "Mon:00": { samples: 1, plugged: 50 } },
            contexts: {},
          },
        },
      }),
      "UTC",
    ).vehicles.Friday.hours,
    {},
  );
});

Deno.test("connection estimates incorporate observed weather and home battery contexts", () => {
  const model = emptyHabits("UTC");
  const start = Date.UTC(2026, 0, 5, 12);
  for (let week = 0; week < 32; week++) {
    const favorable = week % 2 === 0;
    observeHabit(
      model,
      "Friday",
      new Date(start + week * 7 * 24 * 3600_000),
      favorable,
      favorable ? "high_pv" : "low_pv",
      favorable ? 80 : 20,
    );
  }
  const at = new Date(start);
  const high = estimateHabit(model, "Friday", at, "high_pv", 80);
  const low = estimateHabit(model, "Friday", at, "low_pv", 20);
  assert(high.probability !== null && low.probability !== null);
  assert(high.probability - low.probability >= 0.1);
});
