import type { VehicleChargeHistoryRowInput } from "../db/repositories/HistoryRepository.ts";

const BASE_URL = "https://api.solarweb.com/swqapi";
const ACCESS_KEY_ID = "FKIAB4CDA71C0763413DA942DC756742318B";
const ACCESS_KEY_VALUE = "67315e19-6805-479e-994d-7193ee5f6125";
const SOLARWEB_USER_AGENT = "Solar.web/921 CFNetwork/1410.0.3 Darwin/22.6.0";
const HISTORY_CHANNELS = ["EnergyEVCCharge", "EnergyEVCChargeBatt", "EnergyEVCChargeGrid"] as const;
const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
interface SolarWebHistoryChannel { channelName?: string; value?: number | string | null; }
interface SolarWebHistorySample { logDateTime?: string; logDuration?: number; channels?: SolarWebHistoryChannel[]; }
interface SolarWebHistoryResponse { data?: SolarWebHistorySample[]; }
interface PageResult { samplesRead: number; rows: VehicleChargeHistoryRowInput[]; }
export interface SolarWebHistoryImportInput { email: string; password: string; pvSystemId: string; from: string; to: string; }
export interface SolarWebHistoryResult extends PageResult { chargedWh: number; solarWh: number; batteryWh: number; gridWh: number; }
export class SolarWebHistoryError extends Error { constructor(message: string) { super(message); this.name = "SolarWebHistoryError"; } }

function commonHeaders(): Record<string, string> {
  return { AccessKeyId: ACCESS_KEY_ID, AccessKeyValue: ACCESS_KEY_VALUE, Accept: "application/json", "User-Agent": SOLARWEB_USER_AGENT };
}

async function responseErrorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    if (!text) return "";
    // Keep diagnostics bounded and single-line. The response body comes from Solar.web
    // and does not contain the request Authorization header or submitted password.
    return text.replace(/\s+/g, " ").slice(0, 1000);
  } catch {
    return "";
  }
}

async function login(email: string, password: string, fetchFn: FetchFn): Promise<string> {
  const response = await fetchFn(`${BASE_URL}/iam/jwt`, {
    method: "POST",
    headers: { ...commonHeaders(), "Content-Type": "application/json-patch+json" },
    body: JSON.stringify({ userId: email, password }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await responseErrorDetail(response);
    throw new SolarWebHistoryError(`Solar.web login failed: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`);
  }
  const body = await response.json() as { jwtToken?: string; accessToken?: string };
  const token = body.jwtToken ?? body.accessToken;
  if (!token) throw new SolarWebHistoryError("Solar.web login returned no access token");
  return token;
}

async function fetchJson(path: string, token: string, fetchFn: FetchFn): Promise<SolarWebHistoryResponse> {
  const response = await fetchFn(`${BASE_URL}${path}`, {
    headers: { ...commonHeaders(), Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await responseErrorDetail(response);
    const message = `Solar.web history request failed: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`;
    console.error(`[solarweb-history] ${message}`);
    throw new SolarWebHistoryError(message);
  }
  return await response.json() as SolarWebHistoryResponse;
}

function channelValue(channels: readonly SolarWebHistoryChannel[], name: string): number {
  const raw = channels.find((channel) => channel.channelName === name)?.value;
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function sqliteUtc(logDateTime: string): string {
  const date = new Date(logDateTime);
  if (!Number.isFinite(date.getTime())) throw new SolarWebHistoryError(`Invalid Solar.web timestamp: ${logDateTime}`);
  return date.toISOString().slice(0, 19).replace("T", " ");
}
function sqliteLocal(logDateTime: string): string {
  const local = logDateTime.slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local)) throw new SolarWebHistoryError(`Invalid Solar.web local timestamp: ${logDateTime}`);
  return local.replace("T", " ");
}
function sampleToRow(pvSystemId: string, sample: SolarWebHistorySample): VehicleChargeHistoryRowInput | null {
  if (!sample.logDateTime) return null;
  const channels = sample.channels ?? [];
  const solarWh = channelValue(channels, "EnergyEVCCharge");
  const batteryWh = channelValue(channels, "EnergyEVCChargeBatt");
  const gridWh = channelValue(channels, "EnergyEVCChargeGrid");
  const chargedWh = solarWh + batteryWh + gridWh;
  if (chargedWh <= 0) return null;
  return { source: "solarweb", externalId: `${pvSystemId}:${sample.logDateTime}`, startTimeUtc: sqliteUtc(sample.logDateTime), startTimeLocal: sqliteLocal(sample.logDateTime), intervalSeconds: Math.max(1, Math.round(sample.logDuration ?? 300)), chargedWh, solarWh, batteryWh, gridWh, awayWh: 0, atHomeWh: chargedWh };
}
function shiftedDayIso(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().replace(".000Z", "Z");
}
async function fetchPages(token: string, pvSystemId: string, fromIso: string, toIso: string, fetchFn: FetchFn, page = 0): Promise<PageResult> {
  if (page >= MAX_PAGES) throw new SolarWebHistoryError("Solar.web history is too large; import a smaller date range");
  const params = new URLSearchParams({ from: fromIso, to: toIso, timezone: "local", channel: HISTORY_CHANNELS.join(","), offset: String(page * PAGE_SIZE), limit: String(PAGE_SIZE) });
  const body = await fetchJson(`/pvsystems/${encodeURIComponent(pvSystemId)}/histdata?${params.toString()}`, token, fetchFn);
  const samples = Array.isArray(body.data) ? body.data : [];
  const currentRows = samples.map((sample) => sampleToRow(pvSystemId, sample)).filter((row): row is VehicleChargeHistoryRowInput => row !== null);
  if (samples.length < PAGE_SIZE) return { samplesRead: samples.length, rows: currentRows };
  const remaining = await fetchPages(token, pvSystemId, fromIso, toIso, fetchFn, page + 1);
  return { samplesRead: samples.length + remaining.samplesRead, rows: [...currentRows, ...remaining.rows] };
}
function sumWh(rows: readonly VehicleChargeHistoryRowInput[], pick: (row: VehicleChargeHistoryRowInput) => number): number { return rows.reduce((sum, row) => sum + pick(row), 0); }
export async function fetchSolarWebHomeEvHistory(input: SolarWebHistoryImportInput, fetchFn: FetchFn = fetch): Promise<SolarWebHistoryResult> {
  const token = await login(input.email, input.password, fetchFn);
  const history = await fetchPages(token, input.pvSystemId, shiftedDayIso(input.from, -1), shiftedDayIso(input.to, 2), fetchFn);
  const rows = history.rows.filter((row) => { const date = row.startTimeLocal.slice(0, 10); return date >= input.from && date <= input.to; });
  return { samplesRead: history.samplesRead, rows, chargedWh: sumWh(rows, (row) => row.chargedWh), solarWh: sumWh(rows, (row) => row.solarWh), batteryWh: sumWh(rows, (row) => row.batteryWh), gridWh: sumWh(rows, (row) => row.gridWh) };
}
