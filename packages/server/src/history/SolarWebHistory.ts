import type { VehicleChargeHistoryRowInput } from "../db/repositories/HistoryRepository.ts";

const BASE_URL = "https://api.solarweb.com/swqapi";
const ACCESS_KEY_ID = "FKIAB4CDA71C0763413DA942DC756742318B";
const ACCESS_KEY_VALUE = "67315e19-6805-479e-994d-7193ee5f6125";
const SOLARWEB_USER_AGENT = "Solar.web/921 CFNetwork/1410.0.3 Darwin/22.6.0";
const HISTORY_CHANNELS = [
  "EnergyEVCCharge",
  "EnergyEVCChargeBatt",
  "EnergyEVCChargeGrid",
] as const;
const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;
const MAX_RANGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MIN_REQUEST_INTERVAL_MS = 6_100;
const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_RETRY_AFTER_MS = 5 * 60_000;
const MAX_RATE_LIMIT_RETRIES = 5;

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

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

interface PageResult {
  samplesRead: number;
  rows: VehicleChargeHistoryRowInput[];
}

interface WattpilotEnergySplit {
  chargedWh: number;
  solarWh: number;
  batteryWh: number;
  gridWh: number;
}

export interface SolarWebHistoryImportInput {
  email: string;
  password: string;
  pvSystemId: string;
  from: string;
  to: string;
}

export interface SolarWebHistoryResult extends PageResult {
  chargedWh: number;
  solarWh: number;
  batteryWh: number;
  gridWh: number;
}

export class SolarWebHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolarWebHistoryError";
  }
}

const solarWebRateLimitState = {
  lastRequestStartedAt: 0,
  tail: Promise.resolve(),
};

function commonHeaders(): Record<string, string> {
  return {
    AccessKeyId: ACCESS_KEY_ID,
    AccessKeyValue: ACCESS_KEY_VALUE,
    Accept: "application/json",
    "User-Agent": SOLARWEB_USER_AGENT,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reserveSolarWebRequestSlot(fetchFn: FetchFn): Promise<void> {
  // Unit tests inject a fake fetch implementation and should not wait in real time.
  // Production imports use the global fetch and share this limiter across batches.
  if (fetchFn !== fetch) return;

  const reservation = solarWebRateLimitState.tail.then(async () => {
    const waitMs = Math.max(
      0,
      solarWebRateLimitState.lastRequestStartedAt + MIN_REQUEST_INTERVAL_MS -
        Date.now(),
    );
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    solarWebRateLimitState.lastRequestStartedAt = Date.now();
  });
  solarWebRateLimitState.tail = reservation.catch(() => undefined);
  await reservation;
}

async function responseErrorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    if (!text) return "";
    return text.replace(/\s+/g, " ").slice(0, 1000);
  } catch {
    return "";
  }
}

function retryAfterMs(response: Response, detail: string): number {
  const retryAfter = response.headers.get("Retry-After")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(seconds * 1000));
    }

    const retryDate = Date.parse(retryAfter);
    if (Number.isFinite(retryDate)) {
      return Math.min(
        MAX_RETRY_AFTER_MS,
        Math.max(0, retryDate - Date.now()),
      );
    }
  }

  const bodyMatch = detail.match(/retry\s+after\s*:?\s*(\d+(?:\.\d+)?)/i);
  if (bodyMatch) {
    const seconds = Number(bodyMatch[1]);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(seconds * 1000));
    }
  }

  return DEFAULT_RETRY_AFTER_MS;
}

async function solarWebRequest(
  url: string,
  init: RequestInit,
  fetchFn: FetchFn,
  operation: string,
  retry = 0,
): Promise<Response> {
  await reserveSolarWebRequestSlot(fetchFn);
  const response = await fetchFn(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status !== 429) {
    return response;
  }

  const detail = await responseErrorDetail(response);
  if (retry >= MAX_RATE_LIMIT_RETRIES) {
    throw new SolarWebHistoryError(
      `Solar.web API rate limit persisted after ${retry + 1} attempts: HTTP 429${
        detail ? ` — ${detail}` : ""
      }`,
    );
  }

  const waitMs = retryAfterMs(response, detail);
  console.warn(
    `[solarweb-history] Solar.web API rate limit reached during ${operation}; retrying in ${
      Math.ceil(waitMs / 1000)
    }s`,
  );
  await sleep(waitMs);
  return await solarWebRequest(
    url,
    init,
    fetchFn,
    operation,
    retry + 1,
  );
}

async function login(
  email: string,
  password: string,
  fetchFn: FetchFn,
): Promise<string> {
  const response = await solarWebRequest(
    `${BASE_URL}/iam/jwt`,
    {
      method: "POST",
      headers: {
        ...commonHeaders(),
        "Content-Type": "application/json-patch+json",
      },
      body: JSON.stringify({ userId: email, password }),
    },
    fetchFn,
    "login",
  );
  if (!response.ok) {
    const detail = await responseErrorDetail(response);
    throw new SolarWebHistoryError(
      `Solar.web login failed: HTTP ${response.status}${
        detail ? ` — ${detail}` : ""
      }`,
    );
  }
  const body = await response.json() as {
    jwtToken?: string;
    accessToken?: string;
  };
  const token = body.jwtToken ?? body.accessToken;
  if (!token) {
    throw new SolarWebHistoryError("Solar.web login returned no access token");
  }
  return token;
}

async function fetchJson(
  path: string,
  token: string,
  fetchFn: FetchFn,
): Promise<SolarWebHistoryResponse> {
  const response = await solarWebRequest(
    `${BASE_URL}${path}`,
    {
      headers: {
        ...commonHeaders(),
        Authorization: `Bearer ${token}`,
      },
    },
    fetchFn,
    "history import",
  );
  if (!response.ok) {
    const detail = await responseErrorDetail(response);
    const message = `Solar.web history request failed: HTTP ${response.status}${
      detail ? ` — ${detail}` : ""
    }`;
    console.error(`[solarweb-history] ${message}`);
    throw new SolarWebHistoryError(message);
  }
  return await response.json() as SolarWebHistoryResponse;
}

function channelValue(
  channels: readonly SolarWebHistoryChannel[],
  name: string,
): number {
  const raw = channels.find((channel) => channel.channelName === name)?.value;
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function splitWattpilotEnergy(
  totalRawWh: number,
  batteryRawWh: number,
  gridRawWh: number,
): WattpilotEnergySplit {
  const knownSourceWh = batteryRawWh + gridRawWh;
  // Solar.web's internal channel names are not publicly documented in detail.
  // Treat EnergyEVCCharge conservatively as the interval total and the Battery /
  // Grid channels as components. If the total channel is absent, known source
  // components still provide a safe lower-bound total with no invented solar.
  const chargedWh = totalRawWh > 0 ? totalRawWh : knownSourceWh;
  if (chargedWh <= 0) {
    return { chargedWh: 0, solarWh: 0, batteryWh: 0, gridWh: 0 };
  }

  if (knownSourceWh <= chargedWh) {
    return {
      chargedWh,
      solarWh: chargedWh - knownSourceWh,
      batteryWh: batteryRawWh,
      gridWh: gridRawWh,
    };
  }

  // Telemetry rounding or inconsistent samples must never create more source
  // energy than the measured charge. Preserve Battery/Grid proportions while
  // scaling them back to the authoritative interval total.
  const batteryWh = chargedWh * (batteryRawWh / knownSourceWh);
  return {
    chargedWh,
    solarWh: 0,
    batteryWh,
    gridWh: chargedWh - batteryWh,
  };
}

function sqliteUtc(logDateTime: string): string {
  const date = new Date(logDateTime);
  if (!Number.isFinite(date.getTime())) {
    throw new SolarWebHistoryError(`Invalid Solar.web timestamp: ${logDateTime}`);
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function sqliteLocal(logDateTime: string): string {
  const local = logDateTime.slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local)) {
    throw new SolarWebHistoryError(
      `Invalid Solar.web local timestamp: ${logDateTime}`,
    );
  }
  return local.replace("T", " ");
}

function sampleToRow(
  pvSystemId: string,
  sample: SolarWebHistorySample,
): VehicleChargeHistoryRowInput | null {
  if (!sample.logDateTime) return null;
  const channels = sample.channels ?? [];
  const totalRawWh = channelValue(channels, "EnergyEVCCharge");
  const batteryRawWh = channelValue(channels, "EnergyEVCChargeBatt");
  const gridRawWh = channelValue(channels, "EnergyEVCChargeGrid");
  const { chargedWh, solarWh, batteryWh, gridWh } = splitWattpilotEnergy(
    totalRawWh,
    batteryRawWh,
    gridRawWh,
  );
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

function shiftedDayIso(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().replace(".000Z", "Z");
}

async function fetchPages(
  token: string,
  pvSystemId: string,
  fromIso: string,
  toIso: string,
  fetchFn: FetchFn,
  page = 0,
): Promise<PageResult> {
  if (page >= MAX_PAGES) {
    throw new SolarWebHistoryError(
      "Solar.web history is too large; import a smaller date range",
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
  const body = await fetchJson(
    `/pvsystems/${encodeURIComponent(pvSystemId)}/histdata?${params.toString()}`,
    token,
    fetchFn,
  );
  const samples = Array.isArray(body.data) ? body.data : [];
  const currentRows = samples
    .map((sample) => sampleToRow(pvSystemId, sample))
    .filter((row): row is VehicleChargeHistoryRowInput => row !== null);
  if (samples.length < PAGE_SIZE) {
    return { samplesRead: samples.length, rows: currentRows };
  }
  const remaining = await fetchPages(
    token,
    pvSystemId,
    fromIso,
    toIso,
    fetchFn,
    page + 1,
  );
  return {
    samplesRead: samples.length + remaining.samplesRead,
    rows: [...currentRows, ...remaining.rows],
  };
}

async function fetchRangeChunks(
  token: string,
  pvSystemId: string,
  cursorMs: number,
  endMs: number,
  fetchFn: FetchFn,
): Promise<PageResult> {
  if (cursorMs >= endMs) {
    return { samplesRead: 0, rows: [] };
  }

  const chunkEndMs = Math.min(cursorMs + MAX_RANGE_MS, endMs);
  const current = await fetchPages(
    token,
    pvSystemId,
    new Date(cursorMs).toISOString().replace(".000Z", "Z"),
    new Date(chunkEndMs).toISOString().replace(".000Z", "Z"),
    fetchFn,
  );
  const remaining = await fetchRangeChunks(
    token,
    pvSystemId,
    chunkEndMs,
    endMs,
    fetchFn,
  );

  return {
    samplesRead: current.samplesRead + remaining.samplesRead,
    rows: [...current.rows, ...remaining.rows],
  };
}

function deduplicateRows(
  rows: readonly VehicleChargeHistoryRowInput[],
): VehicleChargeHistoryRowInput[] {
  return Array.from(
    new Map(rows.map((row) => [row.externalId, row] as const)).values(),
  );
}

function sumWh(
  rows: readonly VehicleChargeHistoryRowInput[],
  pick: (row: VehicleChargeHistoryRowInput) => number,
): number {
  return rows.reduce((sum, row) => sum + pick(row), 0);
}

export async function fetchSolarWebHomeEvHistory(
  input: SolarWebHistoryImportInput,
  fetchFn: FetchFn = fetch,
): Promise<SolarWebHistoryResult> {
  const token = await login(input.email, input.password, fetchFn);
  const startMs = new Date(shiftedDayIso(input.from, -1)).getTime();
  const endMs = new Date(shiftedDayIso(input.to, 2)).getTime();
  const history = await fetchRangeChunks(
    token,
    input.pvSystemId,
    startMs,
    endMs,
    fetchFn,
  );
  const rows = deduplicateRows(history.rows).filter((row) => {
    const date = row.startTimeLocal.slice(0, 10);
    return date >= input.from && date <= input.to;
  });
  return {
    samplesRead: history.samplesRead,
    rows,
    chargedWh: sumWh(rows, (row) => row.chargedWh),
    solarWh: sumWh(rows, (row) => row.solarWh),
    batteryWh: sumWh(rows, (row) => row.batteryWh),
    gridWh: sumWh(rows, (row) => row.gridWh),
  };
}
