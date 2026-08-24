export type SolarWeatherProviderId = "meteofrance" | "dwd_icon";

export interface SolarPredictionLearningBucket {
  correction: number;
  meanAbsPctError: number;
  sampleCount: number;
  lastObservedSlot: string | null;
  recentAbsPctErrors: number[];
}

export interface SolarPredictionProviderLearning {
  meanAbsPctError: number;
  sampleCount: number;
  lastObservedSlot: string | null;
}

export interface SolarPredictionLearningState {
  version: 2;
  configurationFingerprint: string | null;
  buckets: Record<string, SolarPredictionLearningBucket>;
  providers: Partial<
    Record<SolarWeatherProviderId, SolarPredictionProviderLearning>
  >;
}

export interface SolarPredictionObservation {
  at: Date;
  timezone: string;
  predictedW: number;
  actualW: number;
  providerPredictionsW?: Partial<Record<SolarWeatherProviderId, number>>;
}

export interface SolarPredictionConfidenceInput {
  learningSamples: number;
  learningCoverage: number;
  meanAbsPctError: number;
  empiricalIntervalPct: number;
  providerSpreadPct: number;
  providerCount: number;
  liveCorrection: number;
  vehicleCapacitySamples: number;
}

export interface SolarPredictionConfidence {
  score: number;
  label: "high" | "medium" | "low";
  intervalPct: number;
  regime: "stable" | "variable" | "uncertain";
}

export interface SolarPredictionWeightedPoint {
  at: Date;
  powerW: number;
}

export interface SolarPredictionAggregateStats {
  sampleCount: number;
  meanAbsPctError: number;
  learningCoverage: number;
  empiricalIntervalPct: number;
}

const OBSERVATION_SLOT_MS = 15 * 60_000;
const MIN_LEARNING_POWER_W = 400;
const MAX_RECENT_ERRORS = 24;
const UNLEARNED_ERROR = 0.3;

export function emptySolarPredictionLearningState(): SolarPredictionLearningState {
  return {
    version: 2,
    configurationFingerprint: null,
    buckets: {},
    providers: {},
  };
}

export function learningStateForConfiguration(
  state: SolarPredictionLearningState,
  fingerprint: string,
): SolarPredictionLearningState {
  if (state.configurationFingerprint === fingerprint) return state;
  return {
    ...emptySolarPredictionLearningState(),
    configurationFingerprint: fingerprint,
  };
}

export function parseSolarPredictionLearning(
  raw: string | null,
): SolarPredictionLearningState {
  if (!raw) return emptySolarPredictionLearningState();
  try {
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeLearningState(parsed);
  } catch {
    return emptySolarPredictionLearningState();
  }
}

function sanitizeLearningState(value: unknown): SolarPredictionLearningState {
  if (!isRecord(value) || value.version !== 2) {
    return emptySolarPredictionLearningState();
  }
  return {
    version: 2,
    configurationFingerprint: typeof value.configurationFingerprint === "string"
      ? value.configurationFingerprint
      : null,
    buckets: sanitizeBuckets(value.buckets),
    providers: sanitizeProviders(value.providers),
  };
}

function sanitizeBuckets(value: unknown): Record<string, SolarPredictionLearningBucket> {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, SolarPredictionLearningBucket>>(
    (result, [key, bucket]) => {
      const sanitized = sanitizeBucket(bucket);
      return sanitized ? { ...result, [key]: sanitized } : result;
    },
    {},
  );
}

function sanitizeBucket(value: unknown): SolarPredictionLearningBucket | null {
  if (!isRecord(value)) return null;
  if (!finiteInRange(value.correction, 0.5, 1.5)) return null;
  if (!finiteInRange(value.meanAbsPctError, 0, 1)) return null;
  if (!finiteInRange(value.sampleCount, 0, 1_000_000)) return null;
  const errors = Array.isArray(value.recentAbsPctErrors)
    ? value.recentAbsPctErrors.filter((item) => finiteInRange(item, 0, 1))
    : [];
  return {
    correction: value.correction as number,
    meanAbsPctError: value.meanAbsPctError as number,
    sampleCount: Math.floor(value.sampleCount as number),
    lastObservedSlot: typeof value.lastObservedSlot === "string"
      ? value.lastObservedSlot
      : null,
    recentAbsPctErrors: errors.slice(-MAX_RECENT_ERRORS) as number[],
  };
}

function sanitizeProviders(
  value: unknown,
): SolarPredictionLearningState["providers"] {
  if (!isRecord(value)) return {};
  return (["meteofrance", "dwd_icon"] as SolarWeatherProviderId[]).reduce(
    (result, provider) => {
      const sanitized = sanitizeProvider(value[provider]);
      return sanitized ? { ...result, [provider]: sanitized } : result;
    },
    {} as SolarPredictionLearningState["providers"],
  );
}

function sanitizeProvider(value: unknown): SolarPredictionProviderLearning | null {
  if (!isRecord(value)) return null;
  if (!finiteInRange(value.meanAbsPctError, 0, 1)) return null;
  if (!finiteInRange(value.sampleCount, 0, 1_000_000)) return null;
  return {
    meanAbsPctError: value.meanAbsPctError as number,
    sampleCount: Math.floor(value.sampleCount as number),
    lastObservedSlot: typeof value.lastObservedSlot === "string"
      ? value.lastObservedSlot
      : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= min && value <= max;
}

export function updateSolarPredictionLearning(
  state: SolarPredictionLearningState,
  observation: SolarPredictionObservation,
): SolarPredictionLearningState {
  if (!validObservation(observation)) return state;
  const slot = observationSlot(observation.at);
  const key = learningBucketKey(observation.at, observation.timezone);
  const existing = state.buckets[key] ?? emptyLearningBucket();
  if (existing.lastObservedSlot === slot) return state;

  const ratio = clamp(observation.actualW / observation.predictedW, 0.65, 1.35);
  const error = observationError(observation.actualW, observation.predictedW);
  const alpha = existing.sampleCount < 4 ? 0.22 : 0.08;
  const bucket = updatedLearningBucket(existing, ratio, error, alpha, slot);
  const providers = updatedProviderLearnings(state.providers, observation, slot);
  return {
    ...state,
    buckets: { ...state.buckets, [key]: bucket },
    providers,
  };
}

function validObservation(observation: SolarPredictionObservation): boolean {
  if (!Number.isFinite(observation.predictedW)) return false;
  if (!Number.isFinite(observation.actualW)) return false;
  return observation.predictedW >= MIN_LEARNING_POWER_W && observation.actualW >= 0;
}

function emptyLearningBucket(): SolarPredictionLearningBucket {
  return {
    correction: 1,
    meanAbsPctError: 0.25,
    sampleCount: 0,
    lastObservedSlot: null,
    recentAbsPctErrors: [],
  };
}

function updatedLearningBucket(
  existing: SolarPredictionLearningBucket,
  ratio: number,
  error: number,
  alpha: number,
  slot: string,
): SolarPredictionLearningBucket {
  const meanAbsPctError = existing.sampleCount === 0
    ? error
    : existing.meanAbsPctError + alpha * (error - existing.meanAbsPctError);
  return {
    correction: clamp(
      existing.correction + alpha * (ratio - existing.correction),
      0.75,
      1.25,
    ),
    meanAbsPctError,
    sampleCount: existing.sampleCount + 1,
    lastObservedSlot: slot,
    recentAbsPctErrors: [...existing.recentAbsPctErrors, error].slice(
      -MAX_RECENT_ERRORS,
    ),
  };
}

function updatedProviderLearnings(
  current: SolarPredictionLearningState["providers"],
  observation: SolarPredictionObservation,
  slot: string,
): SolarPredictionLearningState["providers"] {
  return Object.entries(observation.providerPredictionsW ?? {}).reduce(
    (providers, [rawProvider, rawPrediction]) => {
      if (!isSolarWeatherProvider(rawProvider)) return providers;
      if (!Number.isFinite(rawPrediction)) return providers;
      const predictedW = rawPrediction as number;
      if (predictedW < MIN_LEARNING_POWER_W) return providers;
      const previous = providers[rawProvider] ?? emptyProviderLearning();
      if (previous.lastObservedSlot === slot) return providers;
      return {
        ...providers,
        [rawProvider]: updatedProviderLearning(
          previous,
          observation.actualW,
          predictedW,
          slot,
        ),
      };
    },
    { ...current },
  );
}

function updatedProviderLearning(
  previous: SolarPredictionProviderLearning,
  actualW: number,
  predictedW: number,
  slot: string,
): SolarPredictionProviderLearning {
  const error = observationError(actualW, predictedW);
  const alpha = previous.sampleCount < 5 ? 0.2 : 0.08;
  const meanAbsPctError = previous.sampleCount === 0
    ? error
    : previous.meanAbsPctError + alpha * (error - previous.meanAbsPctError);
  return {
    meanAbsPctError,
    sampleCount: previous.sampleCount + 1,
    lastObservedSlot: slot,
  };
}

function emptyProviderLearning(): SolarPredictionProviderLearning {
  return { meanAbsPctError: 0.25, sampleCount: 0, lastObservedSlot: null };
}

function isSolarWeatherProvider(value: string): value is SolarWeatherProviderId {
  return value === "meteofrance" || value === "dwd_icon";
}

function observationError(actualW: number, predictedW: number): number {
  return clamp(Math.abs(actualW - predictedW) / predictedW, 0, 1);
}

export function historicalCorrectionAt(
  state: SolarPredictionLearningState,
  at: Date,
  timezone: string,
): number {
  const bucket = state.buckets[learningBucketKey(at, timezone)];
  if (!bucket || bucket.sampleCount === 0) return 1;
  const trust = Math.min(0.85, bucket.sampleCount / 20);
  return clamp(1 + (bucket.correction - 1) * trust, 0.8, 1.2);
}

export function learningStatsAt(
  state: SolarPredictionLearningState,
  at: Date,
  timezone: string,
): { sampleCount: number; meanAbsPctError: number } {
  const bucket = state.buckets[learningBucketKey(at, timezone)];
  if (!bucket) return { sampleCount: 0, meanAbsPctError: UNLEARNED_ERROR };
  return {
    sampleCount: bucket.sampleCount,
    meanAbsPctError: bucket.meanAbsPctError,
  };
}

export function aggregateLearningStats(
  state: SolarPredictionLearningState,
  points: SolarPredictionWeightedPoint[],
  timezone: string,
): SolarPredictionAggregateStats {
  const relevant = points.filter((point) =>
    Number.isFinite(point.powerW) && point.powerW >= 100
  );
  const totalWeight = relevant.reduce((sum, point) => sum + point.powerW, 0);
  if (totalWeight <= 0) return emptyAggregateStats();
  const sums = relevant.reduce(
    (result, point) => aggregatePoint(result, state, point, timezone),
    emptyAggregateSums(),
  );
  return {
    sampleCount: Math.round(sums.sampleWeighted / totalWeight),
    meanAbsPctError: sums.errorWeighted / totalWeight,
    learningCoverage: sums.learnedWeight / totalWeight,
    empiricalIntervalPct: sums.intervalWeighted / totalWeight,
  };
}

function aggregatePoint(
  result: AggregateSums,
  state: SolarPredictionLearningState,
  point: SolarPredictionWeightedPoint,
  timezone: string,
): AggregateSums {
  const bucket = state.buckets[learningBucketKey(point.at, timezone)];
  const learned = Boolean(bucket && bucket.sampleCount > 0);
  const error = learned ? bucket?.meanAbsPctError ?? UNLEARNED_ERROR : UNLEARNED_ERROR;
  const interval = empiricalIntervalAt(state, point.at, timezone);
  return {
    sampleWeighted: result.sampleWeighted + (bucket?.sampleCount ?? 0) * point.powerW,
    errorWeighted: result.errorWeighted + error * point.powerW,
    intervalWeighted: result.intervalWeighted + interval * point.powerW,
    learnedWeight: result.learnedWeight + (learned ? point.powerW : 0),
  };
}

interface AggregateSums {
  sampleWeighted: number;
  errorWeighted: number;
  intervalWeighted: number;
  learnedWeight: number;
}

function emptyAggregateSums(): AggregateSums {
  return {
    sampleWeighted: 0,
    errorWeighted: 0,
    intervalWeighted: 0,
    learnedWeight: 0,
  };
}

function emptyAggregateStats(): SolarPredictionAggregateStats {
  return {
    sampleCount: 0,
    meanAbsPctError: UNLEARNED_ERROR,
    learningCoverage: 0,
    empiricalIntervalPct: UNLEARNED_ERROR,
  };
}

export function empiricalIntervalAt(
  state: SolarPredictionLearningState,
  at: Date,
  timezone: string,
): number {
  const bucket = state.buckets[learningBucketKey(at, timezone)];
  if (!bucket || bucket.sampleCount < 4) return UNLEARNED_ERROR;
  if (bucket.recentAbsPctErrors.length === 0) {
    return clamp(bucket.meanAbsPctError * 1.5, 0.1, 0.45);
  }
  return clamp(percentile(bucket.recentAbsPctErrors, 0.8), 0.08, 0.45);
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return UNLEARNED_ERROR;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(quantile * sorted.length) - 1),
  );
  return sorted[index];
}

export function predictionPointIntervalPct(input: {
  state: SolarPredictionLearningState;
  at: Date;
  timezone: string;
  providerSpreadPct: number;
  providerCount: number;
  liveCorrection: number;
  minutesAhead: number;
}): number {
  const empirical = empiricalIntervalAt(input.state, input.at, input.timezone);
  const providerPenalty = input.providerCount < 2 ? 0.06 : 0;
  const spreadTerm = clamp(input.providerSpreadPct, 0, 0.7) * 0.55;
  const liveFactor = decayingLiveCorrection(
    input.liveCorrection,
    Math.max(0, input.minutesAhead),
  );
  const liveTerm = Math.abs(liveFactor - 1) * 0.35;
  return clamp(
    Math.max(empirical, 0.08 + providerPenalty + spreadTerm + liveTerm),
    0.08,
    0.5,
  );
}

export function solarProviderWeights(
  state: SolarPredictionLearningState,
  providers: SolarWeatherProviderId[],
): Record<SolarWeatherProviderId, number> {
  if (providers.length === 0) return emptyProviderWeights();
  if (providers.length === 1) {
    return { ...emptyProviderWeights(), [providers[0]]: 1 };
  }
  const raw = providers.map((provider) => ({
    provider,
    value: rawProviderWeight(state, provider),
  }));
  const total = raw.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return equalProviderWeights(providers);
  const normalized = raw.reduce<Record<SolarWeatherProviderId, number>>(
    (result, item) => ({
      ...result,
      [item.provider]: item.value / total,
    }),
    emptyProviderWeights(),
  );
  return boundedTwoProviderWeights(normalized, providers);
}

function rawProviderWeight(
  state: SolarPredictionLearningState,
  provider: SolarWeatherProviderId,
): number {
  const prior = provider === "meteofrance" ? 0.6 : 0.4;
  const learned = state.providers[provider];
  if (!learned || learned.sampleCount < 8) return prior;
  return prior / Math.max(0.08, learned.meanAbsPctError);
}

function equalProviderWeights(
  providers: SolarWeatherProviderId[],
): Record<SolarWeatherProviderId, number> {
  const equal = 1 / providers.length;
  return providers.reduce<Record<SolarWeatherProviderId, number>>(
    (result, provider) => ({ ...result, [provider]: equal }),
    emptyProviderWeights(),
  );
}

function boundedTwoProviderWeights(
  weights: Record<SolarWeatherProviderId, number>,
  providers: SolarWeatherProviderId[],
): Record<SolarWeatherProviderId, number> {
  if (providers.length !== 2) return weights;
  const first = providers[0];
  const second = providers[1];
  const firstWeight = clamp(weights[first], 0.2, 0.8);
  return { ...weights, [first]: firstWeight, [second]: 1 - firstWeight };
}

function emptyProviderWeights(): Record<SolarWeatherProviderId, number> {
  return { meteofrance: 0, dwd_icon: 0 };
}

export function nowcastInfluence(minutesAhead: number): number {
  if (minutesAhead <= 30) return 1;
  if (minutesAhead <= 120) {
    return 1 - (minutesAhead - 30) / 90 * 0.45;
  }
  if (minutesAhead <= 360) {
    return 0.55 * (1 - (minutesAhead - 120) / 240);
  }
  return 0;
}

export function decayingLiveCorrection(
  liveCorrection: number,
  minutesAhead: number,
): number {
  const influence = nowcastInfluence(Math.max(0, minutesAhead));
  return clamp(1 + (liveCorrection - 1) * influence, 0.65, 1.3);
}

export function buildSolarPredictionConfidence(
  input: SolarPredictionConfidenceInput,
): SolarPredictionConfidence {
  const learnedError = clamp(input.meanAbsPctError, 0, 0.7);
  const spread = clamp(input.providerSpreadPct, 0, 0.7);
  const coverage = clamp(input.learningCoverage, 0, 1);
  const liveDeviation = Math.abs(input.liveCorrection - 1);
  const sampleBonus = Math.min(14, input.learningSamples * 0.7);
  const coverageBonus = coverage * 14;
  const providerBonus = input.providerCount >= 2 ? 10 : -5;
  const capacityPenalty = vehicleCapacityPenalty(input.vehicleCapacitySamples);
  const rawScore = 50 + sampleBonus + coverageBonus + providerBonus -
    learnedError * 38 - spread * 30 - liveDeviation * 26 - capacityPenalty;
  const score = Math.round(clamp(rawScore, 20, 97));
  const intervalPct = confidenceIntervalPct(input, learnedError, spread, coverage);
  return {
    score,
    label: confidenceLabel(score),
    intervalPct,
    regime: confidenceRegime(spread, liveDeviation, coverage),
  };
}

function vehicleCapacityPenalty(samples: number): number {
  if (samples === 0) return 10;
  return samples < 5 ? 4 : 0;
}

function confidenceIntervalPct(
  input: SolarPredictionConfidenceInput,
  learnedError: number,
  spread: number,
  coverage: number,
): number {
  const providerPenalty = input.providerCount < 2 ? 0.08 : 0;
  const liveDeviation = Math.abs(input.liveCorrection - 1);
  const heuristic = 0.08 + (1 - coverage) * 0.14 + learnedError * 0.45 +
    spread * 0.5 + liveDeviation * 0.2 + providerPenalty;
  return clamp(Math.max(input.empiricalIntervalPct, heuristic), 0.08, 0.5);
}

function confidenceLabel(score: number): "high" | "medium" | "low" {
  if (score >= 80) return "high";
  if (score >= 55) return "medium";
  return "low";
}

function confidenceRegime(
  spread: number,
  liveDeviation: number,
  coverage: number,
): "stable" | "variable" | "uncertain" {
  if (coverage < 0.35) return "uncertain";
  if (spread <= 0.12 && liveDeviation <= 0.12 && coverage >= 0.7) return "stable";
  if (spread <= 0.25 && liveDeviation <= 0.25) return "variable";
  return "uncertain";
}

export function predictionEnvelope(
  p50Kwh: number,
  intervalPct: number,
): { p10Kwh: number; p90Kwh: number } {
  const spread = clamp(intervalPct, 0, 0.6);
  return {
    p10Kwh: Math.max(0, p50Kwh * (1 - spread)),
    p90Kwh: Math.max(0, p50Kwh * (1 + spread)),
  };
}

export function learningBucketKey(at: Date, timezone: string): string {
  const parts = localMonthHour(at, timezone);
  const hourBlock = Math.floor(parts.hour / 2) * 2;
  return `m${String(parts.month).padStart(2, "0")}-h${
    String(hourBlock).padStart(2, "0")
  }`;
}

function localMonthHour(
  at: Date,
  timezone: string,
): { month: number; hour: number } {
  try {
    return formattedMonthHour(at, timezone || "UTC");
  } catch {
    return { month: at.getUTCMonth() + 1, hour: at.getUTCHours() };
  }
}

function formattedMonthHour(
  at: Date,
  timezone: string,
): { month: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    month: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  if (Number.isFinite(month) && Number.isFinite(hour)) return { month, hour };
  return { month: at.getUTCMonth() + 1, hour: at.getUTCHours() };
}

function observationSlot(at: Date): string {
  return String(Math.floor(at.getTime() / OBSERVATION_SLOT_MS));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
