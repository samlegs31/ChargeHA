export interface ChargingHistoryTokenProvider {
  getAccessToken(): Promise<string>;
  getFleetApiBaseUrl(): Promise<string>;
}

export interface ChargingHistoryInput {
  vin: string;
  from: string;
  to: string;
}

export interface ChargingHistoryRow {
  source: "vehicle-history";
  externalId: string;
  startTimeUtc: string;
  startTimeLocal: string;
  intervalSeconds: number;
  chargedWh: number;
  solarWh: number;
  batteryWh: number;
  gridWh: number;
  awayWh: number;
  atHomeWh: number;
}

export interface ChargingHistoryArchive {
  rows: ChargingHistoryRow[];
  pagesRead: number;
  sessionsRead: number;
  sessionsMatched: number;
  sessionsSkipped: number;
  chargedWh: number;
  truncated: boolean;
}

export class ChargingHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChargingHistoryError";
  }
}

const PAGE_SIZE = 25;
const MAX_PAGES = 50;
const INTERVAL_SECONDS = 15 * 60;

type JsonRecord = Record<string, unknown>;
type RequestMode = "filtered" | "vin-paged" | "bare";

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function nestedRecords(value: unknown, depth = 0): JsonRecord[] {
  const record = asRecord(value);
  if (record === null || depth > 3) return [];
  return [
    record,
    ...Object.values(record).flatMap((child) => nestedRecords(child, depth + 1)),
  ];
}

function readValue(record: JsonRecord, keys: readonly string[]): unknown {
  return nestedRecords(record)
    .flatMap((candidate) => keys.map((key) => candidate[key]))
    .find((value) => value !== undefined && value !== null);
}

function readString(record: JsonRecord, keys: readonly string[]): string | null {
  const value = readValue(record, keys);
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function numericValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value.replace(",", "."));
  return Number.NaN;
}

function readNumber(record: JsonRecord, keys: readonly string[]): number | null {
  const number = numericValue(readValue(record, keys));
  return Number.isFinite(number) ? number : null;
}

function parseTimestamp(value: string): number {
  const hasZone = /(?:Z|[+-]\d\d:?\d\d)$/i.test(value);
  return Date.parse(hasZone ? value : `${value.replace(" ", "T")}Z`);
}

function offsetMinutes(value: string): number {
  if (/Z$/i.test(value)) return 0;
  const match = value.match(/([+-])(\d\d):?(\d\d)$/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

function sqlTimestamp(timestampMs: number, offset = 0): string {
  return new Date(timestampMs + offset * 60_000).toISOString()
    .slice(0, 19).replace("T", " ");
}

function endExclusiveMs(date: string): number {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.getTime();
}

function responseRecords(payload: unknown): JsonRecord[] {
  const root = asRecord(payload);
  if (root === null) return [];
  const response = root.response ?? payload;
  if (Array.isArray(response)) {
    return response.map(asRecord).filter((row): row is JsonRecord => row !== null);
  }
  const record = asRecord(response);
  if (record === null) return [];
  const value = [
    "data",
    "results",
    "records",
    "history",
    "chargingHistory",
    "charging_history",
  ].map((key) => record[key]).find(Array.isArray);
  return Array.isArray(value)
    ? value.map(asRecord).filter((row): row is JsonRecord => row !== null)
    : [];
}

function responseMeta(payload: unknown): JsonRecord {
  const root = asRecord(payload) ?? {};
  return asRecord(root.response) ?? root;
}

function hasMorePages(payload: unknown, page: number, rowCount: number): boolean {
  const meta = responseMeta(payload);
  const explicit = readValue(meta, ["hasMore", "has_more", "hasNext", "has_next"]);
  if (typeof explicit === "boolean") return explicit;
  const total = readNumber(meta, [
    "totalResults",
    "total_results",
    "totalCount",
    "total_count",
    "total",
  ]);
  const pageSize = readNumber(meta, ["pageSize", "page_size", "limit"])
    ?? PAGE_SIZE;
  return total === null ? rowCount >= PAGE_SIZE : page * pageSize < total;
}

function sessionEnergyWh(record: JsonRecord): number | null {
  const direct = readNumber(record, [
    "energyWh",
    "energy_wh",
    "chargedWh",
    "charged_wh",
  ]);
  if (direct !== null) return direct;
  const kwh = readNumber(record, [
    "energyAdded",
    "energy_added",
    "chargeEnergyAdded",
    "charge_energy_added",
    "energyDelivered",
    "energy_delivered",
    "energyKwh",
    "energy_kwh",
    "kWh",
    "kwh",
  ]);
  return kwh === null ? null : kwh * 1000;
}

function sessionVin(record: JsonRecord): string | null {
  return readString(record, ["vin", "vehicleVin", "vehicle_vin", "vehicleVIN"]);
}

function sessionStart(record: JsonRecord): string | null {
  return readString(record, [
    "chargeStartDateTime",
    "charge_start_date_time",
    "startDateTime",
    "start_date_time",
    "startTime",
    "start_time",
    "startedAt",
    "started_at",
  ]);
}

function sessionEnd(record: JsonRecord): string | null {
  return readString(record, [
    "chargeStopDateTime",
    "charge_stop_date_time",
    "stopDateTime",
    "stop_date_time",
    "endDateTime",
    "end_date_time",
    "endTime",
    "end_time",
    "endedAt",
    "ended_at",
  ]);
}

function sessionId(record: JsonRecord, start: string, wh: number): string {
  return readString(record, [
    "chargingEventId",
    "charging_event_id",
    "chargeSessionId",
    "charge_session_id",
    "sessionId",
    "session_id",
    "id",
  ]) ?? `${start}:${Math.round(wh)}`;
}

function splitSession(
  record: JsonRecord,
  fromMs: number,
  toMs: number,
): ChargingHistoryRow[] {
  const startRaw = sessionStart(record);
  const wh = sessionEnergyWh(record);
  if (startRaw === null || wh === null || wh <= 0) return [];
  const startMs = parseTimestamp(startRaw);
  if (!Number.isFinite(startMs) || startMs < fromMs || startMs >= toMs) return [];
  const rawEnd = sessionEnd(record);
  const parsedEnd = rawEnd === null ? Number.NaN : parseTimestamp(rawEnd);
  const endMs = Number.isFinite(parsedEnd) && parsedEnd > startMs
    ? parsedEnd
    : startMs + INTERVAL_SECONDS * 1000;
  const durationSeconds = Math.max(60, Math.round((endMs - startMs) / 1000));
  if (durationSeconds > 7 * 24 * 60 * 60) return [];
  const count = Math.max(1, Math.ceil(durationSeconds / INTERVAL_SECONDS));
  const id = sessionId(record, startRaw, wh);
  const localOffset = offsetMinutes(startRaw);
  return Array.from({ length: count }, (_, index) => {
    const intervalStart = startMs + index * INTERVAL_SECONDS * 1000;
    const intervalEnd = Math.min(endMs, intervalStart + INTERVAL_SECONDS * 1000);
    const seconds = Math.max(1, Math.round((intervalEnd - intervalStart) / 1000));
    const intervalWh = wh * seconds / durationSeconds;
    return {
      source: "vehicle-history" as const,
      externalId: `${id}:${index}`,
      startTimeUtc: sqlTimestamp(intervalStart),
      startTimeLocal: sqlTimestamp(intervalStart, localOffset),
      intervalSeconds: seconds,
      chargedWh: intervalWh,
      solarWh: 0,
      batteryWh: 0,
      gridWh: 0,
      awayWh: intervalWh,
      atHomeWh: 0,
    };
  });
}

function historyUrl(
  base: string,
  input: ChargingHistoryInput,
  page: number,
  mode: RequestMode,
): string {
  const url = new URL(`${base}/api/1/dx/charging/history`);
  if (mode !== "bare") {
    url.searchParams.set("vin", input.vin);
    url.searchParams.set("pageNo", String(page));
    url.searchParams.set("pageSize", String(PAGE_SIZE));
  }
  if (mode === "filtered") {
    url.searchParams.set("startTime", `${input.from}T00:00:00Z`);
    url.searchParams.set("endTime", new Date(endExclusiveMs(input.to)).toISOString());
    url.searchParams.set("sortBy", "chargeStartDateTime");
    url.searchParams.set("sortOrder", "ASC");
  }
  return url.toString();
}

function requestPage(
  base: string,
  token: string,
  input: ChargingHistoryInput,
  page: number,
  mode: RequestMode,
  fetchFn: typeof globalThis.fetch,
): Promise<Response> {
  return fetchFn(historyUrl(base, input, page, mode), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
}

async function firstPage(
  base: string,
  token: string,
  input: ChargingHistoryInput,
  fetchFn: typeof globalThis.fetch,
  modes: readonly RequestMode[] = ["filtered", "vin-paged", "bare"],
): Promise<{ response: Response; mode: RequestMode }> {
  const mode = modes[0];
  if (mode === undefined) throw new ChargingHistoryError("Charging history unavailable");
  const response = await requestPage(base, token, input, 1, mode, fetchFn);
  if (response.ok) return { response, mode };
  if ([400, 422].includes(response.status) && modes.length > 1) {
    return await firstPage(base, token, input, fetchFn, modes.slice(1));
  }
  const detail = await response.text();
  throw new ChargingHistoryError(
    `Charging history failed: HTTP ${response.status} — ${detail}`,
  );
}

interface PageArchive extends ChargingHistoryArchive {
  pagesRead: number;
}

async function readPages(
  base: string,
  token: string,
  input: ChargingHistoryInput,
  fetchFn: typeof globalThis.fetch,
  mode: RequestMode,
  page: number,
  response: Response,
): Promise<PageArchive> {
  if (!response.ok) {
    const detail = await response.text();
    throw new ChargingHistoryError(
      `Charging history failed: HTTP ${response.status} — ${detail}`,
    );
  }
  const payload = await response.json();
  const sessions = responseRecords(payload);
  const fromMs = Date.parse(`${input.from}T00:00:00Z`);
  const toMs = endExclusiveMs(input.to);
  const matched = sessions.filter((session) => {
    const vin = sessionVin(session);
    return vin === input.vin || (vin === null && mode !== "bare");
  });
  const rows = matched.flatMap((session) => splitSession(session, fromMs, toMs));
  const matchedCount = matched.filter((session) =>
    splitSession(session, fromMs, toMs).length > 0
  ).length;
  const more = hasMorePages(payload, page, sessions.length);
  const stop = !more || mode === "bare" || page >= MAX_PAGES;
  const current: PageArchive = {
    rows,
    pagesRead: 1,
    sessionsRead: sessions.length,
    sessionsMatched: matchedCount,
    sessionsSkipped: sessions.length - matchedCount,
    chargedWh: rows.reduce((sum, row) => sum + row.chargedWh, 0),
    truncated: more && (mode === "bare" || page >= MAX_PAGES),
  };
  if (stop) return current;
  const next = await requestPage(base, token, input, page + 1, mode, fetchFn);
  const tail = await readPages(base, token, input, fetchFn, mode, page + 1, next);
  return {
    rows: [...current.rows, ...tail.rows],
    pagesRead: current.pagesRead + tail.pagesRead,
    sessionsRead: current.sessionsRead + tail.sessionsRead,
    sessionsMatched: current.sessionsMatched + tail.sessionsMatched,
    sessionsSkipped: current.sessionsSkipped + tail.sessionsSkipped,
    chargedWh: current.chargedWh + tail.chargedWh,
    truncated: current.truncated || tail.truncated,
  };
}

export async function fetchChargingHistory(
  provider: ChargingHistoryTokenProvider,
  input: ChargingHistoryInput,
  fetchFn: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): Promise<ChargingHistoryArchive> {
  const [token, base] = await Promise.all([
    provider.getAccessToken(),
    provider.getFleetApiBaseUrl(),
  ]);
  const first = await firstPage(base, token, input, fetchFn);
  return await readPages(base, token, input, fetchFn, first.mode, 1, first.response);
}
