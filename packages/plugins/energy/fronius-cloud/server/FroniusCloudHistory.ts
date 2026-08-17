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

export interface FroniusCloudHistoryResult {
  samplesRead: number;
  rows: VehicleChargeHistoryRowInput[];
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

/**
 * Read Wattpilot charging energy from the Solar.web historical PV-system
 * endpoint. Fronius exposes generator, battery and grid contribution as
 * separate Wh channels, which maps directly to E.V Solar's charge-history
 * model without reconstructing power samples.
 */
export async function fetchFroniusCloudEvHistory(
  adapter: FroniusCloudAdapter,
  pvSystemId: string,
  fromIso: string,
  toIso: string,
): Promise<FroniusCloudHistoryResult> {
  const rows: VehicleChargeHistoryRowInput[] = [];
  let samplesRead = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
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
    samplesRead += samples.length;

    for (const sample of samples) {
      const row = sampleToRow(pvSystemId, sample);
      if (row) rows.push(row);
    }

    if (samples.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) {
      throw new Error(
        "Solar.web history exceeded the safe pagination limit; import a smaller date range",
      );
    }
  }

  return {
    samplesRead,
    rows,
    chargedWh: rows.reduce((sum, row) => sum + row.chargedWh, 0),
    solarWh: rows.reduce((sum, row) => sum + row.solarWh, 0),
    batteryWh: rows.reduce((sum, row) => sum + row.batteryWh, 0),
    gridWh: rows.reduce((sum, row) => sum + row.gridWh, 0),
  };
}
