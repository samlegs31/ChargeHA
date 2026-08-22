import type { AppDatabase } from "../db/AppDatabase.ts";
import type { TariffPeriodRow } from "../db/types.ts";
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
  type ControllerConfig,
  ControllerEngine,
  type EngineSchedule,
  isScheduleActiveNow,
} from "@chargeha/shared/engine";
import {
  parseSolarArrays,
  type SolarArrayConfig,
  type SolarChargeForecastResult,
} from "@chargeha/shared/forecast";
import type { SolarForecastConfig } from "@chargeha/shared/configSections";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/meteofrance";
const PANEL_DEGRADATION_PER_YEAR = 0.005;
const BASE_SYSTEM_EFFICIENCY = 0.94;
const PANEL_TEMP_COEFFICIENT = -0.0035;
const DEFAULT_VEHICLE_CAPACITY_KWH = 60;
const FORECAST_HORIZON_HOURS = 36;
const MINUTE_MS = 60_000;

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

export interface HomeBatteryForecastConfig {
  capacityKwh: number;
  maxChargeW: number;
  maxDischargeW: number;
  roundTripEfficiency: number;
}

interface ScheduleWindowState {
  startAt: string | null;
  endAt: string | null;
  expectedFinishAt: string | null;
  amps: number;
  targetPercent: number;
  wasActive: boolean;
}

interface SimulationInput {
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
  homeBattery: HomeBatteryForecastConfig | null;
  subscribedPowerW: number | null;
  vehicleCapacityKwh: number;
}

interface SimulationRuntime {
  vehicleState: VehicleChargeState;
  scheduleState: ScheduleWindowState;
  soc: number;
  solarChargeKwh: number;
  solarEndAt: string | null;
  socAtSolarEnd: number;
  simulatedEvW: number;
  finalAt: string | null;
  stopped: boolean;
  batterySoc: number | null;
}

interface SimulationResult {
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

  async getTodayForecast(
    vehicleId: string,
  ): Promise<SolarChargeForecastResult> {
    const now = this.nowFn();
    const [forecastConfig, controllerConfig, vehicle, state, snapshot] =
      await Promise.all([
        this.configService.getSolarForecast(),
        this.loadControllerConfig(),
        this.db.vehicles.getVehicle(vehicleId),
        this.vehicleManager.getState(vehicleId),
        Promise.resolve(this.poller.tryGetRealtimeSnapshot()),
      ]);

    const requestError = forecastRequestUnavailable(vehicle, state, snapshot);
    if (requestError) return requestError;
    if (!vehicle || !state || !snapshot) {
      throw new Error("Invalid forecast state");
    }

    const arrays = parseSolarArrays(forecastConfig.solarForecastArraysJson);
    if (!forecastConfigured(forecastConfig, arrays)) {
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
      forecastConfig.solarForecastInverterAcMaxKw,
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

    const [capacitySamples, schedulesResult, tariffPeriods] = await Promise.all(
      [
        this.db.vehicles.getRecentCapacityCalibrationSamples(vehicleId),
        this.scheduleService.list(),
        this.db.tariffs.getTariffPeriods(),
      ],
    );
    const capacity = estimateVehicleCapacityKwh(state, capacitySamples);
    const baseLoadW = await this.estimateBaseHomeLoadW(
      snapshot.realtime,
      controllerConfig,
    );
    const schedules = forecastSchedules({
      configured: schedulesResult.schedules as EngineSchedule[],
      tariffPeriods,
      vehicleId,
      state,
      controllerConfig,
      subscribedPowerKva: forecastConfig.solarForecastSubscribedPowerKva,
      baseLoadW,
    });
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
      homeBattery: resolveHomeBatteryForecastConfig(forecastConfig),
      subscribedPowerW: forecastConfig.solarForecastSubscribedPowerKva === null
        ? null
        : forecastConfig.solarForecastSubscribedPowerKva * 1000,
      vehicleCapacityKwh: capacity.kwh,
    });

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
      confidence: forecastConfidence(
        capacity.sampleCount,
        weatherResult.liveCorrection,
      ),
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
    configuredInverterAcMaxKw: number | null,
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
    const inverterCapW = resolveInverterCapW(
      nominalW,
      observedMaxW,
      configuredInverterAcMaxKw,
    );
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
      dayEnd: new Date(last.at.getTime() + 15 * MINUTE_MS),
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
    url.searchParams.set(
      "azimuth",
      String(toOpenMeteoAzimuth(array.azimuthDeg)),
    );
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

  private simulate(input: SimulationInput): SimulationResult {
    const engine = new ControllerEngine();
    const electrical = resolveElectrical(
      input.initialState,
      input.controllerConfig,
    );
    const startMs = input.now.getTime();
    const horizonMs = simulationHorizonMs(input, startMs);
    const initialRuntime = createSimulationRuntime(input, electrical);
    const minuteCount = Math.max(
      0,
      Math.floor((horizonMs - startMs) / MINUTE_MS) + 1,
    );
    const runtime = Array.from(
      { length: minuteCount },
      (_, index) => startMs + index * MINUTE_MS,
    ).reduce(
      (current, ts) =>
        this.simulateMinute(input, engine, electrical, current, ts),
      initialRuntime,
    );
    const finalAt = simulationFinalAt(runtime, input.mode);
    return {
      solarChargeKwh: runtime.solarChargeKwh,
      solarEndAt: runtime.solarEndAt,
      socAtSolarEnd: runtime.socAtSolarEnd,
      finalSoc: runtime.soc,
      finalAt,
      schedule: scheduleResult(runtime.scheduleState),
    };
  }

  private simulateMinute(
    input: SimulationInput,
    engine: ControllerEngine,
    electrical: { voltage: number; phases: number },
    runtime: SimulationRuntime,
    ts: number,
  ): SimulationRuntime {
    if (runtime.stopped) return runtime;
    const at = new Date(ts);
    const pvW = at <= input.forecastDayEnd ? powerAt(input.points, at) : 0;
    const batteryW = modeledBatteryPowerW({
      at,
      startMs: input.now.getTime(),
      pvW,
      baseLoadW: input.baseLoadW,
      evW: runtime.simulatedEvW,
      initialBatteryPowerW: input.initialBatteryPowerW,
      batterySoc: runtime.batterySoc,
      homeBattery: input.homeBattery,
      config: input.controllerConfig,
    });
    const minute = createMinuteSnapshot(
      input,
      runtime,
      electrical,
      at,
      pvW,
      batteryW,
    );
    const activeSchedule = findActiveChargeSchedule(
      input.schedules,
      input.vehicleId,
      at,
      input.controllerConfig.timezone,
    );
    const scheduleState = advanceScheduleWindow(
      runtime.scheduleState,
      activeSchedule,
      at,
      runtime.soc,
    );
    const decision = decideVehicleMinute(input, engine, minute, at, ts);
    if (!decision) {
      return { ...runtime, vehicleState: minute.state, scheduleState };
    }

    const decidedState = applyDecision(
      minute.state,
      decision.action,
      decision.targetAmps,
      electrical,
    );
    const gridSafeState = applySubscribedPowerLimit(
      decidedState,
      electrical,
      input.subscribedPowerW,
      input.baseLoadW,
      pvW,
      batteryW,
    );
    const simulatedEvW = chargePowerW(gridSafeState, electrical);
    const chargedKwh = simulatedEvW / 1000 / 60;
    const soc = nextSoc(
      runtime.soc,
      chargedKwh,
      input.vehicleCapacityKwh,
      minute.state.chargeLimit,
    );
    const vehicleState = withAddedEnergy(gridSafeState, chargedKwh);
    const scheduleActive = activeSchedule !== null;
    const solar = updateSolarProgress({
      runtime,
      scheduleActive,
      at,
      forecastDayEnd: input.forecastDayEnd,
      isCharging: vehicleState.isCharging,
      pvW,
      baseLoadW: input.baseLoadW,
      batteryChargeW: minute.batteryChargeW,
      simulatedEvW,
      soc,
      ts,
    });
    const finalScheduleState = finishScheduleAfterCharge(
      scheduleState,
      scheduleActive,
      soc,
      ts,
    );
    const stopped = autoScheduleFinished(
      input.mode,
      finalScheduleState,
      scheduleActive,
    );
    const finalAt = stopped
      ? finalScheduleState.expectedFinishAt ?? finalScheduleState.endAt
      : runtime.finalAt;
    const batterySoc = nextHomeBatterySoc(
      runtime.batterySoc,
      batteryW,
      input.homeBattery,
    );
    return {
      vehicleState,
      scheduleState: finalScheduleState,
      soc,
      solarChargeKwh: solar.solarChargeKwh,
      solarEndAt: solar.solarEndAt,
      socAtSolarEnd: solar.socAtSolarEnd,
      simulatedEvW,
      finalAt,
      stopped,
      batterySoc,
    };
  }
}

function decideVehicleMinute(
  input: SimulationInput,
  engine: ControllerEngine,
  minute: ReturnType<typeof createMinuteSnapshot>,
  at: Date,
  ts: number,
) {
  const result = engine.decide({
    config: input.controllerConfig,
    vehicles: [{
      id: input.vehicleId,
      name: input.vehicleName,
      mode: input.mode,
      priority: input.priority,
      state: minute.state,
    }],
    schedules: input.schedules,
    energy: minute.energy,
    now: at,
    timestamp: ts,
  });
  return result.decisions.get(input.vehicleId);
}

function forecastRequestUnavailable(
  vehicle: { mode: string } | null | undefined,
  state: VehicleChargeState | null | undefined,
  snapshot: { realtime: { pollFailed?: boolean } } | null | undefined,
): SolarChargeForecastResult | null {
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
    return unavailable(
      "energy_unavailable",
      "Live energy data is unavailable.",
    );
  }
  return null;
}

function unavailable(
  reason: Exclude<SolarChargeForecastResult, { available: true }>["reason"],
  message: string,
): SolarChargeForecastResult {
  return { available: false, reason, message };
}

function forecastConfigured(
  config: {
    solarForecastEnabled: boolean;
    solarForecastLatitude: number | null;
    solarForecastLongitude: number | null;
    solarForecastInstallationDate: string;
  },
  arrays: SolarArrayConfig[],
): boolean {
  if (!config.solarForecastEnabled) return false;
  if (
    config.solarForecastLatitude === null ||
    config.solarForecastLongitude === null
  ) {
    return false;
  }
  if (!validInstallationDate(config.solarForecastInstallationDate)) {
    return false;
  }
  return arrays.length > 0;
}

function resolveHomeBatteryForecastConfig(
  config: SolarForecastConfig,
): HomeBatteryForecastConfig | null {
  const capacityKwh = config.solarForecastBatteryCapacityKwh;
  const maxChargeKw = config.solarForecastBatteryMaxChargeKw;
  const maxDischargeKw = config.solarForecastBatteryMaxDischargeKw;
  const efficiencyPct = config.solarForecastBatteryRoundTripEfficiencyPct;
  if (
    capacityKwh === null || maxChargeKw === null ||
    maxDischargeKw === null || efficiencyPct === null
  ) return null;
  return {
    capacityKwh,
    maxChargeW: maxChargeKw * 1000,
    maxDischargeW: maxDischargeKw * 1000,
    roundTripEfficiency: efficiencyPct / 100,
  };
}

export function resolveInverterCapW(
  nominalArrayW: number,
  observedMaxW: number,
  configuredAcMaxKw: number | null,
): number {
  if (configuredAcMaxKw !== null) {
    return Math.min(nominalArrayW, configuredAcMaxKw * 1000);
  }
  const learnedCapW = observedMaxW >= nominalArrayW * 0.45
    ? observedMaxW * 1.03
    : Number.POSITIVE_INFINITY;
  return Math.min(nominalArrayW, learnedCapW);
}

function forecastConfidence(
  sampleCount: number,
  liveCorrection: number,
): "high" | "medium" | "low" {
  const liveMatch = liveCorrection >= 0.8 && liveCorrection <= 1.2;
  if (sampleCount >= 5 && liveMatch) return "high";
  if (sampleCount > 0) return "medium";
  return "low";
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
  if (raw > 180) return raw - 360;
  if (raw < -180) return raw + 360;
  return raw;
}

function localApiTimeToDate(localIso: string, utcOffsetSeconds: number): Date {
  const utcLike = Date.parse(`${localIso}:00Z`);
  return new Date(utcLike - utcOffsetSeconds * 1000);
}

function combineArrayForecasts(series: PvPoint[][]): PvPoint[] {
  if (series.length === 0) return [];
  const totals = series.flat().reduce((acc, point) => {
    const key = point.at.getTime();
    acc.set(key, (acc.get(key) ?? 0) + point.powerW);
    return acc;
  }, new Map<number, number>());
  return [...totals.entries()]
    .map(([timestamp, powerW]) => ({ at: new Date(timestamp), powerW }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function closestPoint(points: PvPoint[], at: Date): PvPoint | null {
  if (points.length === 0) return null;
  return points.reduce((closest, point) => closerPoint(closest, point, at));
}

function closerPoint(closest: PvPoint, point: PvPoint, at: Date): PvPoint {
  const pointDistance = Math.abs(point.at.getTime() - at.getTime());
  const closestDistance = Math.abs(closest.at.getTime() - at.getTime());
  return pointDistance < closestDistance ? point : closest;
}

function powerAt(points: PvPoint[], at: Date): number {
  const atMs = at.getTime();
  const point = points.find((candidate) =>
    candidate.at.getTime() >= atMs &&
    candidate.at.getTime() - atMs <= 15 * MINUTE_MS
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
  return { voltage, phases: resolvePhases(state, config) };
}

function resolvePhases(
  state: VehicleChargeState,
  config: ControllerConfig,
): number {
  if (state.isCharging && state.chargerPhases === 1) return 1;
  if (config.threePhaseCharger) return 3;
  return Math.max(1, state.chargerPhases || 1);
}

function simulationHorizonMs(input: SimulationInput, startMs: number): number {
  if (input.mode === "vacation") return input.forecastDayEnd.getTime();
  return startMs + FORECAST_HORIZON_HOURS * 60 * MINUTE_MS;
}

function simulationFinalAt(
  runtime: SimulationRuntime,
  mode: Extract<VehicleMode, "vacation" | "auto">,
): string | null {
  if (runtime.finalAt !== null) return runtime.finalAt;
  return resolveFinalAt(mode, runtime.scheduleState, runtime.solarEndAt);
}

function createSimulationRuntime(
  input: SimulationInput,
  electrical: { voltage: number; phases: number },
): SimulationRuntime {
  const state = { ...input.initialState };
  return {
    vehicleState: state,
    scheduleState: {
      startAt: null,
      endAt: null,
      expectedFinishAt: null,
      amps: 0,
      targetPercent: state.chargeLimit,
      wasActive: false,
    },
    soc: state.batteryLevel,
    solarChargeKwh: 0,
    solarEndAt: null,
    socAtSolarEnd: state.batteryLevel,
    simulatedEvW: chargePowerW(state, electrical),
    finalAt: null,
    stopped: false,
    batterySoc: input.batterySoc,
  };
}

function createMinuteSnapshot(
  input: SimulationInput,
  runtime: SimulationRuntime,
  electrical: { voltage: number; phases: number },
  at: Date,
  pvW: number,
  batteryW: number,
): {
  batteryChargeW: number;
  energy: EnergyData;
  state: VehicleChargeState;
} {
  const batteryChargeW = Math.max(0, -batteryW);
  const gridPowerW = input.baseLoadW + runtime.simulatedEvW + batteryChargeW -
    pvW - Math.max(0, batteryW);
  const homeConsumptionW = homeConsumptionForSimulation(
    input.controllerConfig,
    input.baseLoadW,
    runtime.simulatedEvW,
  );
  const timestamp = at.toISOString();
  return {
    batteryChargeW,
    energy: {
      solarProductionW: pvW,
      gridPowerW,
      homeConsumptionW,
      batteryPowerW: batteryW,
      batterySoc: runtime.batterySoc,
      gridVoltageV: electrical.voltage,
      lastUpdated: timestamp,
    },
    state: {
      ...runtime.vehicleState,
      batteryLevel: runtime.soc,
      chargePowerKw: runtime.simulatedEvW / 1000,
      lastUpdated: timestamp,
    },
  };
}

function chargePowerW(
  state: VehicleChargeState,
  electrical: { voltage: number; phases: number },
): number {
  if (!state.isCharging) return 0;
  return state.chargeAmps * electrical.voltage * electrical.phases;
}

function homeConsumptionForSimulation(
  config: ControllerConfig,
  baseLoadW: number,
  simulatedEvW: number,
): number {
  if (config.consumptionExcludesCharging) return baseLoadW;
  return baseLoadW + simulatedEvW;
}

function nextSoc(
  soc: number,
  chargedKwh: number,
  vehicleCapacityKwh: number,
  chargeLimit: number,
): number {
  if (chargedKwh <= 0) return soc;
  return Math.min(chargeLimit, soc + chargedKwh / vehicleCapacityKwh * 100);
}

function withAddedEnergy(
  state: VehicleChargeState,
  chargedKwh: number,
): VehicleChargeState {
  if (chargedKwh <= 0) return state;
  return { ...state, energyAddedKwh: state.energyAddedKwh + chargedKwh };
}

function updateSolarProgress(input: {
  runtime: SimulationRuntime;
  scheduleActive: boolean;
  at: Date;
  forecastDayEnd: Date;
  isCharging: boolean;
  pvW: number;
  baseLoadW: number;
  batteryChargeW: number;
  simulatedEvW: number;
  soc: number;
  ts: number;
}): Pick<SimulationRuntime, "solarChargeKwh" | "solarEndAt" | "socAtSolarEnd"> {
  const duringForecast = input.at <= input.forecastDayEnd;
  if (input.scheduleActive || !duringForecast || !input.isCharging) {
    return {
      solarChargeKwh: input.runtime.solarChargeKwh,
      solarEndAt: input.runtime.solarEndAt,
      socAtSolarEnd: input.runtime.socAtSolarEnd,
    };
  }
  const solarAvailableW = Math.max(
    0,
    input.pvW - input.baseLoadW - input.batteryChargeW,
  );
  return {
    solarChargeKwh: input.runtime.solarChargeKwh +
      Math.min(input.simulatedEvW, solarAvailableW) / 1000 / 60,
    solarEndAt: new Date(input.ts + MINUTE_MS).toISOString(),
    socAtSolarEnd: input.soc,
  };
}

function finishScheduleAfterCharge(
  state: ScheduleWindowState,
  scheduleActive: boolean,
  soc: number,
  ts: number,
): ScheduleWindowState {
  if (!scheduleActive || state.expectedFinishAt !== null) return state;
  if (soc < state.targetPercent) return state;
  return { ...state, expectedFinishAt: new Date(ts + MINUTE_MS).toISOString() };
}

function autoScheduleFinished(
  mode: Extract<VehicleMode, "vacation" | "auto">,
  state: ScheduleWindowState,
  scheduleActive: boolean,
): boolean {
  if (mode !== "auto" || scheduleActive) return false;
  return state.wasActive && state.endAt !== null;
}

function resolveFinalAt(
  mode: Extract<VehicleMode, "vacation" | "auto">,
  schedule: ScheduleWindowState,
  solarEndAt: string | null,
): string | null {
  if (mode !== "auto") return solarEndAt;
  return schedule.expectedFinishAt ?? schedule.endAt ?? solarEndAt;
}

function scheduleResult(
  state: ScheduleWindowState,
): SimulationResult["schedule"] {
  if (!state.startAt || !state.endAt) return null;
  return {
    startAt: state.startAt,
    endAt: state.endAt,
    amps: state.amps,
    targetPercent: state.targetPercent,
    expectedFinishAt: state.expectedFinishAt,
  };
}

function modeledBatteryPowerW(input: {
  at: Date;
  startMs: number;
  pvW: number;
  baseLoadW: number;
  evW: number;
  initialBatteryPowerW: number;
  batterySoc: number | null;
  homeBattery: HomeBatteryForecastConfig | null;
  config: ControllerConfig;
}): number {
  if (input.homeBattery && input.batterySoc !== null) {
    return modeledConfiguredBatteryPowerW(input);
  }

  const minutes = Math.max(0, (input.at.getTime() - input.startMs) / MINUTE_MS);
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

function modeledConfiguredBatteryPowerW(input: {
  pvW: number;
  baseLoadW: number;
  evW: number;
  batterySoc: number | null;
  homeBattery: HomeBatteryForecastConfig | null;
  config: ControllerConfig;
}): number {
  const battery = input.homeBattery;
  const soc = input.batterySoc;
  if (!battery || soc === null) return 0;

  const balanceW = input.pvW - input.baseLoadW - input.evW;
  if (balanceW > 0 && soc < 100) {
    const roomW = (100 - soc) / 100 * battery.capacityKwh * 60 * 1000;
    return -Math.min(balanceW, battery.maxChargeW, roomW);
  }

  const reserveSoc = input.config.batteryPriorityEnabled
    ? input.config.batteryPriorityLimit
    : 0;
  if (balanceW >= 0 || soc <= reserveSoc) return 0;
  const availableW = (soc - reserveSoc) / 100 * battery.capacityKwh * 60 * 1000;
  return Math.min(-balanceW, battery.maxDischargeW, availableW);
}

export function nextHomeBatterySoc(
  soc: number | null,
  batteryPowerW: number,
  battery: HomeBatteryForecastConfig | null,
): number | null {
  if (soc === null || !battery || batteryPowerW === 0) return soc;
  const oneWayEfficiency = Math.sqrt(battery.roundTripEfficiency);
  const energyDeltaKwh = batteryPowerW < 0
    ? -batteryPowerW / 1000 / 60 * oneWayEfficiency
    : -batteryPowerW / 1000 / 60 / oneWayEfficiency;
  return clamp(
    soc + energyDeltaKwh / battery.capacityKwh * 100,
    0,
    100,
  );
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

export function forecastSchedules(input: {
  configured: EngineSchedule[];
  tariffPeriods: TariffPeriodRow[];
  vehicleId: string;
  state: VehicleChargeState;
  controllerConfig: ControllerConfig;
  subscribedPowerKva: number | null;
  baseLoadW: number;
}): EngineSchedule[] {
  const enabledTariffs = input.tariffPeriods.filter((period) => period.enabled);
  const lowCostPeriods = findLowCostTariffPeriods(enabledTariffs);
  if (lowCostPeriods.length === 0) return input.configured;

  const electrical = resolveElectrical(input.state, input.controllerConfig);
  const availableW = input.subscribedPowerKva === null
    ? input.state.chargeAmpsMax * electrical.voltage * electrical.phases
    : Math.max(0, input.subscribedPowerKva * 1000 - input.baseLoadW);
  const chargeAmps = Math.min(
    input.state.chargeAmpsMax,
    Math.floor(availableW / electrical.voltage / electrical.phases),
  );
  if (chargeAmps < input.state.chargeAmpsMin) return input.configured;

  const tariffSchedules = lowCostPeriods
    .map((period): EngineSchedule => ({
      id: `tariff-${period.id}`,
      vehicleId: input.vehicleId,
      scheduleType: "charge",
      startTime: period.startTime,
      endTime: period.endTime,
      days: period.days,
      chargeAmps,
      chargeLimitPct: input.state.chargeLimit,
      enabled: true,
    }));
  return [...input.configured, ...tariffSchedules];
}

function findLowCostTariffPeriods(
  enabledTariffs: TariffPeriodRow[],
): TariffPeriodRow[] {
  const namedOffPeak = enabledTariffs.filter((period) =>
    /off[-\s]?peak|heures?\s+creuses?|\bhc\b/i.test(period.label)
  );
  if (namedOffPeak.length > 0) return namedOffPeak;

  const rates = [...new Set(enabledTariffs.map((period) => period.ratePerKwh))];
  if (rates.length < 2) return [];
  const cheapestRate = Math.min(...rates);
  return enabledTariffs.filter((period) => period.ratePerKwh === cheapestRate);
}

function finishAtWhenTargetReached(
  current: string | null,
  soc: number,
  targetPercent: number,
  at: Date,
): string | null {
  if (current !== null || soc < targetPercent) return current;
  return at.toISOString();
}

function advanceScheduleWindow(
  state: ScheduleWindowState,
  active: EngineSchedule | null,
  at: Date,
  soc: number,
): ScheduleWindowState {
  if (active) {
    const starting = !state.wasActive && state.startAt === null;
    const targetPercent = starting
      ? Math.min(active.chargeLimitPct ?? 100, 100)
      : state.targetPercent;
    return {
      ...state,
      startAt: starting ? at.toISOString() : state.startAt,
      amps: starting ? active.chargeAmps ?? 0 : state.amps,
      targetPercent,
      wasActive: true,
      expectedFinishAt: finishAtWhenTargetReached(
        state.expectedFinishAt,
        soc,
        targetPercent,
        at,
      ),
    };
  }
  if (state.wasActive && state.endAt === null) {
    return { ...state, endAt: at.toISOString() };
  }
  return state;
}

function applyDecision(
  state: VehicleChargeState,
  action: "start" | "stop" | "adjust_amps" | "none",
  targetAmps: number | null,
  electrical: { voltage: number; phases: number },
): VehicleChargeState {
  if (action === "stop") {
    return { ...state, isCharging: false, chargeAmps: 0, chargePowerKw: 0 };
  }
  const startsCharging = action === "start" || action === "adjust_amps";
  if (!startsCharging || targetAmps === null) return state;
  return {
    ...state,
    isCharging: true,
    chargeAmps: targetAmps,
    chargerVoltage: electrical.voltage,
    chargerPhases: electrical.phases,
    chargePowerKw: targetAmps * electrical.voltage * electrical.phases / 1000,
  };
}

export function applySubscribedPowerLimit(
  state: VehicleChargeState,
  electrical: { voltage: number; phases: number },
  subscribedPowerW: number | null,
  baseLoadW: number,
  pvW: number,
  batteryW: number,
): VehicleChargeState {
  if (!state.isCharging || subscribedPowerW === null) return state;

  const nonEvGridW = baseLoadW + Math.max(0, -batteryW) - pvW -
    Math.max(0, batteryW);
  const availableForVehicleW = Math.max(0, subscribedPowerW - nonEvGridW);
  const maxSafeAmps = Math.min(
    state.chargeAmpsMax,
    Math.floor(availableForVehicleW / electrical.voltage / electrical.phases),
  );
  if (maxSafeAmps < state.chargeAmpsMin) {
    return { ...state, isCharging: false, chargeAmps: 0, chargePowerKw: 0 };
  }
  if (state.chargeAmps <= maxSafeAmps) return state;
  return {
    ...state,
    chargeAmps: maxSafeAmps,
    chargePowerKw: maxSafeAmps * electrical.voltage * electrical.phases / 1000,
  };
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
