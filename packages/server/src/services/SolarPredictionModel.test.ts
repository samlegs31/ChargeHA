import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  aggregateLearningStats,
  buildSolarPredictionConfidence,
  decayingLiveCorrection,
  emptySolarPredictionLearningState,
  historicalCorrectionAt,
  learningBucketKey,
  learningStateForConfiguration,
  nowcastInfluence,
  parseSolarPredictionLearning,
  predictionEnvelope,
  predictionPointIntervalPct,
  solarProviderWeights,
  updateSolarPredictionLearning,
} from "./SolarPredictionModel.ts";

Deno.test("SolarPredictionModel recovers safely from corrupt persisted state", () => {
  assertEquals(parseSolarPredictionLearning("not-json"), {
    version: 2,
    configurationFingerprint: null,
    buckets: {},
    providers: {},
  });
});

Deno.test("SolarPredictionModel drops malformed persisted buckets", () => {
  const parsed = parseSolarPredictionLearning(JSON.stringify({
    version: 2,
    configurationFingerprint: "pv-a",
    buckets: {
      good: {
        correction: 0.95,
        meanAbsPctError: 0.12,
        sampleCount: 4,
        lastObservedSlot: "1",
        recentAbsPctErrors: [0.1, 0.2],
      },
      bad: { correction: "wrong" },
    },
    providers: {},
  }));
  assertEquals(Object.keys(parsed.buckets), ["good"]);
  assertEquals(parsed.configurationFingerprint, "pv-a");
});

Deno.test("SolarPredictionModel resets learning when PV configuration changes", () => {
  const configured = learningStateForConfiguration(
    emptySolarPredictionLearningState(),
    "pv-a",
  );
  const learned = updateSolarPredictionLearning(configured, {
    at: new Date("2026-08-24T12:00:00Z"),
    timezone: "Europe/Paris",
    predictedW: 4_000,
    actualW: 3_200,
  });
  const unchanged = learningStateForConfiguration(learned, "pv-a");
  const reset = learningStateForConfiguration(learned, "pv-b");
  assertEquals(unchanged, learned);
  assertEquals(Object.keys(reset.buckets).length, 0);
  assertEquals(reset.configurationFingerprint, "pv-b");
});

Deno.test("SolarPredictionModel learns at most once per 15 minute slot", () => {
  const initial = emptySolarPredictionLearningState();
  const at = new Date("2026-08-24T12:00:00Z");
  const learned = updateSolarPredictionLearning(initial, {
    at,
    timezone: "Europe/Paris",
    predictedW: 4_000,
    actualW: 3_200,
  });
  const duplicate = updateSolarPredictionLearning(learned, {
    at: new Date("2026-08-24T12:08:00Z"),
    timezone: "Europe/Paris",
    predictedW: 4_000,
    actualW: 2_000,
  });

  const bucket = Object.values(learned.buckets)[0];
  assertEquals(bucket.sampleCount, 1);
  assertEquals(bucket.recentAbsPctErrors.length, 1);
  assertEquals(duplicate, learned);
});

Deno.test("SolarPredictionModel historical correction remains conservative", () => {
  const state = Array.from({ length: 8 }, (_, index) => index).reduce(
    (current, index) =>
      updateSolarPredictionLearning(current, {
        at: new Date(Date.UTC(2026, 7, 24 + index, 12, 0, 0)),
        timezone: "Europe/Paris",
        predictedW: 4_000,
        actualW: 3_200,
      }),
    emptySolarPredictionLearningState(),
  );
  const correction = historicalCorrectionAt(
    state,
    new Date("2026-08-30T12:00:00Z"),
    "Europe/Paris",
  );
  assert(correction < 1);
  assert(correction >= 0.8);
});

Deno.test("SolarPredictionModel nowcast fades out over six hours", () => {
  assertEquals(nowcastInfluence(15), 1);
  assertAlmostEquals(nowcastInfluence(120), 0.55, 0.0001);
  assertEquals(nowcastInfluence(360), 0);
  assertEquals(nowcastInfluence(500), 0);
  assertAlmostEquals(decayingLiveCorrection(0.8, 15), 0.8, 0.0001);
  assertAlmostEquals(decayingLiveCorrection(0.8, 360), 1, 0.0001);
});

Deno.test("SolarPredictionModel shifts weight toward the reliable provider", () => {
  const state = Array.from({ length: 10 }, (_, index) => index).reduce(
    (current, index) =>
      updateSolarPredictionLearning(current, {
        at: new Date(Date.UTC(2026, 7, 24, 8, index * 15, 0)),
        timezone: "Europe/Paris",
        predictedW: 4_000,
        actualW: 4_000,
        providerPredictionsW: {
          meteofrance: 4_050,
          dwd_icon: 2_800,
        },
      }),
    emptySolarPredictionLearningState(),
  );
  const weights = solarProviderWeights(state, ["meteofrance", "dwd_icon"]);
  assert(weights.meteofrance > weights.dwd_icon);
  assert(weights.meteofrance <= 0.8);
  assertAlmostEquals(weights.meteofrance + weights.dwd_icon, 1, 0.0001);
});

Deno.test("SolarPredictionModel aggregates learning over future energy buckets", () => {
  const learned = Array.from({ length: 6 }, (_, index) => index).reduce(
    (current, index) =>
      updateSolarPredictionLearning(current, {
        at: new Date(Date.UTC(2026, 7, 24 + index, 8, 0, 0)),
        timezone: "UTC",
        predictedW: 4_000,
        actualW: 3_600,
      }),
    emptySolarPredictionLearningState(),
  );
  const stats = aggregateLearningStats(learned, [
    { at: new Date("2026-08-30T08:30:00Z"), powerW: 4_000 },
    { at: new Date("2026-08-30T12:30:00Z"), powerW: 4_000 },
  ], "UTC");
  assert(stats.sampleCount > 0);
  assertAlmostEquals(stats.learningCoverage, 0.5, 0.001);
  assert(stats.meanAbsPctError > 0.1);
});

Deno.test("SolarPredictionModel uses empirical residuals for point intervals", () => {
  const learned = Array.from({ length: 8 }, (_, index) => index).reduce(
    (current, index) =>
      updateSolarPredictionLearning(current, {
        at: new Date(Date.UTC(2026, 7, 24 + index, 10, 0, 0)),
        timezone: "UTC",
        predictedW: 4_000,
        actualW: index < 6 ? 3_200 : 2_800,
      }),
    emptySolarPredictionLearningState(),
  );
  const interval = predictionPointIntervalPct({
    state: learned,
    at: new Date("2026-08-30T10:30:00Z"),
    timezone: "UTC",
    providerSpreadPct: 0.02,
    providerCount: 2,
    liveCorrection: 1,
    minutesAhead: 180,
  });
  assert(interval >= 0.2);
});

Deno.test("SolarPredictionModel widens its interval when uncertainty is high", () => {
  const stable = buildSolarPredictionConfidence({
    learningSamples: 20,
    learningCoverage: 0.9,
    meanAbsPctError: 0.08,
    empiricalIntervalPct: 0.12,
    providerSpreadPct: 0.05,
    providerCount: 2,
    liveCorrection: 1.02,
    vehicleCapacitySamples: 6,
  });
  const uncertain = buildSolarPredictionConfidence({
    learningSamples: 0,
    learningCoverage: 0,
    meanAbsPctError: 0.3,
    empiricalIntervalPct: 0.3,
    providerSpreadPct: 0.35,
    providerCount: 1,
    liveCorrection: 0.72,
    vehicleCapacitySamples: 0,
  });
  assert(stable.score > uncertain.score);
  assert(stable.intervalPct < uncertain.intervalPct);
  assertEquals(stable.regime, "stable");
  assertEquals(uncertain.regime, "uncertain");

  const envelope = predictionEnvelope(20, uncertain.intervalPct);
  assert(envelope.p10Kwh < 20);
  assert(envelope.p90Kwh > 20);
});

Deno.test("SolarPredictionModel tolerates an invalid timezone", () => {
  const key = learningBucketKey(
    new Date("2026-08-24T12:00:00Z"),
    "Not/A-Timezone",
  );
  assertEquals(key, "m08-h12");
});
