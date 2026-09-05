import type { AppDatabase } from "../db/AppDatabase.ts";
import type { TariffPeriodRow } from "../db/types.ts";
import type { Logger } from "../lib/Logger.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { EnergyPoller } from "./EnergyPoller.ts";
import type { ScheduleService } from "./ScheduleService.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import {
  aggregateLearningStats,
  buildSolarPredictionConfidence,
  decayingLiveCorrection,
  historicalCorrectionAt,
  learningStateForConfiguration,
  parseSolarPredictionLearning,
  predictionPointIntervalPct,
  type SolarPredictionLearningState,
  solarProviderWeights,
  type SolarWeatherProviderId,
  updateSolarPredictionLearning,
} from "./SolarPredictionModel.ts";
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

const OPEN_METEO_PROVIDERS: ReadonlyArray<{
  id: SolarWeatherProviderId;
  url: string;
}> = [
  {
    id: "meteofrance",
    url: "https://api.open-meteo.com/v1/meteofrance",
  },
  {
    id: "dwd_icon",
    url: "https://api.open-meteo.com/v1/dwd-icon",
  },
];
const SOLAR_PREDICTION_STATE_KEY = "runtime.solar_prediction_v2";
const PANEL_DEGRADATION_PER_YEAR = 0.005;
const BASE_SYSTEM_EFFICIENCY = 0.94;
const PANEL_TEMP_COEFFICIENT = -0.0035;
const FAIMAN_U0 = 25;
const FAIMAN_U1 = 6.84;
const DEFAULT_VEHICLE_CAPACITY_KWH = 60;
const FORECAST_HORIZON_HOURS = 36;
const MINUTE_MS = 60_000;
const FORECAST_STEP_MS = 15 * MINUTE_MS;
const LIVE_SOLAR_MAX_AGE_MS = 5 * MINUTE_MS;
const LIVE_SOLAR_FUTURE_TOLERANCE_MS = MINUTE_MS;
const MIN_BACKGROUND_LEARNING_POWER_W = 400;

interface OpenMeteoResponse {
  utc_offset_seconds: number;
  minutely_15?: {
    time: Array<number | string>;
    global_tilted_irradiance: Array<number | null>;
    global_tilted_irradiance_instant?: Array<number | null>;
    temperature_2m: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
  };
}

interface PvPoint {
  at: Date;
  powerW: number;
}

interface ArrayForecast {
  points: PvPoint[];
  instantPoints: PvPoint[];
}

interface ProviderForecast {
  provider: SolarWeatherProviderId;
  points: PvPoint[];
  instantPoints: PvPoint[];
}

interface WeatherForecastResult {
  points: PvPoint[];
  p10Points: PvPoint[];
  p90Points: PvPoint[];
  dayEnd: Date;
  liveCorrection: number;
  liveObservationUsed: boolean;
  historicalCorrection: number;
  providerSpreadPct: number;
  providerCount: number;
  providerWeights: Record<SolarWeatherProviderId, number>;
  learningSamples: number;
  learningCoverage: number;
  meanAbsPctError: number;
  empiricalIntervalPct: number;
}

interface ForecastBuildInput {
  now: Date;
  vehicleId: string;
  vehicleName: string;
  mode: Extract<VehicleMode, "vacation" | "auto">;
  priority: number;
  state: VehicleChargeState;
  realtime: EnergyData;
  forecastConfig: SolarForecastConfig;
  controllerConfig: ControllerConfig;
  timezone: string;
  weatherResult: WeatherForecastResult;
}

interface ForecastScenarios {
  p10PvKwh: number;
  p50PvKwh: number;
  p90PvKwh: number;
  p10Simulation: SimulationResult;
  p50Simulation: SimulationResult;
  p90Simulation: SimulationResult;
}

interface ForecastResponseInput {
  input: ForecastBuildInput;
  scenarios: ForecastScenarios;
  capacitySampleCount: number;
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
  private backgroundLearningInFlight = false;
  private backgroundLearningSlot: string | null = null;
  private backgroundLearningStarted = false;

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

  startBackgroundLearning(eventEmitter: TypedEventEmitter): void {
    if (this.backgroundLearningStarted) return;
    this.backgroundLearningStarted = true;
    eventEmitter.subscribe("energy_update", (data) => {
      this.queueBackgroundLearning(data);
    });
  }

  private queueBackgroundLearning(realtime: EnergyData): void {
    const now = this.nowFn();
    const liveSolarW = usableLiveSolarPowerW(realtime, now);
    if (liveSolarW === null || liveSolarW < MIN_BACKGROUND_LEARNING_POWER_W) {
      return;
    }
    const slot = backgroundLearningSlot(now);
    if (
      this.backgroundLearningInFlight || this.backgroundLearningSlot === slot
    ) return;
    this.backgroundLearningInFlight = true;
    void this.learnFromBackgroundEnergy(now, liveSolarW)
      .catch((error) => {
        this.logger.debug(
          "Background solar prediction learning skipped",
          error,
        );
      })
      .finally(() => {
        this.backgroundLearningSlot = slot;
        this.backgroundLearningInFlight = false;
      });
  }

  private async learnFromBackgroundEnergy(
    now: Date,
    liveSolarW: number,
  ): Promise<void> {
    const [forecastConfig, controllerConfig] = await Promise.all([
      this.configService.getSolarForecast(),
      this.loadControllerConfig(),
    ]);
    const arrays = parseSolarArrays(forecastConfig.solarForecastArraysJson);
    if (!forecastConfigured(forecastConfig, arrays)) return;
    await this.fetchPvForecast(
      forecastConfig.solarForecastLatitude as number,
      forecastConfig.solarForecastLongitude as number,
      forecastConfig.solarForecastInstallationDate,
      arrays,
      controllerConfig.timezone || "UTC",
      now,
      liveSolarW,
      forecastConfig.solarForecastInverterAcMaxKw,
    );
  }

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
    const liveSolarW = usableLiveSolarPowerW(snapshot.realtime, now);
    const weatherResult = await this.fetchPvForecast(
      forecastConfig.solarForecastLatitude as number,
      forecastConfig.solarForecastLongitude as number,
      forecastConfig.solarForecastInstallationDate,
      arrays,
      timezone,
      now,
      liveSolarW,
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
    return await this.buildTodayForecast({
      now,
      vehicleId,
      vehicleName: vehicle.name,
      mode: vehicle.mode as Extract<VehicleMode, "vacation" | "auto">,
      priority: vehicle.priority,
      state,
      realtime: snapshot.realtime,
      forecastConfig,
      controllerConfig,
      timezone,
      weatherResult,
    });
  }

  private async buildTodayForecast(
    input: ForecastBuildInput,
  ): Promise<SolarChargeForecastResult> {
    const [capacitySamples, schedulesResult, tariffPeriods] = await Promise.all(
      [
        this.db.vehicles.getRecentCapacityCalibrationSamples(input.vehicleId),
        this.scheduleService.list(),
        this.db.tariffs.getTariffPeriods(),
      ],
    );
    const capacity = estimateVehicleCapacityKwh(input.state, capacitySamples);
    const baseLoadW = await this.estimateBaseHomeLoadW(
      input.realtime,
      input.controllerConfig,
    );
    const schedules = forecastSchedules({
      configured: schedulesResult.schedules as EngineSchedule[],
      tariffPeriods,
      vehicleId: input.vehicleId,
      state: input.state,
      controllerConfig: input.controllerConfig,
      subscribedPowerKva: input.forecastConfig.solarForecastSubscribedPowerKva,
      baseLoadW,
    });
    const baseSimulationInput = createSimulationInput(
      input,
      schedules,
      baseLoadW,
      capacity.kwh,
    );
    const scenarios = this.simulateScenarios(input, baseSimulationInput);
    return buildForecastResponse({
      input,
      scenarios,
      capacitySampleCount: capacity.sampleCount,
    });
  }

  private simulateScenarios(
    input: ForecastBuildInput,
    base: Omit<SimulationInput, "points">,
  ): ForecastScenarios {
    const weather = input.weatherResult;
    return {
      p10PvKwh: integrateRemainingPvKwh(weather.p10Points, input.now),
      p50PvKwh: integrateRemainingPvKwh(weather.points, input.now),
      p90PvKwh: integrateRemainingPvKwh(weather.p90Points, input.now),
      p10Simulation: this.simulate({ ...base, points: weather.p10Points }),
      p50Simulation: this.simulate({ ...base, points: weather.points }),
      p90Simulation: this.simulate({ ...base, points: weather.p90Points }),
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
    const homeW = finiteNonNegative(realtime.homeConsumptionW);
    if (config.consumptionExcludesCharging) return homeW;
    const states = await this.vehicleManager.getAllStates();
    const evW = [...states.values()]
      .filter((state) => state.isHome === true && state.isCharging)
      .reduce(
        (sum, state) => sum + finiteNonNegative(state.chargePowerKw) * 1000,
        0,
      );
    return Math.max(0, homeW - evW);
  }

  private async fetchPvForecast(
    latitude: number,
    longitude: number,
    installationDate: string,
    arrays: SolarArrayConfig[],
    timezone: string,
    now: Date,
    liveSolarW: number | null,
    configuredInverterAcMaxKw: number | null,
  ): Promise<WeatherForecastResult> {
    const ageFactor = panelAgeFactor(installationDate, now);
    const fingerprint = solarPredictionConfigurationFingerprint({
      latitude,
      longitude,
      installationDate,
      arrays,
      timezone,
      inverterAcMaxKw: configuredInverterAcMaxKw,
    });
    const learningState = await this.loadPredictionLearning(fingerprint);
    const providerForecasts = await this.fetchWeatherProviders(
      latitude,
      longitude,
      timezone,
      arrays,
      ageFactor,
    );
    if (providerForecasts.length === 0) {
      throw new Error("Weather forecast is empty");
    }
    const nominalW = arrays.reduce(
      (sum, array) => sum + array.capacityKwp * 1000,
      0,
    );
    const observedMaxW = await this.loadObservedSolarMaxW();
    const inverterCapW = resolveInverterCapW(
      nominalW,
      observedMaxW,
      configuredInverterAcMaxKw,
    );
    const clippedProviders = clipProviderForecasts(
      providerForecasts,
      inverterCapW,
    );
    const providerIds = clippedProviders.map((forecast) => forecast.provider);
    const initialWeights = solarProviderWeights(learningState, providerIds);
    const instantEnsemble = combineProviderForecasts(
      instantProviderForecasts(clippedProviders),
      initialWeights,
    );
    const providerPredictionsW = providerPredictionAt(clippedProviders, now);
    const updatedLearningState = learnFromCurrentForecast(
      learningState,
      closestPoint(instantEnsemble.points, now),
      now,
      timezone,
      liveSolarW,
      providerPredictionsW,
    );
    if (updatedLearningState !== learningState) {
      await this.persistPredictionLearning(updatedLearningState);
    }
    return correctedWeatherForecast({
      providerForecasts: clippedProviders,
      learningState: updatedLearningState,
      providerIds,
      inverterCapW,
      timezone,
      now,
      liveSolarW,
    });
  }

  private async loadObservedSolarMaxW(): Promise<number> {
    try {
      return await this.db.energy.getRecentObservedSolarMaxW(90);
    } catch (error) {
      this.logger.warn(
        "Solar forecast observed inverter ceiling unavailable",
        error,
      );
      return 0;
    }
  }

  private async fetchWeatherProviders(
    latitude: number,
    longitude: number,
    timezone: string,
    arrays: SolarArrayConfig[],
    ageFactor: number,
  ): Promise<ProviderForecast[]> {
    const settled = await Promise.allSettled(
      OPEN_METEO_PROVIDERS.map((provider) =>
        this.fetchProviderForecast(
          provider,
          latitude,
          longitude,
          timezone,
          arrays,
          ageFactor,
        )
      ),
    );
    settled.forEach((result, index) => {
      if (result.status === "rejected") {
        this.logger.debug(
          `Solar forecast provider ${
            OPEN_METEO_PROVIDERS[index].id
          } unavailable`,
          result.reason,
        );
      }
    });
    return settled.flatMap(fulfilledProviderForecast);
  }

  private async fetchProviderForecast(
    provider: { id: SolarWeatherProviderId; url: string },
    latitude: number,
    longitude: number,
    timezone: string,
    arrays: SolarArrayConfig[],
    ageFactor: number,
  ): Promise<ProviderForecast> {
    const arrayForecasts = await Promise.all(
      arrays.map((array) =>
        this.fetchArrayForecast(
          provider,
          latitude,
          longitude,
          timezone,
          array,
          ageFactor,
        )
      ),
    );
    return {
      provider: provider.id,
      points: combineArrayForecasts(arrayForecasts.map((item) => item.points)),
      instantPoints: combineArrayForecasts(
        arrayForecasts.map((item) => item.instantPoints),
      ),
    };
  }

  private async loadPredictionLearning(
    fingerprint: string,
  ): Promise<SolarPredictionLearningState> {
    try {
      const raw = await this.db.config.getConfig(SOLAR_PREDICTION_STATE_KEY);
      return learningStateForConfiguration(
        parseSolarPredictionLearning(raw),
        fingerprint,
      );
    } catch (error) {
      this.logger.warn("Solar prediction learning state unavailable", error);
      return learningStateForConfiguration(
        parseSolarPredictionLearning(null),
        fingerprint,
      );
    }
  }

  private async persistPredictionLearning(
    state: SolarPredictionLearningState,
  ): Promise<void> {
    try {
      await this.db.config.setConfig(
        SOLAR_PREDICTION_STATE_KEY,
        JSON.stringify(state),
      );
    } catch (error) {
      this.logger.warn(
        "Solar prediction learning state could not be saved",
        error,
      );
    }
  }

  private async fetchArrayForecast(
    provider: { id: SolarWeatherProviderId; url: string },
    latitude: number,
    longitude: number,
    timezone: string,
    array: SolarArrayConfig,
    ageFactor: number,
  ): Promise<ArrayForecast> {
    const url = new URL(provider.url);
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set(
      "minutely_15",
      "global_tilted_irradiance,global_tilted_irradiance_instant,temperature_2m,wind_speed_10m",
    );
    url.searchParams.set("tilt", String(array.tiltDeg));
    url.searchParams.set(
      "azimuth",
      String(toOpenMeteoAzimuth(array.azimuthDeg)),
    );
    url.searchParams.set("timezone", timezone);
    url.searchParams.set("timeformat", "unixtime");
    url.searchParams.set("wind_speed_unit", "ms");
    url.searchParams.set("forecast_days", "1");

    const response = await this.fetchFn(url, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`Open-Meteo ${provider.id} HTTP ${response.status}`);
    }
    const data = await response.json() as OpenMeteoResponse;
    const block = data.minutely_15;
    if (!block) return { points: [], instantPoints: [] };
    return buildArrayForecast(block, data.utc_offset_seconds, array, ageFactor);
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

function backgroundLearningSlot(at: Date): string {
  return String(Math.floor(at.getTime() / FORECAST_STEP_MS));
}

function createSimulationInput(
  input: ForecastBuildInput,
  schedules: EngineSchedule[],
  baseLoadW: number,
  vehicleCapacityKwh: number,
): Omit<SimulationInput, "points"> {
  return {
    now: input.now,
    vehicleId: input.vehicleId,
    vehicleName: input.vehicleName,
    mode: input.mode,
    priority: input.priority,
    initialState: input.state,
    controllerConfig: input.controllerConfig,
    schedules,
    forecastDayEnd: input.weatherResult.dayEnd,
    baseLoadW,
    initialBatteryPowerW: finiteNumber(input.realtime.batteryPowerW, 0),
    batterySoc: validSoc(input.realtime.batterySoc),
    homeBattery: resolveHomeBatteryForecastConfig(input.forecastConfig),
    subscribedPowerW: subscribedPowerW(input.forecastConfig),
    vehicleCapacityKwh,
  };
}

function buildForecastResponse(
  responseInput: ForecastResponseInput,
): SolarChargeForecastResult {
  const { input, scenarios, capacitySampleCount } = responseInput;
  const weather = input.weatherResult;
  const confidence = buildSolarPredictionConfidence({
    learningSamples: weather.learningSamples,
    learningCoverage: weather.learningCoverage,
    meanAbsPctError: weather.meanAbsPctError,
    empiricalIntervalPct: weather.empiricalIntervalPct,
    providerSpreadPct: weather.providerSpreadPct,
    providerCount: weather.providerCount,
    liveCorrection: weather.liveCorrection,
    vehicleCapacitySamples: capacitySampleCount,
  });
  const pvBounds = orderedBounds(
    scenarios.p10PvKwh,
    scenarios.p50PvKwh,
    scenarios.p90PvKwh,
  );
  const chargeBounds = orderedBounds(
    scenarios.p10Simulation.solarChargeKwh,
    scenarios.p50Simulation.solarChargeKwh,
    scenarios.p90Simulation.solarChargeKwh,
  );
  const simulation = scenarios.p50Simulation;
  return {
    available: true,
    vehicleId: input.vehicleId,
    mode: input.mode,
    generatedAt: input.now.toISOString(),
    timezone: input.timezone,
    pvRemainingKwh: round2(scenarios.p50PvKwh),
    solarChargeRemainingKwh: round2(simulation.solarChargeKwh),
    solarEndAt: simulation.solarEndAt,
    socAtSolarEnd: round1(simulation.socAtSolarEnd),
    finalSoc: round1(simulation.finalSoc),
    finalAt: simulation.finalAt,
    schedule: simulation.schedule,
    confidence: confidence.label,
    prediction: {
      version: "2.3",
      confidenceScore: confidence.score,
      regime: confidence.regime,
      learningSamples: weather.learningSamples,
      learningCoveragePct: round1(weather.learningCoverage * 100),
      empiricalIntervalPct: round1(weather.empiricalIntervalPct * 100),
      historicalCorrection: round2(weather.historicalCorrection),
      liveCorrection: round2(weather.liveCorrection),
      liveObservationUsed: weather.liveObservationUsed,
      providerSpreadPct: round1(weather.providerSpreadPct * 100),
      providerWeights: {
        meteofrance: round2(weather.providerWeights.meteofrance),
        dwdIcon: round2(weather.providerWeights.dwd_icon),
      },
      pvP10Kwh: round2(pvBounds.low),
      pvP50Kwh: round2(scenarios.p50PvKwh),
      pvP90Kwh: round2(pvBounds.high),
      solarChargeP10Kwh: round2(chargeBounds.low),
      solarChargeP50Kwh: round2(simulation.solarChargeKwh),
      solarChargeP90Kwh: round2(chargeBounds.high),
    },
  };
}

function orderedBounds(
  lowScenario: number,
  p50: number,
  highScenario: number,
): { low: number; high: number } {
  return {
    low: Math.min(lowScenario, p50),
    high: Math.max(highScenario, p50),
  };
}

function subscribedPowerW(config: SolarForecastConfig): number | null {
  if (config.solarForecastSubscribedPowerKva === null) return null;
  return config.solarForecastSubscribedPowerKva * 1000;
}

function fulfilledProviderForecast(
  result: PromiseSettledResult<ProviderForecast>,
): ProviderForecast[] {
  if (result.status !== "fulfilled") return [];
  return result.value.points.length > 0 ? [result.value] : [];
}

function clipProviderForecasts(
  forecasts: ProviderForecast[],
  inverterCapW: number,
): ProviderForecast[] {
  return forecasts.map((forecast) => ({
    provider: forecast.provider,
    points: clipPoints(forecast.points, inverterCapW),
    instantPoints: clipPoints(forecast.instantPoints, inverterCapW),
  }));
}

function clipPoints(points: PvPoint[], inverterCapW: number): PvPoint[] {
  return points.map((point) => ({
    ...point,
    powerW: Math.min(point.powerW, inverterCapW),
  }));
}

function instantProviderForecasts(
  forecasts: ProviderForecast[],
): ProviderForecast[] {
  return forecasts.map((forecast) => ({
    provider: forecast.provider,
    points: forecast.instantPoints,
    instantPoints: forecast.instantPoints,
  }));
}

function remainingProviderForecasts(
  forecasts: ProviderForecast[],
  now: Date,
): ProviderForecast[] {
  const nowMs = now.getTime();
  return forecasts.map((forecast) => ({
    provider: forecast.provider,
    points: forecast.points.filter((point) => point.at.getTime() > nowMs),
    instantPoints: forecast.instantPoints.filter((point) =>
      point.at.getTime() > nowMs
    ),
  }));
}

function learnFromCurrentForecast(
  state: SolarPredictionLearningState,
  currentPoint: PvPoint | null,
  now: Date,
  timezone: string,
  liveSolarW: number | null,
  providerPredictionsW: Partial<Record<SolarWeatherProviderId, number>>,
): SolarPredictionLearningState {
  if (!currentPoint || liveSolarW === null) return state;
  return updateSolarPredictionLearning(state, {
    at: now,
    timezone,
    predictedW: currentPoint.powerW,
    actualW: liveSolarW,
    providerPredictionsW,
  });
}

function correctedWeatherForecast(input: {
  providerForecasts: ProviderForecast[];
  learningState: SolarPredictionLearningState;
  providerIds: SolarWeatherProviderId[];
  inverterCapW: number;
  timezone: string;
  now: Date;
  liveSolarW: number | null;
}): WeatherForecastResult {
  const providerWeights = solarProviderWeights(
    input.learningState,
    input.providerIds,
  );
  const ensemble = combineProviderForecasts(
    input.providerForecasts,
    providerWeights,
  );
  const remainingEnsemble = combineProviderForecasts(
    remainingProviderForecasts(input.providerForecasts, input.now),
    providerWeights,
  );
  const providerSpreadPct = remainingEnsemble.spreadPct;
  const instantEnsemble = combineProviderForecasts(
    instantProviderForecasts(input.providerForecasts),
    providerWeights,
  );
  const historical = applyHistoricalCorrection(
    ensemble.points,
    input.learningState,
    input.timezone,
    input.inverterCapW,
  );
  const historicalInstant = applyHistoricalCorrection(
    instantEnsemble.points,
    input.learningState,
    input.timezone,
    input.inverterCapW,
  );
  const currentInstant = closestPoint(historicalInstant, input.now);
  const liveCorrection = resolveLiveCorrection(
    currentInstant,
    input.liveSolarW,
  );
  const liveObservationUsed = input.liveSolarW !== null &&
    currentInstant !== null && currentInstant.powerW >= 400;
  const corrected = applyLiveNowcast(
    historical,
    input.now,
    liveCorrection,
    input.inverterCapW,
  );
  const stats = aggregateLearningStats(
    input.learningState,
    remainingPredictionPoints(corrected, input.now),
    input.timezone,
  );
  const scenarios = buildPredictionScenarioPoints({
    points: corrected,
    state: input.learningState,
    timezone: input.timezone,
    now: input.now,
    liveCorrection,
    providerSpreadPct,
    providerCount: input.providerForecasts.length,
    inverterCapW: input.inverterCapW,
  });
  const last = corrected[corrected.length - 1];
  return {
    points: corrected,
    p10Points: scenarios.p10,
    p90Points: scenarios.p90,
    dayEnd: new Date(last.at.getTime() + FORECAST_STEP_MS),
    liveCorrection,
    liveObservationUsed,
    historicalCorrection: historicalCorrectionAt(
      input.learningState,
      input.now,
      input.timezone,
    ),
    providerSpreadPct,
    providerCount: input.providerForecasts.length,
    providerWeights,
    learningSamples: stats.sampleCount,
    learningCoverage: stats.learningCoverage,
    meanAbsPctError: stats.meanAbsPctError,
    empiricalIntervalPct: stats.empiricalIntervalPct,
  };
}

function applyHistoricalCorrection(
  points: PvPoint[],
  state: SolarPredictionLearningState,
  timezone: string,
  inverterCapW: number,
): PvPoint[] {
  return points.map((point) => ({
    ...point,
    powerW: Math.min(
      inverterCapW,
      point.powerW * historicalCorrectionAt(state, point.at, timezone),
    ),
  }));
}

function resolveLiveCorrection(
  currentPoint: PvPoint | null,
  liveSolarW: number | null,
): number {
  if (!currentPoint || currentPoint.powerW < 400 || liveSolarW === null) {
    return 1;
  }
  const rawRatio = liveSolarW / currentPoint.powerW;
  return clamp(0.55 + 0.45 * rawRatio, 0.65, 1.3);
}

function applyLiveNowcast(
  points: PvPoint[],
  now: Date,
  liveCorrection: number,
  inverterCapW: number,
): PvPoint[] {
  return points.map((point) => {
    const minutesAhead = (point.at.getTime() - now.getTime()) / MINUTE_MS;
    const factor = decayingLiveCorrection(liveCorrection, minutesAhead);
    return {
      ...point,
      powerW: Math.min(inverterCapW, Math.max(0, point.powerW * factor)),
    };
  });
}

function buildPredictionScenarioPoints(input: {
  points: PvPoint[];
  state: SolarPredictionLearningState;
  timezone: string;
  now: Date;
  liveCorrection: number;
  providerSpreadPct: number;
  providerCount: number;
  inverterCapW: number;
}): { p10: PvPoint[]; p90: PvPoint[] } {
  const scenarios = input.points.map((point) =>
    predictionScenarioPoint(input, point)
  );
  return {
    p10: scenarios.map((item) => item.p10),
    p90: scenarios.map((item) => item.p90),
  };
}

function predictionScenarioPoint(
  input: Parameters<typeof buildPredictionScenarioPoints>[0],
  point: PvPoint,
): { p10: PvPoint; p90: PvPoint } {
  const minutesAhead = (point.at.getTime() - input.now.getTime()) / MINUTE_MS;
  const interval = predictionPointIntervalPct({
    state: input.state,
    at: point.at,
    timezone: input.timezone,
    providerSpreadPct: input.providerSpreadPct,
    providerCount: input.providerCount,
    liveCorrection: input.liveCorrection,
    minutesAhead,
  });
  return {
    p10: { ...point, powerW: Math.max(0, point.powerW * (1 - interval)) },
    p90: {
      ...point,
      powerW: Math.min(input.inverterCapW, point.powerW * (1 + interval)),
    },
  };
}

function remainingPredictionPoints(points: PvPoint[], now: Date): PvPoint[] {
  return points.filter((point) => point.at.getTime() > now.getTime());
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
  if (state.isHome !== true) {
    return unavailable(
      "vehicle_away",
      state.isHome === false
        ? "Solar forecast is only available for charging at home."
        : "Home location must be confirmed before solar charging is available.",
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

export function estimatePanelTemperatureC(
  ambientC: number,
  irradianceWm2: number,
  windSpeedMs: number,
): number {
  const irradiance = Math.max(0, irradianceWm2);
  const wind = Math.max(0, windSpeedMs);
  return ambientC + irradiance / (FAIMAN_U0 + FAIMAN_U1 * wind);
}

type LiveSolarData =
  & Pick<EnergyData, "solarProductionW" | "lastUpdated">
  & Partial<
    Pick<
      EnergyData,
      "gridPowerW" | "homeConsumptionW" | "batteryPowerW" | "batterySoc"
    >
  >;

export function usableLiveSolarPowerW(
  realtime: LiveSolarData,
  now: Date,
): number | null {
  if (sourceLooksOffline(realtime)) return null;
  if (
    !Number.isFinite(realtime.solarProductionW) || realtime.solarProductionW < 0
  ) {
    return null;
  }
  const observedAt = Date.parse(realtime.lastUpdated);
  if (!Number.isFinite(observedAt)) return null;
  const ageMs = now.getTime() - observedAt;
  if (
    ageMs < -LIVE_SOLAR_FUTURE_TOLERANCE_MS || ageMs > LIVE_SOLAR_MAX_AGE_MS
  ) {
    return null;
  }
  return realtime.solarProductionW;
}

function sourceLooksOffline(realtime: LiveSolarData): boolean {
  return realtime.solarProductionW === 0 && realtime.gridPowerW === 0 &&
    realtime.homeConsumptionW === 0 && realtime.batteryPowerW === null &&
    realtime.batterySoc === null;
}

export function openMeteoTimeToDate(
  value: number | string,
  utcOffsetSeconds: number,
): Date {
  if (typeof value === "number") return new Date(value * 1000);
  return localApiTimeToDate(value, utcOffsetSeconds);
}

function localApiTimeToDate(localIso: string, utcOffsetSeconds: number): Date {
  const utcLike = Date.parse(`${localIso}:00Z`);
  return new Date(utcLike - utcOffsetSeconds * 1000);
}

function buildArrayForecast(
  block: NonNullable<OpenMeteoResponse["minutely_15"]>,
  utcOffsetSeconds: number,
  array: SolarArrayConfig,
  ageFactor: number,
): ArrayForecast {
  const rows = block.time.map((time, index) => {
    const averageGti = Math.max(0, block.global_tilted_irradiance[index] ?? 0);
    const instantGti = Math.max(
      0,
      block.global_tilted_irradiance_instant?.[index] ?? averageGti,
    );
    const ambientC = block.temperature_2m[index] ?? 20;
    const windMs = Math.max(0, block.wind_speed_10m?.[index] ?? 1);
    const at = openMeteoTimeToDate(time, utcOffsetSeconds);
    return {
      average: {
        at,
        powerW: pvPowerFromWeather(
          array,
          averageGti,
          ambientC,
          windMs,
          ageFactor,
        ),
      },
      instant: {
        at,
        powerW: pvPowerFromWeather(
          array,
          instantGti,
          ambientC,
          windMs,
          ageFactor,
        ),
      },
    };
  });
  return {
    points: rows.map((row) => row.average),
    instantPoints: rows.map((row) => row.instant),
  };
}

function pvPowerFromWeather(
  array: SolarArrayConfig,
  gti: number,
  ambientC: number,
  windMs: number,
  ageFactor: number,
): number {
  const panelC = estimatePanelTemperatureC(ambientC, gti, windMs);
  const tempFactor = clamp(
    1 + PANEL_TEMP_COEFFICIENT * (panelC - 25),
    0.75,
    1.08,
  );
  const powerW = array.capacityKwp * 1000 * (gti / 1000) * ageFactor *
    tempFactor * BASE_SYSTEM_EFFICIENCY;
  return Math.max(0, powerW);
}

function solarPredictionConfigurationFingerprint(input: {
  latitude: number;
  longitude: number;
  installationDate: string;
  arrays: SolarArrayConfig[];
  timezone: string;
  inverterAcMaxKw: number | null;
}): string {
  const arrays = [...input.arrays]
    .map((array) => ({
      capacityKwp: array.capacityKwp,
      azimuthDeg: array.azimuthDeg,
      tiltDeg: array.tiltDeg,
    }))
    .sort((a, b) =>
      a.azimuthDeg - b.azimuthDeg || a.tiltDeg - b.tiltDeg ||
      a.capacityKwp - b.capacityKwp
    );
  return JSON.stringify({
    latitude: input.latitude,
    longitude: input.longitude,
    installationDate: input.installationDate,
    timezone: input.timezone,
    inverterAcMaxKw: input.inverterAcMaxKw,
    arrays,
  });
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

function combineProviderForecasts(
  forecasts: ProviderForecast[],
  weights: Record<SolarWeatherProviderId, number>,
): { points: PvPoint[]; spreadPct: number } {
  const samples = forecasts.flatMap((forecast) =>
    forecast.points.map((point) => ({
      timestamp: point.at.getTime(),
      powerW: point.powerW,
      weight: weights[forecast.provider],
    }))
  );
  const byTimestamp = samples.reduce((result, sample) => {
    const values = result.get(sample.timestamp) ?? [];
    result.set(sample.timestamp, [
      ...values,
      { powerW: sample.powerW, weight: sample.weight },
    ]);
    return result;
  }, new Map<number, Array<{ powerW: number; weight: number }>>());
  const combined = [...byTimestamp.entries()].reduce(
    (result, [timestamp, values]) => {
      const stats = weightedProviderPoint(timestamp, values);
      return {
        points: [...result.points, stats.point],
        spreadWeightedSum: result.spreadWeightedSum + stats.spreadWeighted,
        spreadPowerSum: result.spreadPowerSum + stats.spreadPower,
      };
    },
    {
      points: [] as PvPoint[],
      spreadWeightedSum: 0,
      spreadPowerSum: 0,
    },
  );
  return {
    points: combined.points.sort((a, b) => a.at.getTime() - b.at.getTime()),
    spreadPct: resolveProviderSpread(
      forecasts.length,
      combined.spreadWeightedSum,
      combined.spreadPowerSum,
    ),
  };
}

function weightedProviderPoint(
  timestamp: number,
  values: Array<{ powerW: number; weight: number }>,
): { point: PvPoint; spreadWeighted: number; spreadPower: number } {
  const totalWeight = values.reduce((sum, value) => sum + value.weight, 0);
  const normalizer = totalWeight > 0 ? totalWeight : values.length;
  const powerW = values.reduce(
    (sum, value) =>
      sum + value.powerW * effectiveWeight(value.weight, totalWeight),
    0,
  ) / normalizer;
  const point = { at: new Date(timestamp), powerW };
  if (values.length <= 1 || powerW < 200) {
    return { point, spreadWeighted: 0, spreadPower: 0 };
  }
  const deviation = values.reduce(
    (sum, value) =>
      sum + Math.abs(value.powerW - powerW) *
        effectiveWeight(value.weight, totalWeight),
    0,
  ) / normalizer;
  return {
    point,
    spreadWeighted: deviation,
    spreadPower: powerW,
  };
}

function effectiveWeight(weight: number, totalWeight: number): number {
  return totalWeight > 0 ? weight : 1;
}

function resolveProviderSpread(
  forecastCount: number,
  weightedSum: number,
  powerSum: number,
): number {
  if (forecastCount < 2) return 0.25;
  if (powerSum <= 0) return 0.08;
  return clamp(weightedSum / powerSum, 0, 0.7);
}

function providerPredictionAt(
  forecasts: ProviderForecast[],
  at: Date,
): Partial<Record<SolarWeatherProviderId, number>> {
  return forecasts.reduce<Partial<Record<SolarWeatherProviderId, number>>>(
    (result, forecast) => {
      const point = closestPoint(forecast.instantPoints, at);
      if (point) result[forecast.provider] = point.powerW;
      return result;
    },
    {},
  );
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
    candidate.at.getTime() - atMs <= FORECAST_STEP_MS
  );
  return point?.powerW ?? 0;
}

export function integrateRemainingPvKwh(points: PvPoint[], now: Date): number {
  const nowMs = now.getTime();
  return points.reduce((sum, point) => {
    const intervalEnd = point.at.getTime();
    const intervalStart = intervalEnd - FORECAST_STEP_MS;
    const remainingMs = Math.min(
      FORECAST_STEP_MS,
      Math.max(0, intervalEnd - Math.max(nowMs, intervalStart)),
    );
    return sum + point.powerW * (remainingMs / 3_600_000) / 1000;
  }, 0);
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

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteNumber(value: number | null, fallback: number): number {
  return value !== null && Number.isFinite(value) ? value : fallback;
}

function validSoc(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value >= 0 && value <= 100 ? value : null;
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
