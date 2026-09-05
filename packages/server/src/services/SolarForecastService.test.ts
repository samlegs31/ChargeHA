import { assertAlmostEquals, assertEquals } from "@std/assert";
import { buildVehicleChargeState } from "@chargeha/shared/test-factories";
import type { ControllerConfig } from "@chargeha/shared/engine";
import {
  applySubscribedPowerLimit,
  forecastSchedules,
  integrateRemainingPvKwh,
  nextHomeBatterySoc,
  openMeteoTimeToDate,
  panelAgeFactor,
  resolveInverterCapW,
  toOpenMeteoAzimuth,
  usableLiveSolarPowerW,
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

Deno.test("SolarForecastService uses Unix Open-Meteo timestamps without DST offset math", () => {
  const epochSeconds = 1_793_058_300;
  const parsed = openMeteoTimeToDate(epochSeconds, 7_200);
  assertEquals(
    parsed.toISOString(),
    new Date(epochSeconds * 1000).toISOString(),
  );
});

Deno.test("SolarForecastService keeps legacy local timestamps as a safe fallback", () => {
  const parsed = openMeteoTimeToDate("2026-08-24T14:00", 7_200);
  assertEquals(parsed.toISOString(), "2026-08-24T12:00:00.000Z");
});

Deno.test("SolarForecastService ignores stale or invalid live solar readings", () => {
  const now = new Date("2026-08-24T12:10:00Z");
  assertEquals(
    usableLiveSolarPowerW({
      solarProductionW: 4_200,
      lastUpdated: "2026-08-24T12:09:30Z",
    }, now),
    4_200,
  );
  assertEquals(
    usableLiveSolarPowerW({
      solarProductionW: 4_200,
      lastUpdated: "2026-08-24T12:03:00Z",
    }, now),
    null,
  );
  assertEquals(
    usableLiveSolarPowerW({
      solarProductionW: Number.NaN,
      lastUpdated: "2026-08-24T12:09:30Z",
    }, now),
    null,
  );
  assertEquals(
    usableLiveSolarPowerW({
      solarProductionW: -1,
      lastUpdated: "2026-08-24T12:09:30Z",
    }, now),
    null,
  );
});

Deno.test("SolarForecastService ignores Fronius offline all-zero live sentinel", () => {
  const now = new Date("2026-08-24T12:10:00Z");
  assertEquals(
    usableLiveSolarPowerW({
      solarProductionW: 0,
      gridPowerW: 0,
      homeConsumptionW: 0,
      batteryPowerW: null,
      batterySoc: null,
      lastUpdated: "2026-08-24T12:09:30Z",
    }, now),
    null,
  );
  assertEquals(
    usableLiveSolarPowerW({
      solarProductionW: 0,
      gridPowerW: 350,
      homeConsumptionW: 350,
      batteryPowerW: null,
      batterySoc: null,
      lastUpdated: "2026-08-24T12:09:30Z",
    }, now),
    0,
  );
});

Deno.test("SolarForecastService integrates only the remaining part of the current 15 minute interval", () => {
  const points = [
    { at: new Date("2026-08-24T12:15:00Z"), powerW: 4_000 },
    { at: new Date("2026-08-24T12:30:00Z"), powerW: 4_000 },
  ];
  const remaining = integrateRemainingPvKwh(
    points,
    new Date("2026-08-24T12:07:00Z"),
  );
  assertAlmostEquals(remaining, 4 * 23 / 60, 0.0001);
});

Deno.test("SolarForecastService clips production to the configured inverter", () => {
  assertEquals(resolveInverterCapW(8_500, 4_000, 6), 6_000);
});

Deno.test("SolarForecastService keeps a lower learned production ceiling", () => {
  assertEquals(resolveInverterCapW(8_500, 5_000, null), 5_150);
});

Deno.test("SolarForecastService treats the configured inverter limit as authoritative", () => {
  assertEquals(resolveInverterCapW(8_500, 5_000, 6), 6_000);
});

Deno.test("SolarForecastService updates configured home battery SOC", () => {
  const battery = {
    capacityKwh: 7.68,
    maxChargeW: 6_000,
    maxDischargeW: 6_000,
    roundTripEfficiency: 0.96,
  };
  const afterCharge = nextHomeBatterySoc(50, -6_000, battery);
  const afterDischarge = nextHomeBatterySoc(50, 6_000, battery);
  assertAlmostEquals(afterCharge ?? 0, 51.2758, 0.001);
  assertAlmostEquals(afterDischarge ?? 0, 48.6711, 0.001);
});

Deno.test("SolarForecastService limits vehicle charging to subscribed power", () => {
  const state = {
    isCharging: true,
    chargeAmps: 32,
    chargeAmpsMin: 5,
    chargeAmpsMax: 32,
    chargePowerKw: 7.36,
  } as Parameters<typeof applySubscribedPowerLimit>[0];
  const limited = applySubscribedPowerLimit(
    state,
    { voltage: 230, phases: 1 },
    9_000,
    2_000,
    0,
    0,
  );

  assertEquals(limited.chargeAmps, 30);
  assertAlmostEquals(limited.chargePowerKw, 6.9, 0.001);
});

Deno.test("SolarForecastService stops below the vehicle minimum amps", () => {
  const state = {
    isCharging: true,
    chargeAmps: 16,
    chargeAmpsMin: 5,
    chargeAmpsMax: 32,
    chargePowerKw: 3.68,
  } as Parameters<typeof applySubscribedPowerLimit>[0];
  const limited = applySubscribedPowerLimit(
    state,
    { voltage: 230, phases: 1 },
    3_000,
    2_500,
    0,
    0,
  );

  assertEquals(limited.isCharging, false);
  assertEquals(limited.chargeAmps, 0);
});

Deno.test("SolarForecastService reuses named off-peak tariff hours", () => {
  const controllerConfig: ControllerConfig = {
    chargingEnabled: true,
    controllerLoopSeconds: 30,
    solarTrackingEnabled: true,
    solarTrackingMode: "solar_only",
    solarReference: "excess",
    solarMarginKw: 0,
    minSolarGenerationKw: 0,
    minExcessSolarKw: null,
    gridVoltage: 230,
    threePhaseCharger: false,
    consumptionExcludesCharging: false,
    gracePeriodMinutes: 5,
    cooldownPeriodMinutes: 5,
    batteryPriorityEnabled: false,
    batteryPriorityLimit: 80,
    batteryDischargeToleranceW: 300,
    batteryDischargeGraceMinutes: 5,
    priorityChargingEnabled: false,
    timezone: "Europe/Paris",
    ampDebounceThreshold: 1,
    ampDebounceSettleMinutes: 1,
  };
  const schedules = forecastSchedules({
    configured: [],
    tariffPeriods: [{
      id: 7,
      label: "Heures creuses",
      startTime: "01:30",
      endTime: "07:30",
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      ratePerKwh: 0.16,
      enabled: true,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
    }],
    vehicleId: "VIN-TEST",
    state: buildVehicleChargeState({ chargeAmpsMax: 32 }),
    controllerConfig,
    subscribedPowerKva: 9,
    baseLoadW: 2_000,
  });

  assertEquals(schedules.length, 1);
  assertEquals(schedules[0].startTime, "01:30");
  assertEquals(schedules[0].endTime, "07:30");
  assertEquals(schedules[0].chargeAmps, 30);
});

Deno.test("SolarForecastService ignores a single flat tariff period", () => {
  const controllerConfig: ControllerConfig = {
    chargingEnabled: true,
    controllerLoopSeconds: 30,
    solarTrackingEnabled: true,
    solarTrackingMode: "solar_only",
    solarReference: "excess",
    solarMarginKw: 0,
    minSolarGenerationKw: 0,
    minExcessSolarKw: null,
    gridVoltage: 230,
    threePhaseCharger: false,
    consumptionExcludesCharging: false,
    gracePeriodMinutes: 5,
    cooldownPeriodMinutes: 5,
    batteryPriorityEnabled: false,
    batteryPriorityLimit: 80,
    batteryDischargeToleranceW: 300,
    batteryDischargeGraceMinutes: 5,
    priorityChargingEnabled: false,
    timezone: "Europe/Paris",
    ampDebounceThreshold: 1,
    ampDebounceSettleMinutes: 1,
  };
  const schedules = forecastSchedules({
    configured: [],
    tariffPeriods: [{
      id: 8,
      label: "Tarif unique",
      startTime: "00:00",
      endTime: "00:00",
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      ratePerKwh: 0.22,
      enabled: true,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
    }],
    vehicleId: "VIN-TEST",
    state: buildVehicleChargeState(),
    controllerConfig,
    subscribedPowerKva: 9,
    baseLoadW: 2_000,
  });

  assertEquals(schedules, []);
});
