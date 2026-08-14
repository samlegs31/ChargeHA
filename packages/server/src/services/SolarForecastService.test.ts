import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  panelAgeFactor,
  toOpenMeteoAzimuth,
} from "./SolarForecastService.ts";

Deno.test("SolarForecastService converts standard panel azimuth to Open-Meteo convention", () => {
  assertEquals(toOpenMeteoAzimuth(180), 0);
  assertEquals(toOpenMeteoAzimuth(205), 25);
  assertEquals(toOpenMeteoAzimuth(90), -90);
  assertEquals(toOpenMeteoAzimuth(270), 90);
});

Deno.test("SolarForecastService applies 0.5 percent annual degradation", () => {
  const installed = "2025-01-01";
  const oneYearLater = new Date("2026-01-01T00:00:00Z");
  assertAlmostEquals(panelAgeFactor(installed, oneYearLater), 0.995, 0.0001);
});
