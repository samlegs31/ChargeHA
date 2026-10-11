import { assert, assertEquals } from "@std/assert";
import { runSimulation } from "./run.ts";
import { computeVehicleStats } from "./stats.ts";
import type { SimulationOptions } from "./types.ts";

for (const peakSolarKw of [0, 6]) {
  Deno.test(`UI simulator has deterministic bounded output at ${peakSolarKw} kW`, () => {
    const options: SimulationOptions = {
      seed: 8731,
      vehicleMode: "auto",
      scheduleEnabled: false,
      scheduleStart: "00:00",
      scheduleEnd: "01:00",
      scheduleAmps: 8,
      scheduleTargetPct: 80,
      vehicleCount: 2,
      waterfall: false,
      minGenKw: "0.2",
      graceMin: "3",
      cooldownMin: "2",
      peakSolarKw,
      minExcessKw: "0",
      cloudiness: 0.4,
      storms: 1,
      homeLoad: 600,
      sunrise: 6,
      sunset: 18,
      ev1Start: 20,
      ev2Start: 40,
      ev1CapacityKwh: 75,
      ev2CapacityKwh: 60,
      batteryCapacityKwh: 10,
      batteryMaxRateKw: 3,
      batteryStartSoc: 50,
      batteryPriorityEnabled: true,
      batteryPriorityLimit: 60,
    };
    const output = runSimulation(options);
    assertEquals(output, runSimulation(options));
    assertEquals(output.results.length, 1440);
    for (const row of output.results) {
      assert(Number.isFinite(row.gridW));
      assert(row.batterySoc >= 0 && row.batterySoc <= 100);
      for (const vehicle of row.vehicles) {
        assert(Number.isInteger(vehicle.chargeAmps));
        assert(vehicle.chargeAmps >= 0 && vehicle.chargeAmps <= 32);
        assert(vehicle.batteryLevel >= 0 && vehicle.batteryLevel <= 100);
        if (!peakSolarKw) assertEquals(vehicle.isCharging, false);
      }
    }
    const stats = computeVehicleStats(output.results, ["Friday", "Other"]);
    for (const [index, value] of stats.entries()) {
      assertEquals(
        value.chargingMinutes,
        output.results.filter((r) => r.vehicles[index].isCharging).length,
      );
      assertEquals(
        value.totalCalls,
        value.starts + value.stops + value.ampChanges,
      );
      if (!peakSolarKw) assertEquals(value.totalCalls, 0);
    }
    if (peakSolarKw) assert(stats.some((value) => value.chargingMinutes > 0));
  });
}
