import type { AppDatabase } from "../db/AppDatabase.ts";
import type { Logger } from "../lib/Logger.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { EnergyPoller } from "./EnergyPoller.ts";
import type { ScheduleService } from "./ScheduleService.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type {
  EnergyData,
  VehicleChargeState,
  VehicleMode,
} from "@chargeha/shared";
import {
  ControllerEngine,
  isScheduleActiveNow,
  type ControllerConfig,
  type EngineSchedule,
} from "@chargeha/shared/engine";
import {
  parseSolarArrays,
  type SolarArrayConfig,
  type SolarChargeForecastResult,
} from "@chargeha/shared/forecast";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/meteofrance";
const PANEL_DEGRADATION_PER_YEAR = 0.005;
const BASE_SYSTEM_EFFICIENCY = 0.94;
const PANEL_TEMP_COEFFICIENT = -0.0035;
const DEFAULT_VEHICLE_CAPACITY_KWH = 60;
const FORECAST_HORIZON_HOURS = 36;

interface MeteoFranceResponse {
  utc_offset_seconds: number;
  minutely_15?: {
    time: string[];
    global_tilted_irradiance: Array<number | null>;
    temperature_2m: Array<number | null>;
  };
}

interface PvPoint {
  at: Date;
  powerW: number;
}

interface ScheduleWindowState {
  startAt: string | null;
  endAt: string | null;
  expectedFinishAt: string | null;
  amps: number;
  targetPercent: number;
  wasActive: boolean;
}

export class SolarForecastService {
  constructor(
    private db: AppDatabase,
    private configService: ConfigService,
    private vehicleManager: VehicleManager,
    private poller: EnergyPoller,
    private scheduleService: ScheduleService,
    private logger: Logger,
    private fetchFn: typeof fetch = fetch,
    private nowFn: () => Date = () => new Date(),
  ) {}

  async getTodayForecast(vehicleId: string): Promise<SolarChargeForecastResult> {
    const now = this.nowFn();
    const [forecastConfig, controllerConfig, vehicle, state, snapshot] =
      await Promise.all([
        this.configService.getSolarForecast(),
        this.loadControllerConfig(),
        this.db.vehicles.getVehicle(vehicleId),
        this.vehicleManager.getState(vehicleId),
        Promise.resolve(this.poller.tryGetRealtimeSnapshot()),
      ]);

    if (!vehicle || !state) {
      return unavailable("vehicle_not_found", "Vehicle state is unavailable.");
    }
    if (!state.isPluggedIn) {
      return unavailable("vehicle_unplugged", "Vehicle is not plugged in.");
    }
    if (state.isHome === false) {
      return unavailable(
        "vehicle_away",
        "Solar forecast is only available for charging at home.",
      );
    }
    if (vehicle.mode !== "vacation" && vehicle.mode !== "auto") {
      return unavailable(
        "unsupported_mode",
        "Forecast is only available in Solar Only and Solar + clock.",
      );
    }
    if (!snapshot || snapshot.realtime.pollFailed) {
      return unavailable("energy_unavailable", "Live energy data is unavailable.");
    }

    const arrays = parseSolarArrays(forecastConfig.solarForecastArraysJson);
    const configured = forecastConfig.solarForecastEnabled &&
      forecastConfig.solarForecastLatitude !== null &&
      forecastConfig.solarForecastLongitude !== null &&
      validInstallationDate(forecastConfig.solarForecastInstallationDate) &&
      arrays.length > 0;
    if (!configured) {
      return unavailable(
        "not_configured",
        "Configure Solar Forecast in Settings first.",
      );
    }

    const timezone = controllerConfig.timezone || "UTC";
    const weatherResult = await this.fetchPvForecast(
      forecastConfig.solarForecastLatitude as number,
      forecastConfig.solarForecastLongitude as number,
      forecastConfig.solarForecastInstallationDate,
      arrays,
      timezone,
      now,
      snapshot.realtime.solarProductionW,
    ).catch((error) => {
      this.logger.warn("Solar forecast weather fetch failed", error);
      return null;
    });
    if (!weatherResult) {
      return unavailable(
        "weather_unavailable",
        "Solar weather forecast is temporarily unavailable.",
      );
    }

    const [capacitySamples, schedulesResult] = await Promise.all([
      this.db.vehicles.getRecentCapacityCalibrationSamples(vehicleId),
      this.scheduleService.list(),
    ]);
    const capacity = estimateVehicleCapacityKwh(state, capacitySamples);
    const schedules = schedulesResult.schedules as EngineSchedule[];
    const baseLoadW = await this.estimateBaseHomeLoadW(
      snapshot.realtime,
      controllerConfig,
    );
    const pvRemainingKwh = integrateRemainingPvKwh(weatherResult.points, now);

    const simulation = this.simulate({
      now,
      vehicleId,
      vehicleName: vehicle.name,
      mode: vehicle.mode as Extract<VehicleMode, "vacation" | "auto">,
      priority: vehicle.priority,
      initialState: state,
      controllerConfig,
      schedules,
      points: weatherResult.points,
      forecastDayEnd: weatherResult.dayEnd,
      baseLoadW,
      initialBatteryPowerW: snapshot.realtime.batteryPowerW ?? 0,
      batterySoc: snapshot.realtime.batterySoc,
      vehicleCapacityKwh: capacity.kwh,
    });

    const confidence = capacity.sampleCount >= 5 &&
        weatherResult.liveCorrection >= 0.8 &&
        weatherResult.liveCorrection <= 1.2
      ? "high"
      : capacity.sampleCount > 0
      ? "medium"
      : "low";

    return {
      available: true,
      vehicleId,
      mode: vehicle.mode as Extract<VehicleMode, "vacation" | "auto">,
      generatedAt: now.toISOString(),
      timezone,
      pvRemainingKwh: round2(pvRemainingKwh),
      solarChargeRemainingKwh: round2(simulation.solarChargeKwh),
      solarEndAt: simulation.solarEndAt,
      socAtSolarEnd: round1(simulation.socAtSolarEnd),
      finalSoc: round1(simulation.finalSoc),
      finalAt: simulation.finalAt,
      schedule: simulation.schedule,
      confidence,
    };
  }

  private async loadControllerConfig(): Promise<ControllerConfig> {
    const [charging, solar, battery, system] = await Promise.all([
      this.configService.getCharging(),
      this.configService.getSolar(),
      this.configService.getBattery(),
      this.configService.getSystem(),
    ]);
    return {
      chargingEnabled: charging.chargingEnabled,
      controllerLoopSeconds: system.controllerLoopSeconds,
      solarTrackingEnabled: solar.solarTrackingEnabled,
      solarTrackingMode: solar.solarTrackingMode,
      solarReference: solar.solarReference,
      solarMarginKw: solar.solarMarginKw,
      minSolarGenerationKw: solar.minSolarGenerationKw,
      minExcessSolarKw: solar.minExcessSolarKw,
      gridVoltage: solar.gridVoltage,
      threePhaseCharger: solar.threePhaseCharger,
      consumptionExcludesCharging: solar.consumptionExcludesCharging,
      gracePeriodMinutes: solar.gracePeriodMinutes,
      cooldownPeriodMinutes: solar.cooldownPeriodMinutes,
      ampDebounceThreshold: solar.ampDebounceThreshold,
      ampDebounceSettleMinutes: solar.ampDebounceSettleMinutes,
      batteryPriorityEnabled: battery.batteryPriorityEnabled,
      batteryPriorityLimit: battery.batteryPriorityLimit,
      batteryDischargeToleranceW: battery.batteryDischargeToleranceW,
      batteryDischargeGraceMinutes: battery.batteryDischargeGraceMinutes,
      priorityChargingEnabled: charging.priorityChargingEnabled,
      timezone: system.timezone,
    };
  }

  private async estimateBaseHomeLoadW(
    realtime: EnergyData,
    config: ControllerConfig,
  ): Promise<number> {
    if (config.consumptionExcludesCharging) {
      return Math.max(0, realtime.homeConsumptionW);
    }
    const states = await this.vehicleManager.getAllStates();
    const evW = [...states.values()]
      .filter((state) => state.isHome !== false && state.isCharging)
      .reduce((sum, state) => sum + state.chargePowerKw * 1000, 0);
    return Math.max(0, realtime.homeConsumptionW - evW);
  }

  private async fetchPvForecast(
    latitude: number,
    longitude: number,
    installationDate: string,
    arrays: SolarArrayConfig[],
    timezone: string,
    now: Date,
    liveSolarW: number,
  ): Promise<{
    points: PvPoint[];
    dayEnd: Date;
    liveCorrection: number;
  }> {
    const ageFactor = panelAgeFactor(installationDate, now);
    const responses = await Promise.all(
      arrays.map((array) =>
        this.fetchArrayForecast(
          latitude,
          longitude,
          timezone,
          array,
          ageFactor,
        )
      ),
    );
    const combined = combineArrayForecasts(responses);
    if (combined.length === 0) throw new Error("Weather forecast is empty");

    const nominalW = arrays.reduce(
      (sum, array) => sum + array.capacityKwp * 1000,
      0,
    );
    const observedMaxW = await this.db.energy.getRecentObservedSolarMaxW(90);
    const inverterCapW = observedMaxW >= nominalW * 0.45
      ? Math.min(nominalW, observedMaxW * 1.03)
      : nominalW;
    const clipped = combined.map((point) => ({
      ...point,
      powerW: Math.min(point.powerW, inverterCapW),
    }));

    const currentPoint = closestPoint(clipped, now);
    const rawRatio = currentPoint && currentPoint.powerW >= 400
      ? liveSolarW / currentPoint.powerW
      : 1;
    const liveCorrection = clamp(0.65 + 0.35 * rawRatio, 0.7, 1.2);
    const corrected = clipped.map((point) => ({
      ...point,
      powerW: Math.max(0, point.powerW * liveCorrection),
    }));
    const last = corrected[corrected.length - 1];
    return {
      points: corrected,
      dayEnd: new Date(last.at.getTime() + 15 * 60_000),
      liveCorrection,
    };
  }

  private async fetchArrayForecast(
    latitude: number,
    longitude: number,
    timezone: string,
    array: SolarArrayConfig,
    ageFactor: number,
  ): Promise<PvPoint[]> {
    const url = new URL(OPEN_METEO_URL);
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set(
      "minutely_15",
      "global_tilted_irradiance,temperature_2m",
    );
    url.searchParams.set("tilt", String(array.tiltDeg));
    url.searchParams.set("azimuth", String(toOpenMeteoAzimuth(array.azimuthDeg)));
    url.searchParams.set("timezone", timezone);
    url.searchParams.set("forecast_days", "1");

    const response = await this.fetchFn(url, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`Open-Meteo HTTP ${response.status}`);
    }
    const data = await response.json() as MeteoFranceResponse;
    const block = data.minutely_15;
    if (!block) return [];

    return block.time.map((time, index) => {
      const gti = Math.max(0, block.global_tilted_irradiance[index] ?? 0);
      const ambientC = block.temperature_2m[index] ?? 20;
      const panelC = ambientC + 20 * (gti / 800);
      const tempFactor = clamp(
        1 + PANEL_TEMP_COEFFICIENT * (panelC - 25),
        0.75,
        1.08,
      );
      const powerW = array.capacityKwp * 1000 * (gti / 1000) * ageFactor *
        tempFactor * BASE_SYSTEM_EFFICIENCY;
      return {
        at: localApiTimeToDate(time, data.utc_offset_seconds),
        powerW: Math.max(0, powerW),
      };
    });
  }

  private simulate(input: {
    now: Date;
    vehicleId: string;
    vehicleName: string;
    mode: Extract<VehicleMode, "vacation" | "auto">;
    priority: number;
    initialState: VehicleChargeState;
    controllerConfig: ControllerConfig;
    schedules: EngineSchedule[];
    points: PvPoint[];
    forecastDayEnd: Date;
    baseLoadW: number;
    initialBatteryPowerW: number;
    batterySoc: number | null;
    vehicleCapacityKwh: number;
  }): {
    solarChargeKwh: number;
    solarEndAt: string | null;
    socAtSolarEnd: number;
    finalSoc: number;
    finalAt: string | null;
    schedule: {
      startAt: string;
      endAt: string;
      amps: number;
      targetPercent: number;
      expectedFinishAt: string | null;
    } | null;
  } {
    const engine = new ControllerEngine();
    const state: VehicleChargeState = { ...input.initialState };
    const startMs = input.now.getTime();
    const horizonMs = input.mode === "vacation"
      ? input.forecastDayEnd.getTime()
      : startMs + FORECAST_HORIZON_HOURS * 60 * 60_000;
    const electrical = resolveElectrical(state, input.controllerConfig);
    const scheduleState: ScheduleWindowState = {
      startAt: null,
      endAt: null,
      expectedFinishAt: null,
      amps: 0,
      targetPercent: state.chargeLimit,
      wasActive: false,
    };

    let soc = state.batteryLevel;
    let solarChargeKwh = 0;
    let solarEndAt: string | null = null;
    let socAtSolarEnd = soc;
    let simulatedEvW = state.isCharging
      ? state.chargeAmps * electrical.voltage * electrical.phases
      : 0;
    let finalAt: string | null = null;

    for (let ts = startMs; ts <= horizonMs; ts += 60_000) {
      const at = new Date(ts);
      const pvW = at <= input.forecastDayEnd
        ? powerAt(input.points, at)
        : 0;
      const batteryW = modeledBatteryPowerW({
        at,
        startMs,
        pvW,
        baseLoadW: input.baseLoadW,
        evW: simulatedEvW,
        initialBatteryPowerW: input.initialBatteryPowerW,
        batterySoc: input.batterySoc,
        config: input.controllerConfig,
      });
      const batteryChargeW = Math.max(0, -batteryW);
      const gridPowerW = input.baseLoadW + simulatedEvW + batteryChargeW - pvW -
        Math.max(0, batteryW);
      const homeConsumptionW = input.controllerConfig.consumptionExcludesCharging
        ? input.baseLoadW
        : input.baseLoadW + simulatedEvW;
      const energy: EnergyData = {
        solarProductionW: pvW,
        gridPowerW,
        homeConsumptionW,
        batteryPowerW: batteryW,
        batterySoc: input.batterySoc,
        gridVoltageV: electrical.voltage,
        lastUpdated: at.toISOString(),
      };
      state.batteryLevel = soc;
      state.chargePowerKw = simulatedEvW / 1000;
      state.lastUpdated = at.toISOString();

      const activeSchedule = findActiveChargeSchedule(
        input.schedules,
        input.vehicleId,
        at,
        input.controllerConfig.timezone,
      );
      updateScheduleWindow(scheduleState, activeSchedule, at, soc);

      const result = engine.decide({
        config: input.controllerConfig,
        vehicles: [{
          id: input.vehicleId,
          name: input.vehicleName,
          mode: input.mode,
          priority: input.priority,
          state,
        }],
        schedules: input.schedules,
        energy,
        now: at,
        timestamp: ts,
      });
      const decision = result.decisions.get(input.vehicleId);
      if (!decision) continue;

      applyDecision(state, decision.action, decision.targetAmps, electrical);
      simulatedEvW = state.isCharging
        ? state.chargeAmps * electrical.voltage * electrical.phases
        : 0;

      const chargedKwh = simulatedEvW / 1000 / 60;
      if (chargedKwh > 0) {
        soc = Math.min(
          state.chargeLimit,
          soc + chargedKwh / input.vehicleCapacityKwh * 100,
        );
        state.energyAddedKwh += chargedKwh;
      }

      const scheduleActive = activeSchedule !== null;
      if (!scheduleActive && at <= input.forecastDayEnd && state.isCharging) {
        const solarAvailableW = Math.max(
          0,
          pvW - input.baseLoadW - batteryChargeW,
        );
        solarChargeKwh += Math.min(simulatedEvW, solarAvailableW) / 1000 / 60;
        solarEndAt = new Date(ts + 60_000).toISOString();
        socAtSolarEnd = soc;
      }

      if (
        scheduleActive &&
        scheduleState.expectedFinishAt === null &&
        soc >= scheduleState.targetPercent
      ) {
        scheduleState.expectedFinishAt = new Date(ts + 60_000).toISOString();
      }

      if (
        input.mode === "auto" && scheduleState.wasActive && !scheduleActive &&
        scheduleState.endAt !== null
      ) {
        finalAt = scheduleState.expectedFinishAt ?? scheduleState.endAt;
        break;
      }
    }

    if (!finalAt) finalAt = input.mode === "auto"
      ? scheduleState.expectedFinishAt ?? scheduleState.endAt ?? solarEndAt
      : solarEndAt;

    const schedule = scheduleState.startAt && scheduleState.endAt
      ? {
        startAt: scheduleState.startAt,
        endAt: scheduleState.endAt,
        amps: scheduleState.amps,
        targetPercent: scheduleState.targetPercent,
        expectedFinishAt: scheduleState.expectedFinishAt,
      }
      : null;

    return {
      solarChargeKwh,
      solarEndAt,
      socAtSolarEnd,
      finalSoc: soc,
      finalAt,
      schedule,
    };
  }
}

function unavailable(
  reason: Exclude<SolarChargeForecastResult, { available: true }>["reason"],
  message: string,
): SolarChargeForecastResult {
  return { available: false, reason, message };
}

function validInstallationDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(new Date(`${value}T00:00:00Z`).getTime());
}

export function panelAgeFactor(installationDate: string, now: Date): number {
  const installed = new Date(`${installationDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(installed) || installed >= now.getTime()) return 1;
  const years = (now.getTime() - installed) / (365.2425 * 24 * 60 * 60_000);
  return Math.pow(1 - PANEL_DEGRADATION_PER_YEAR, years);
}

export function toOpenMeteoAzimuth(standardAzimuth: number): number {
  const raw = standardAzimuth - 180;
  return raw > 180 ? raw - 360 : raw < -180 ? raw + 360 : raw;
}

function localApiTimeToDate(localIso: string, utcOffsetSeconds: number): Date {
  const utcLike = Date.parse(`${localIso}:00Z`);
  return new Date(utcLike - utcOffsetSeconds * 1000);
}

function combineArrayForecasts(series: PvPoint[][]): PvPoint[] {
  if (series.length === 0) return [];
  const totals = new Map<number, number>();
  series.flat().forEach((point) => {
    const key = point.at.getTime();
    totals.set(key, (totals.get(key) ?? 0) + point.powerW);
  });
  return [...totals.entries()]
    .map(([timestamp, powerW]) => ({ at: new Date(timestamp), powerW }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function closestPoint(points: PvPoint[], at: Date): PvPoint | null {
  if (points.length === 0) return null;
  return points.reduce((closest, point) =>
    Math.abs(point.at.getTime() - at.getTime()) <
        Math.abs(closest.at.getTime() - at.getTime())
      ? point
      : closest
  );
}

function powerAt(points: PvPoint[], at: Date): number {
  const atMs = at.getTime();
  const point = points.find((candidate) =>
    candidate.at.getTime() >= atMs && candidate.at.getTime() - atMs <= 15 * 60_000
  );
  return point?.powerW ?? 0;
}

function integrateRemainingPvKwh(points: PvPoint[], now: Date): number {
  return points
    .filter((point) => point.at > now)
    .reduce((sum, point) => sum + point.powerW * 0.25 / 1000, 0);
}

function estimateVehicleCapacityKwh(
  state: VehicleChargeState,
  samples: Array<{
    batteryLevel: number;
    chargeLimit: number;
    chargePowerKw: number;
    minutesToFull: number;
  }>,
): { kwh: number; sampleCount: number } {
  const candidates = [
    {
      batteryLevel: state.batteryLevel,
      chargeLimit: state.chargeLimit,
      chargePowerKw: state.chargePowerKw,
      minutesToFull: state.minutesToFull,
    },
    ...samples,
  ].flatMap((sample) => {
    const remainingPct = sample.chargeLimit - sample.batteryLevel;
    if (
      remainingPct <= 3 || sample.chargePowerKw <= 0.5 ||
      sample.minutesToFull <= 0
    ) return [];
    const capacity = sample.chargePowerKw * (sample.minutesToFull / 60) *
      100 / remainingPct;
    return capacity >= 35 && capacity <= 130 ? [capacity] : [];
  });
  if (candidates.length === 0) {
    return { kwh: DEFAULT_VEHICLE_CAPACITY_KWH, sampleCount: 0 };
  }
  const sorted = [...candidates].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return { kwh: median, sampleCount: candidates.length };
}

function resolveElectrical(
  state: VehicleChargeState,
  config: ControllerConfig,
): { voltage: number; phases: number } {
  const voltage = state.chargerVoltage >= 100
    ? state.chargerVoltage
    : config.gridVoltage;
  const phases = state.isCharging && state.chargerPhases === 1
    ? 1
    : config.threePhaseCharger
    ? 3
    : Math.max(1, state.chargerPhases || 1);
  return { voltage, phases };
}

function modeledBatteryPowerW(input: {
  at: Date;
  startMs: number;
  pvW: number;
  baseLoadW: number;
  evW: number;
  initialBatteryPowerW: number;
  batterySoc: number | null;
  config: ControllerConfig;
}): number {
  const minutes = Math.max(0, (input.at.getTime() - input.startMs) / 60_000);
  const initialChargeW = Math.max(0, -input.initialBatteryPowerW);
  const chargeDecay = Math.max(0, 1 - minutes / 90);
  const chargingW = input.batterySoc !== null && input.batterySoc < 98
    ? initialChargeW * chargeDecay
    : 0;
  if (chargingW > 0) return -chargingW;

  const deficitW = Math.max(0, input.baseLoadW + input.evW - input.pvW);
  const canDischarge = input.batterySoc !== null &&
    input.batterySoc > input.config.batteryPriorityLimit;
  if (!canDischarge || deficitW <= 0) return 0;
  const observedDischargeW = Math.max(0, input.initialBatteryPowerW);
  const modeledMaxW = Math.max(
    observedDischargeW,
    input.config.batteryDischargeToleranceW + 100,
  );
  return Math.min(deficitW, modeledMaxW);
}

function findActiveChargeSchedule(
  schedules: EngineSchedule[],
  vehicleId: string,
  at: Date,
  timezone: string,
): EngineSchedule | null {
  return schedules.find((schedule) =>
    schedule.enabled && schedule.scheduleType === "charge" &&
    schedule.vehicleId === vehicleId &&
    isScheduleActiveNow(schedule, at, timezone)
  ) ?? null;
}

function updateScheduleWindow(
  state: ScheduleWindowState,
  active: EngineSchedule | null,
  at: Date,
  soc: number,
): void {
  if (active) {
    if (!state.wasActive && state.startAt === null) {
      state.startAt = at.toISOString();
      state.amps = active.chargeAmps ?? 0;
      state.targetPercent = Math.min(active.chargeLimitPct ?? 100, 100);
    }
    state.wasActive = true;
    if (soc >= state.targetPercent && state.expectedFinishAt === null) {
      state.expectedFinishAt = at.toISOString();
    }
    return;
  }
  if (state.wasActive && state.endAt === null) {
    state.endAt = at.toISOString();
  }
}

function applyDecision(
  state: VehicleChargeState,
  action: "start" | "stop" | "adjust_amps" | "none",
  targetAmps: number | null,
  electrical: { voltage: number; phases: number },
): void {
  if (action === "stop") {
    state.isCharging = false;
    state.chargeAmps = 0;
    state.chargePowerKw = 0;
    return;
  }
  if ((action === "start" || action === "adjust_amps") && targetAmps !== null) {
    state.isCharging = true;
    state.chargeAmps = targetAmps;
    state.chargerVoltage = electrical.voltage;
    state.chargerPhases = electrical.phases;
    state.chargePowerKw = targetAmps * electrical.voltage * electrical.phases /
      1000;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
