/// <reference lib="deno.ns" />
export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "[DEBUG]",
  info: "[INFO ]",
  warn: "[WARN ]",
  error: "[ERROR]",
};

function formatTimestamp(): string {
  const now = new Date();
  const Y = now.getFullYear();
  const M = String(now.getMonth() + 1).padStart(2, "0");
  const D = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

const MAX_RECENT_LOG_LINES = 1500;
const MAX_LOG_LINE_LENGTH = 600;
const recentLogRing: string[] = new Array<string>(MAX_RECENT_LOG_LINES);
let ringWriteIndex = 0;
let ringLength = 0;

/** Redact common credentials, tokens, cookies, and GPS coordinates from log text. */
export function redactSensitiveText(input: string): string {
  if (!input) return "";
  return input
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, "$1 [REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED_JWT]",
    )
    .replace(
      /\b(?:bot)?\d{6,}:[A-Za-z0-9_-]{20,}\b/g,
      "[REDACTED_BOT_TOKEN]",
    )
    .replace(
      /([?&](?:access_token|refresh_token|id_token|client_secret|code|token|password|secret|api_key|apikey|encryption_key|session_id)=)[^&\s"'`}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\bsession_id=[^;\s"'`]+/gi, "session_id=[REDACTED]")
    .replace(
      /("(?:access_token|refresh_token|id_token|client_secret|password|passwordHash|encryptionKey|botToken|notification_telegram_bot_token|session_id|token|secret|apiKey|api_key|privateKey|authorization|cookie|set-cookie)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
      '$1"[REDACTED]"',
    )
    .replace(
      /\b(password|passwd|client_secret|bot_token|api_key|encryption_key|access_token|refresh_token|id_token)\s*=\s*([^\s,;'"`]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /("(?:home_)?(?:latitude|longitude)"\s*:\s*)-?\d+(?:\.\d+)?/gi,
      '$1"[REDACTED_GEO]"',
    );
}

function formatLogArg(arg: unknown): string {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "string") return arg;
  if (
    typeof arg === "number" ||
    typeof arg === "boolean" ||
    typeof arg === "bigint" ||
    typeof arg === "symbol"
  ) {
    return String(arg);
  }
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}`;
  }
  try {
    const json = JSON.stringify(arg);
    return json ?? Object.prototype.toString.call(arg);
  } catch {
    return "[unserializable]";
  }
}

function recordRecentLogLine(line: string): void {
  const sanitized = redactSensitiveText(line).replace(/[\r\n]+/g, " ");
  const truncated = sanitized.length > MAX_LOG_LINE_LENGTH
    ? `${sanitized.slice(0, MAX_LOG_LINE_LENGTH)}...`
    : sanitized;
  recentLogRing[ringWriteIndex] = truncated;
  ringWriteIndex = (ringWriteIndex + 1) % MAX_RECENT_LOG_LINES;
  if (ringLength < MAX_RECENT_LOG_LINES) {
    ringLength++;
  }
}

/** Return recent in-memory log lines in chronological order (oldest first). */
export function getRecentLogs(limit = 1000): string[] {
  const clampedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.min(Math.floor(limit), MAX_RECENT_LOG_LINES))
    : MAX_RECENT_LOG_LINES;
  const count = Math.min(ringLength, clampedLimit);
  if (count === 0) return [];
  const startOffset = ringLength === MAX_RECENT_LOG_LINES
    ? ringWriteIndex
    : 0;
  const skip = ringLength - count;
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = (startOffset + skip + i) % MAX_RECENT_LOG_LINES;
    const entry = recentLogRing[idx];
    if (entry !== undefined) result.push(entry);
  }
  return result;
}

/** Clear the in-memory log ring buffer (intended for unit tests). */
export function clearRecentLogs(): void {
  recentLogRing.fill("");
  ringWriteIndex = 0;
  ringLength = 0;
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (!value) return "info";
  const lower = value.toLowerCase();
  if (lower in LOG_LEVELS) return lower as LogLevel;
  return "info";
}

/** Check whether a raw string is a valid log level (case-insensitive). */
export function isValidLogLevel(value: string): boolean {
  return value.toLowerCase() in LOG_LEVELS;
}

export class Logger {
  private readonly context: string;
  private readonly minLevel: number;

  constructor(context: string, level: LogLevel = "info") {
    this.context = context;
    this.minLevel = LOG_LEVELS[level];
  }

  debug(message: string, ...args: unknown[]): void {
    this._log("debug", message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this._log("info", message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this._log("warn", message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this._log("error", message, args);
  }

  private _log(level: LogLevel, message: string, args: unknown[]): void {
    if (LOG_LEVELS[level] < this.minLevel) return;
    const prefix = `${formatTimestamp()} ${
      LEVEL_LABELS[level]
    } [${this.context}]`;
    if (args.length > 0) {
      console.log(prefix, message, ...args);
      recordRecentLogLine(
        `${prefix} ${message} ${args.map(formatLogArg).join(" ")}`,
      );
    } else {
      console.log(prefix, message);
      recordRecentLogLine(`${prefix} ${message}`);
    }
  }
}

/** Create a Logger that reads LOG_LEVEL from the environment once at call time. */
export function createLogger(context: string): Logger {
  const level = parseLogLevel(Deno.env.get("LOG_LEVEL"));
  return new Logger(context, level);
}
