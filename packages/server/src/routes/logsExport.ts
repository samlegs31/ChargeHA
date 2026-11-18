import { Hono } from "hono";
import type { CoreConfigKey } from "@chargeha/shared/configSections";
import type { AppDatabase } from "../db/AppDatabase.ts";
import {
  parseDecisionChecks,
  parseDecisionInputs,
} from "../db/Serialization.ts";
import { toSqliteDatetime } from "../db/repositories/sqliteHelpers.ts";
import type {
  ControllerLogRow,
  PluginLogRow,
  VehicleRow,
} from "../db/types.ts";
import { getRecentLogs, redactSensitiveText } from "../lib/Logger.ts";
import {
  commandMetrics,
  controllerMetrics,
} from "../lib/RuntimeMetrics.ts";

const DEFAULT_HOURS = 24;
const MIN_HOURS = 1;
const MAX_HOURS = 168;
const MAX_CONSOLE_LINES = 1000;
const MAX_CONTROLLER_ROWS = 800;
const MAX_PLUGIN_ROWS = 500;
const MAX_POLL_ROWS = 300;
const MAX_PAYLOAD_CHARS = 320;

const SAFE_CONFIG_KEYS: readonly CoreConfigKey[] = [
  "charging_enabled",
  "priority_charging_enabled",
  "max_grid_import_kw",
  "vehicle_current_limits",
  "vehicle_solar_current_limits",
  "external_charging_vehicles",
  "solar_tracking_enabled",
  "solar_tracking_mode",
  "solar_reference",
  "solar_margin_kw",
  "min_solar_generation_kw",
  "min_excess_solar_kw",
  "grid_voltage",
  "three_phase_charger",
  "consumption_excludes_charging",
  "grace_period_minutes",
  "cooldown_period_minutes",
  "amp_debounce_threshold",
  "amp_debounce_settle_minutes",
  "battery_priority_enabled",
  "battery_priority_limit",
  "battery_discharge_tolerance_w",
  "battery_discharge_grace_minutes",
  "energy_adapter_type",
  "energy_error_threshold",
  "controller_loop_seconds",
  "timezone",
  "oscillation_paused",
  "oscillation_trip_at",
  "auth_mode",
  "system_alert",
];

export type LogsExportDb = {
  getConfig: AppDatabase["getConfig"];
  getVehicles: AppDatabase["getVehicles"];
  logs: Pick<
    AppDatabase["logs"],
    "getControllerLogs" | "getPluginLogs" | "getVehiclePollLogsPaginated"
  >;
};

type PollExportRow = Awaited<
  ReturnType<LogsExportDb["logs"]["getVehiclePollLogsPaginated"]>
>["rows"][number];

function parseHours(raw: string | undefined): number {
  if (!raw) return DEFAULT_HOURS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_HOURS;
  return Math.max(MIN_HOURS, Math.min(MAX_HOURS, Math.round(n)));
}

function formatExportFilename(now: Date): string {
  const iso = now.toISOString();
  const datePart = iso.slice(0, 10);
  const timePart = iso.slice(11, 16).replace(":", "");
  return `evsolar-logs-${datePart}_${timePart}.txt`;
}

function maskVehicleId(id: string): string {
  if (id.length <= 8) return id;
  return `...${id.slice(-6)}`;
}

function sanitizeLine(
  raw: string,
  vehicleIds: readonly string[],
  maxLength = 600,
): string {
  let out = redactSensitiveText(raw).replace(/[\r\n]+/g, " ");
  for (const id of vehicleIds) {
    if (id.length > 8 && out.includes(id)) {
      out = out.replaceAll(id, maskVehicleId(id));
    }
  }
  return out.length > maxLength ? `${out.slice(0, maxLength)}...` : out;
}

async function safeQuery<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
  warnings: string[],
  vehicleIds: readonly string[],
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`${label}: ${sanitizeLine(msg, vehicleIds, 200)}`);
    return fallback;
  }
}

function formatVehicleLine(v: VehicleRow): string {
  return `- ${v.name} (${maskVehicleId(v.id)}) adapter=${v.adapterType} mode=${v.mode} priority=${v.priority} home_source=${
    v.homeChargingSource ?? "unset"
  }`;
}

function formatControllerRow(
  row: ControllerLogRow,
  vehicleIds: readonly string[],
): string {
  const inputs = parseDecisionInputs(row.inputsJson);
  const checks = parseDecisionChecks(row.checksJson);
  const energyPart = inputs?.energy
    ? `solar=${inputs.energy.solarProductionW}W grid=${inputs.energy.gridPowerW}W home=${inputs.energy.homeConsumptionW}W batSoc=${
      inputs.energy.batterySoc ?? "null"
    }%`
    : "energy=null";
  const carPart = inputs?.vehicleState
    ? `plugged=${inputs.vehicleState.isPluggedIn} chg=${inputs.vehicleState.isCharging} soc=${inputs.vehicleState.batteryLevel}/${inputs.vehicleState.chargeLimit}% amps=${inputs.vehicleState.chargeAmps}A pwr=${inputs.vehicleState.chargePowerKw}kW`
    : "car=null";
  const checksPart = checks.length > 0
    ? checks.map((c) => `${c.check}=${c.result}`).join("; ")
    : "none";
  const target = row.targetAmps !== null ? ` target=${row.targetAmps}A` : "";
  const detail = sanitizeLine(row.actionDetail, vehicleIds, 240);
  const checksClean = sanitizeLine(checksPart, vehicleIds, 240);
  return `${row.timestamp} | ${row.vehicleName} (${
    maskVehicleId(row.vehicleId)
  }) | mode=${row.mode} | action=${row.action}${target} | detail=${detail} | ${energyPart} | ${carPart} | checks=[${checksClean}]`;
}

function formatPluginRow(
  row: PluginLogRow,
  vehicleIds: readonly string[],
): string {
  const origin = row.origin ? ` [${row.origin}]` : "";
  const msg = sanitizeLine(row.message, vehicleIds, 300);
  const payload = row.payload
    ? ` | payload=${sanitizeLine(row.payload, vehicleIds, MAX_PAYLOAD_CHARS)}`
    : "";
  return `${row.timestamp} | [${row.level}] [${row.pluginId}]${origin} ${msg}${payload}`;
}

function formatPollRow(row: PollExportRow): string {
  return `${row.timestamp} | ${row.vehicleName} (${
    maskVehicleId(row.vehicleId)
  }) | online=${row.isOnline} home=${row.isHome} plugged=${row.isPluggedIn} chg=${row.isCharging} soc=${row.batteryLevel}/${row.chargeLimit}% amps=${row.chargeAmps}/${row.chargeAmpsMax}A pwr=${row.chargePowerKw}kW volt=${row.chargerVoltage}V added=${row.energyAddedKwh}kWh`;
}

/**
 * Authenticated HTTP route for novice-friendly 1-click log download.
 * Never exports secrets, passwords, API tokens, or GPS coordinates.
 */
export function createLogsExportRoutes(db: LogsExportDb): Hono {
  const app = new Hono();

  app.get("/export", async (c) => {
    const hours = parseHours(c.req.query("hours"));
    const now = new Date();
    const fromIso = new Date(now.getTime() - hours * 3_600_000).toISOString();
    const fromSql = toSqliteDatetime(fromIso);
    const warnings: string[] = [];

    const vehicles = await safeQuery(
      "vehicles",
      () => db.getVehicles(),
      [] as VehicleRow[],
      warnings,
      [],
    );
    const vehicleIds = vehicles.map((v) => v.id);

    const [
      configEntries,
      homeLat,
      homeLon,
      controllerRes,
      pluginRes,
      pollRes,
    ] = await Promise.all([
      Promise.all(
        SAFE_CONFIG_KEYS.map(async (key) => {
          const val = await safeQuery<string | null>(
            `config.${key}`,
            () => db.getConfig(key),
            null,
            warnings,
            vehicleIds,
          );
          return [key, val] as const;
        }),
      ),
      safeQuery<string | null>(
        "config.home_latitude",
        () => db.getConfig("home_latitude"),
        null,
        warnings,
        vehicleIds,
      ),
      safeQuery<string | null>(
        "config.home_longitude",
        () => db.getConfig("home_longitude"),
        null,
        warnings,
        vehicleIds,
      ),
      safeQuery<{ rows: ControllerLogRow[]; total: number }>(
        "controller_logs",
        () =>
          db.logs.getControllerLogs({
            limit: MAX_CONTROLLER_ROWS,
            offset: 0,
            from: fromIso,
          }),
        { rows: [], total: 0 },
        warnings,
        vehicleIds,
      ),
      safeQuery<{ rows: PluginLogRow[]; total: number }>(
        "plugin_logs",
        () =>
          db.logs.getPluginLogs({
            limit: MAX_PLUGIN_ROWS,
            offset: 0,
            from: fromIso,
          }),
        { rows: [], total: 0 },
        warnings,
        vehicleIds,
      ),
      safeQuery<{ rows: PollExportRow[]; total: number }>(
        "vehicle_poll_logs",
        () =>
          db.logs.getVehiclePollLogsPaginated({
            limit: MAX_POLL_ROWS,
            offset: 0,
            from: fromIso,
          }),
        { rows: [], total: 0 },
        warnings,
        vehicleIds,
      ),
    ]);

    const consoleLines = getRecentLogs(MAX_CONSOLE_LINES).map((line) =>
      sanitizeLine(line, vehicleIds, 600)
    );
    const ctrlMetrics = controllerMetrics.snapshot();
    const cmdMetrics = commandMetrics.snapshot();

    const lines: string[] = [
      "========================================================================",
      "E.V. Solar — Diagnostic & Logs Export",
      "========================================================================",
      `Generated at (UTC): ${now.toISOString()}`,
      `Window: last ${hours}h (since ${fromSql} UTC)`,
      `Controller metrics: p95=${
        ctrlMetrics.p95Ms !== null ? `${Math.round(ctrlMetrics.p95Ms)}ms` : "n/a"
      } count=${ctrlMetrics.count} failures=${ctrlMetrics.failures} | Commands: count=${cmdMetrics.count} failures=${cmdMetrics.failures}`,
      "",
      `[Vehicles (${vehicles.length})]`,
      ...(vehicles.length > 0
        ? vehicles.map(formatVehicleLine)
        : ["(none)"]),
      "",
      "[Settings Summary (non-secret)]",
      `home_location_configured=${Boolean(homeLat && homeLon)}`,
      ...configEntries
        .filter(([, val]) => val !== null)
        .map(([key, val]) => `${key}=${sanitizeLine(val ?? "", vehicleIds, 300)}`),
      "",
      `[Recent Runtime Console Logs (${consoleLines.length} lines, chronological)]`,
      ...(consoleLines.length > 0 ? consoleLines : ["(none captured since start)"]),
      "",
      `[Controller Decisions (${controllerRes.rows.length} of ${controllerRes.total} in window, chronological)]`,
      ...(controllerRes.rows.length > 0
        ? controllerRes.rows
          .slice()
          .reverse()
          .map((row) => formatControllerRow(row, vehicleIds))
        : ["(none)"]),
      "",
      `[Plugin Logs (${pluginRes.rows.length} of ${pluginRes.total} in window, chronological)]`,
      ...(pluginRes.rows.length > 0
        ? pluginRes.rows
          .slice()
          .reverse()
          .map((row) => formatPluginRow(row, vehicleIds))
        : ["(none)"]),
      "",
      `[Vehicle Poll Logs (${pollRes.rows.length} of ${pollRes.total} in window, chronological)]`,
      ...(pollRes.rows.length > 0
        ? pollRes.rows.slice().reverse().map(formatPollRow)
        : ["(none)"]),
    ];

    if (warnings.length > 0) {
      lines.push("", `[Export Warnings (${warnings.length})]`, ...warnings);
    }

    const filename = formatExportFilename(now);
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    c.header("Cache-Control", "no-store");
    return c.text(`${lines.join("\n")}\n`);
  });

  return app;
}
