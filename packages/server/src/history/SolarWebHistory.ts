import type { VehicleChargeHistoryRowInput } from "../db/repositories/HistoryRepository.ts";

const BASE_URL = "https://api.solarweb.com/swqapi";
const ACCESS_KEY_ID = "FKIAB4CDA71C0763413DA942DC756742318B";
const ACCESS_KEY_VALUE = "67315e19-6805-479e-994d-7193ee5f6125";
const SOLARWEB_USER_AGENT = "Solar.web/921 CFNetwork/1410.0.3 Darwin/22.6.0";
const REQUEST_TIMEOUT_MS = 10_000;
const MIN_REQUEST_INTERVAL_MS = 6_100;
const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_RETRY_AFTER_MS = 5 * 60_000;
const MAX_RATE_LIMIT_RETRIES = 5;
const DAILY_ANCHOR_TIME = "12:00:00";

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface SolarWebChannel {
  channelName?: string;
  value?: number | string | null;
}

interface SolarWebAggregateSample {
  logDate?: string;
  logDateTime?: string;
  channels?: SolarWebChannel[];
}

interface SolarWebAggregateResponse {
  data?: SolarWebAggregateSample[];
}

interface AggregateResult {
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

export interface SolarWebHistoryResult extends AggregateResult {
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
  // Production imports share this limiter so Solar.web's 10 requests/minute quota
  // is respected even if several batches are imported one after another.
  if (fetchFn !== fetch) return;

  const reservation = solarWebRateLimitState.tail.then(async () => {
    const waitMs = Math.max(
      0,
      solarWebRateLimitState.lastRequestStartedAt + MIN_REQUEST_INTERVAL_MS -
        Date.now(),
    );
    if (waitMs > 0) await sleep(waitMs);
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
      return Math.ceil(seconds * 1000);
    }

    const retryDate = Date.parse(retryAfter);
    if (Number.isFinite(retryDate)) {
      return Math.max(0, retryDate - Date.now());
    }
  }

  const bodyMatch = detail.match(/retry\s+after\s*:?\s*(\d+(?:\.\d+)?)/i);
  if (bodyMatch) {
    const seconds = Number(bodyMatch[1]);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.ceil(seconds * 1000);
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

  if (response.status !== 429) return response;

  const detail = await responseErrorDetail(response);
  if (retry >= MAX_RATE_LIMIT_RETRIES) {
    throw new SolarWebHistoryError(
      `Solar.web API rate limit persisted after ${
        retry + 1
      } attempts: HTTP 429${detail ? ` — ${detail}` : ""}`,
    );
  }

  const waitMs = retryAfterMs(response, detail);
  if (waitMs > MAX_RETRY_AFTER_MS) {
    throw new SolarWebHistoryError(
      `Solar.web quota requires waiting ${
        Math.ceil(waitMs / 60_000)
      } minutes. Retry the import later; no early retry was sent.`,
    );
  }
  console.warn(
    `[solarweb-history] Solar.web API rate limit reached during ${operation}; retrying in ${
      Math.ceil(waitMs / 1000)
    }s`,
  );
  await sleep(waitMs);
  return await solarWebRequest(url, init, fetchFn, operation, retry + 1);
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
): Promise<SolarWebAggregateResponse> {
  const response = await solarWebRequest(
    `${BASE_URL}${path}`,
    {
      headers: {
        ...commonHeaders(),
        Authorization: `Bearer ${token}`,
      },
    },
    fetchFn,
    "Wattpilot aggregate import",
  );
  if (!response.ok) {
    const detail = await responseErrorDetail(response);
    const message =
      `Solar.web aggregate request failed: HTTP ${response.status}${
        detail ? ` — ${detail}` : ""
      }`;
    console.error(`[solarweb-history] ${message}`);
    throw new SolarWebHistoryError(message);
  }
  return await response.json() as SolarWebAggregateResponse;
}

function channelValue(
  channels: readonly SolarWebChannel[],
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

  // Solar.web can contain small rounding inconsistencies. Never attribute more
  // source energy than the authoritative Wattpilot total.
  const batteryWh = chargedWh * (batteryRawWh / knownSourceWh);
  return {
    chargedWh,
    solarWh: 0,
    batteryWh,
    gridWh: chargedWh - batteryWh,
  };
}

function aggregateDate(sample: SolarWebAggregateSample): string | null {
  const raw = sample.logDate ?? sample.logDateTime;
  if (typeof raw !== "string") return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function aggregateToRow(
  pvSystemId: string,
  sample: SolarWebAggregateSample,
): VehicleChargeHistoryRowInput | null {
  const date = aggregateDate(sample);
  if (date === null) return null;

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

  // Wattpilot energy is exposed by Solar.web as a daily aggregate, not as a
  // 5-minute charging-session time series. Anchor each daily total at noon with
  // a one-second nominal interval so month/year/day totals remain exact without
  // pretending the car charged for the full day or suppressing unrelated away
  // sessions through a broad overlap window.
  const anchor = `${date} ${DAILY_ANCHOR_TIME}`;
  return {
    source: "solarweb",
    externalId: `${pvSystemId}:wattpilot-day:${date}`,
    startTimeUtc: anchor,
    startTimeLocal: anchor,
    intervalSeconds: 1,
    chargedWh,
    solarWh,
    batteryWh,
    gridWh,
    awayWh: 0,
    atHomeWh: chargedWh,
  };
}

async function fetchAggregates(
  token: string,
  pvSystemId: string,
  from: string,
  to: string,
  fetchFn: FetchFn,
): Promise<AggregateResult> {
  // The live Solar.web aggregate response already contains the complete daily
  // channel list. Avoid a channel filter here so the request matches the
  // production response shape observed on a real Wattpilot installation.
  const params = new URLSearchParams({ from, to });
  const body = await fetchJson(
    `/pvsystems/${
      encodeURIComponent(pvSystemId)
    }/aggrdata?${params.toString()}`,
    token,
    fetchFn,
  );
  const samples = Array.isArray(body.data) ? body.data : [];
  const rows = samples
    .map((sample) => aggregateToRow(pvSystemId, sample))
    .filter((row): row is VehicleChargeHistoryRowInput => row !== null)
    .filter((row) => {
      const date = row.startTimeLocal.slice(0, 10);
      return date >= from && date <= to;
    });
  return { samplesRead: samples.length, rows };
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
  const history = await fetchAggregates(
    token,
    input.pvSystemId,
    input.from,
    input.to,
    fetchFn,
  );
  const rows = deduplicateRows(history.rows);
  return {
    samplesRead: history.samplesRead,
    rows,
    chargedWh: sumWh(rows, (row) => row.chargedWh),
    solarWh: sumWh(rows, (row) => row.solarWh),
    batteryWh: sumWh(rows, (row) => row.batteryWh),
    gridWh: sumWh(rows, (row) => row.gridWh),
  };
}
