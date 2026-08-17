import type { QueryHandler } from "./types.ts";
import { PROVIDER_CONFIG_FIELDS } from "@chargeha/shared/notifications";

export const miscHandlers: Record<string, QueryHandler> = {
  // Encryption is always "configured" in demo — no secrets to protect.
  "health.encryption": () => ({ configured: true }),
  "health.pluginWarnings": () => [],

  "notification.providers": () => PROVIDER_CONFIG_FIELDS,

  // Forecast defaults to unavailable until a real installation is configured.
  "forecast.today": () => ({
    available: false,
    reason: "not_configured",
    message: "Solar forecast is not configured",
  }),

  // Demo has no persisted ChargeHQ archive, so coverage starts empty.
  "history.getChargeHqCoverage": () => ({
    rowCount: 0,
    firstStartTimeLocal: null,
    lastStartTimeLocal: null,
    chargedWh: 0,
  }),
};
