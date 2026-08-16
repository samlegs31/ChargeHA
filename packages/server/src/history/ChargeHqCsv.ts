export const CHARGEHQ_INTERVAL_HEADERS = [
  "start_time_local",
  "start_time_epoch",
  "charged_kwh",
  "from_solar_kwh",
  "from_battery_kwh",
  "from_grid_kwh",
  "away_from_home_kwh",
  "at_home_kwh",
] as const;

const CHARGEHQ_INDEXED_INTERVAL_HEADERS = [
  "index",
  ...CHARGEHQ_INTERVAL_HEADERS,
] as const;

const ENERGY_TOLERANCE_KWH = 0.002;
const INTERVAL_SECONDS = 15 * 60;

export interface ChargeHqInterval {
  index: number;
  startTimeLocal: string;
  startTimeEpoch: number;
  chargedKwh: number;
  fromSolarKwh: number;
  fromBatteryKwh: number;
  fromGridKwh: number;
  awayFromHomeKwh: number;
  atHomeKwh: number;
}

export interface ChargeHqHistoryRow {
  source: "chargehq";
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

export interface ChargeHqParseSummary {
  intervalCount: number;
  firstStartTimeLocal: string | null;
  lastStartTimeLocal: string | null;
  chargedKwh: number;
  solarKwh: number;
  batteryKwh: number;
  gridKwh: number;
  awayKwh: number;
  atHomeKwh: number;
}

export interface ChargeHqParseResult {
  intervals: ChargeHqInterval[];
  historyRows: ChargeHqHistoryRow[];
  summary: ChargeHqParseSummary;
}

export class ChargeHqCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChargeHqCsvError";
  }
}

function parseCsvCells(line: string): string[] {
  // ChargeHQ interval exports contain plain numeric/date cells. Reject quoted
  // commas rather than silently parsing an unexpected export format.
  if (line.includes('"')) {
    throw new ChargeHqCsvError(
      "Quoted CSV cells are not supported in ChargeHQ interval exports",
    );
  }
  return line.split(",").map((cell) => cell.trim());
}

function parseNonNegativeNumber(
  value: string,
  column: string,
  line: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ChargeHqCsvError(`Invalid ${column} on line ${line}`);
  }
  return parsed;
}

function parseInteger(value: string, column: string, line: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ChargeHqCsvError(`Invalid ${column} on line ${line}`);
  }
  return parsed;
}

function assertClose(
  actual: number,
  expected: number,
  label: string,
  line: number,
): void {
  if (Math.abs(actual - expected) > ENERGY_TOLERANCE_KWH) {
    throw new ChargeHqCsvError(
      `${label} is inconsistent on line ${line}: ${actual} kWh vs ${expected} kWh`,
    );
  }
}

function parseInterval(
  cells: string[],
  line: number,
  hasIndexColumn: boolean,
): ChargeHqInterval {
  const expectedColumns = hasIndexColumn
    ? CHARGEHQ_INDEXED_INTERVAL_HEADERS.length
    : CHARGEHQ_INTERVAL_HEADERS.length;
  if (cells.length !== expectedColumns) {
    throw new ChargeHqCsvError(
      `Expected ${expectedColumns} columns on line ${line}, got ${cells.length}`,
    );
  }

  const dataCells = hasIndexColumn ? cells.slice(1) : cells;
  const [
    startTimeLocal,
    startTimeEpoch,
    chargedKwh,
    fromSolarKwh,
    fromBatteryKwh,
    fromGridKwh,
    awayFromHomeKwh,
    atHomeKwh,
  ] = dataCells;

  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(startTimeLocal)) {
    throw new ChargeHqCsvError(`Invalid start_time_local on line ${line}`);
  }

  const parsed: ChargeHqInterval = {
    index: hasIndexColumn ? parseInteger(cells[0], "index", line) : line - 2,
    startTimeLocal,
    startTimeEpoch: parseNonNegativeNumber(
      startTimeEpoch,
      "start_time_epoch",
      line,
    ),
    chargedKwh: parseNonNegativeNumber(chargedKwh, "charged_kwh", line),
    fromSolarKwh: parseNonNegativeNumber(
      fromSolarKwh,
      "from_solar_kwh",
      line,
    ),
    fromBatteryKwh: parseNonNegativeNumber(
      fromBatteryKwh,
      "from_battery_kwh",
      line,
    ),
    fromGridKwh: parseNonNegativeNumber(
      fromGridKwh,
      "from_grid_kwh",
      line,
    ),
    awayFromHomeKwh: parseNonNegativeNumber(
      awayFromHomeKwh,
      "away_from_home_kwh",
      line,
    ),
    atHomeKwh: parseNonNegativeNumber(atHomeKwh, "at_home_kwh", line),
  };

  assertClose(
    parsed.chargedKwh,
    parsed.atHomeKwh + parsed.awayFromHomeKwh,
    "charged_kwh",
    line,
  );
  assertClose(
    parsed.atHomeKwh,
    parsed.fromSolarKwh + parsed.fromBatteryKwh + parsed.fromGridKwh,
    "at_home_kwh",
    line,
  );

  return parsed;
}

function toSqliteUtc(epochSeconds: number): string {
  return new Date(Math.round(epochSeconds) * 1000).toISOString().slice(0, 19)
    .replace("T", " ");
}

function toWh(kwh: number): number {
  return kwh * 1000;
}

function historyBase(interval: ChargeHqInterval) {
  return {
    source: "chargehq" as const,
    startTimeUtc: toSqliteUtc(interval.startTimeEpoch),
    startTimeLocal: interval.startTimeLocal,
    intervalSeconds: INTERVAL_SECONDS,
  };
}

function homeHistoryRows(interval: ChargeHqInterval): ChargeHqHistoryRow[] {
  if (interval.atHomeKwh <= 0) return [];
  const epochId = String(Math.round(interval.startTimeEpoch));
  return [{
    ...historyBase(interval),
    externalId: `${epochId}:home`,
    chargedWh: toWh(interval.atHomeKwh),
    solarWh: toWh(interval.fromSolarKwh),
    batteryWh: toWh(interval.fromBatteryKwh),
    gridWh: toWh(interval.fromGridKwh),
    awayWh: 0,
    atHomeWh: toWh(interval.atHomeKwh),
  }];
}

function awayHistoryRows(interval: ChargeHqInterval): ChargeHqHistoryRow[] {
  if (interval.awayFromHomeKwh <= 0) return [];
  const epochId = String(Math.round(interval.startTimeEpoch));
  return [{
    ...historyBase(interval),
    externalId: `${epochId}:away`,
    chargedWh: toWh(interval.awayFromHomeKwh),
    solarWh: 0,
    batteryWh: 0,
    gridWh: 0,
    awayWh: toWh(interval.awayFromHomeKwh),
    atHomeWh: 0,
  }];
}

function toHistoryRows(interval: ChargeHqInterval): ChargeHqHistoryRow[] {
  return [...homeHistoryRows(interval), ...awayHistoryRows(interval)];
}

function sum(
  intervals: ChargeHqInterval[],
  pick: (row: ChargeHqInterval) => number,
): number {
  return intervals.reduce((total, row) => total + pick(row), 0);
}

function assertNoDuplicateEpochs(intervals: ChargeHqInterval[]): void {
  const sorted = intervals.map((row) => Math.round(row.startTimeEpoch))
    .toSorted((a, b) => a - b);
  const duplicate = sorted.find(
    (epoch, index) => index > 0 && epoch === sorted[index - 1],
  );
  if (duplicate !== undefined) {
    throw new ChargeHqCsvError(`Duplicate start_time_epoch ${duplicate}`);
  }
}

export function parseChargeHqIntervalCsv(csvText: string): ChargeHqParseResult {
  const normalized = csvText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
    .trim();
  if (normalized === "") {
    throw new ChargeHqCsvError("ChargeHQ CSV is empty");
  }

  const lines = normalized.split("\n").filter((line) => line.trim() !== "");
  const header = parseCsvCells(lines[0]);
  const headerKey = header.join(",");
  const hasIndexColumn = headerKey ===
    CHARGEHQ_INDEXED_INTERVAL_HEADERS.join(",");
  const isRawChargeHqExport = headerKey === CHARGEHQ_INTERVAL_HEADERS.join(",");
  if (!isRawChargeHqExport && !hasIndexColumn) {
    throw new ChargeHqCsvError(
      "Unsupported ChargeHQ CSV header; export Interval Data from ChargeHQ",
    );
  }

  const intervals = lines.slice(1).map((line, index) =>
    parseInterval(parseCsvCells(line), index + 2, hasIndexColumn)
  );
  assertNoDuplicateEpochs(intervals);

  const historyRows = intervals.flatMap(toHistoryRows);
  const summary: ChargeHqParseSummary = {
    intervalCount: intervals.length,
    firstStartTimeLocal: intervals[0]?.startTimeLocal ?? null,
    lastStartTimeLocal: intervals.at(-1)?.startTimeLocal ?? null,
    chargedKwh: sum(intervals, (row) => row.chargedKwh),
    solarKwh: sum(intervals, (row) => row.fromSolarKwh),
    batteryKwh: sum(intervals, (row) => row.fromBatteryKwh),
    gridKwh: sum(intervals, (row) => row.fromGridKwh),
    awayKwh: sum(intervals, (row) => row.awayFromHomeKwh),
    atHomeKwh: sum(intervals, (row) => row.atHomeKwh),
  };

  return { intervals, historyRows, summary };
}
