import { assertEquals } from "@std/assert";
import { parseSolarArrays } from "./forecast.ts";

Deno.test("parseSolarArrays accepts multiple panel orientations", () => {
  assertEquals(
    parseSolarArrays(JSON.stringify([
      { name: "South", capacityKwp: 4.15, azimuthDeg: 180, tiltDeg: 18 },
      { name: "South-West", capacityKwp: 3.9, azimuthDeg: 205, tiltDeg: 18 },
    ])).length,
    2,
  );
});

Deno.test("parseSolarArrays rejects invalid panel data", () => {
  assertEquals(
    parseSolarArrays(JSON.stringify([
      { name: "Bad", capacityKwp: -1, azimuthDeg: 180, tiltDeg: 18 },
    ])),
    [],
  );
});
