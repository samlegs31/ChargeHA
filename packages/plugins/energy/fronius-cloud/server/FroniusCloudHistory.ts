import type { FroniusCloudAdapter } from "./FroniusCloudAdapter.ts";
import type { VehicleChargeHistoryRowInput } from "@chargeha/server/db/repositories/HistoryRepository";

const HISTORY_CHANNELS = [
  "EnergyEVCCharge",
  "EnergyEVCChargeBatt",
  "EnergyEVCChargeGrid",
] as const;
const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;

interface SolarWebHistoryChannel {
  channelName?: string;
  value?: number | string | null;
}

interface SolarWebHistorySample {
  logDateTime?: string;
  logDuration?: number;
  channels?: SolarWebHistoryChannel[];
}

interface SolarWebHistoryResponse {
  data?: SolarWebHistorySample[];
}

interface HistoryPagesResult {
  samplesRead: number;
  rows: VehicleChargeHistoryRowInput[];
}

export interface FroniusCloudHistoryResult extends HistoryPagesResult {
  chargedWh: number;
  solarWh: number;
  batteryWh: number;
  gridWh: number;
}

function channelValue(
  channels: readonly SolarWebHistoryChannel[],
  name: string,
): number {
  const raw = channels.find((channel) => channel.channelName === name)?.value;
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function sqliteUtc(logDateTime: string): string {
  const date = new Date(logDateTime);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid Solar.web history timestamp: ${logDateTime}`);
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function sqliteLocal(logDateTime: string): string {
  const localPart = logDateTime.slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(localPart)) {
    throw new Error(`Invalid Solar.web local timestamp: ${logDateTime}`);
  }
  return localPart.replace("T", " ");
}

function sampleToRow(
  pvSystemId: string,
  sample: SolarWebHistorySample,
): VehicleChargeHistoryRowInput | null {
  if (!sample.logDateTime) return null;
  const channels = sample.channels ?? [];
  const solarWh = channelValue(channels, "EnergyEVCCharge");
  const batteryWh = channelValue(channels, "EnergyEVCChargeBatt");
  const gridWh = channelValue(channels, "EnergyEVCChargeGrid");
  const chargedWh = solarWh + batteryWh + gridWh;
  if (chargedWh <= 0) return null;

  return {
    source: "solarweb",
    externalId: `${pvSystemId}:${sample.logDateTime}`,
    startTimeUtc: sqliteUtc(sample.logDateTime),
    startTimeLocal: sqliteLocal(sample.logDateTime),
    intervalSeconds: Math.max(1, Math.round(sample.logDuration ?? 300)),
    chargedWh,
    solarWh,
    batteryWh,
    gridWh,
    awayWh: 0,
    atHomeWh: chargedWh,
  };
}

function toHistoryRows(
  pvSystemId: string,
  samples: readonly SolarWebHistorySample[],
): VehicleChargeHistoryRowInput[] {
  return samples
    .map((sample) => sampleToRow(pvSystemId, sample))
    .filter((row): row is VehicleChargeHistoryRowInput => row !== null);
}

async function fetchHistoryPages(
  adapter: FroniusCloudAdapter,
  pvSystemId: string,
  fromIso: string,
  toIso: string,
  page = 0,
): Promise<HistoryPagesResult> {
  if (page >= MAX_PAGES) {
    throw new Error(
      "Solar.web history exceeded the safe pagination limit; import a smaller date range",
    );
  }

  const params = new URLSearchParams({
    from: fromIso,
    to: toIso,
    timezone: "local",
    channel: HISTORY_CHANNELS.join(","),
    offset: String(page * PAGE_SIZE),
    limit: String(PAGE_SIZE),
  });
  const response = await adapter.fetchApi(
    `/pvsystems/${pvSystemId}/histdata?${params.toString()}`,
  );
  const body = await response.json() as SolarWebHistoryResponse;
  const samples = Array.isArray(body.data) ? body.data : [];
  const currentRows = toHistoryRows(pvSystemId, samples);

  if (samples.length < PAGE_SIZE) {
    return { samplesRead: samples.length, rows: currentRows };
  }

  const remaining = await fetchHistoryPages(
    adapter,
    pvSystemId,
    fromIso,
    toIso,
    page + 1,
  );
  return {
    samplesRead: samples.length + remaining.samplesRead,
    rows: [...currentRows, ...remaining.rows],
  };
}

/**
 * Read energy delivered by the Wattpilot to EVs from Solar.web history.
 * Fronius exposes generator, battery and grid contributions separately but
 * does not identify the vehicle, so these rows are stored as aggregate EV
 * history rather than being attached to a car.
 */
export async function fetchFroniusCloudEvHistory(
  adapter: FroniusCloudAdapter,
  pvSystemId: string,
  fromIso: string,
  toIso: string,
): Promise<FroniusCloudHistoryResult> {
  const history = await fetchHistoryPages(
    adapter,
    pvSystemId,
    fromIso,
    toIso,
  );
  return {
    ...history,
    chargedWh: history.rows.reduce((sum, row) => sum + row.chargedWh, 0),
    solarWh: history.rows.reduce((sum, row) => sum + row.solarWh, 0),
    batteryWh: history.rows.reduce((sum, row) => sum + row.batteryWh, 0),
    gridWh: history.rows.reduce((sum, row) => sum + row.gridWh, 0),
  };
}
