import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { spy } from "@std/testing/mock";
import { Hono } from "hono";
import { AppDatabase } from "../db/AppDatabase.ts";
import { clearRecentLogs, Logger } from "../lib/Logger.ts";
import { makeSession, setupAuthApp } from "../test-helpers/authHarness.ts";
import { createLogsExportRoutes, type LogsExportDb } from "./logsExport.ts";

describe("GET /api/logs/export", () => {
  const originalLog = console.log;

  beforeEach(() => {
    console.log = spy<unknown, unknown[], void>();
    clearRecentLogs();
  });

  afterEach(() => {
    console.log = originalLog;
    clearRecentLogs();
  });

  it("exports bounded, redacted diagnostic logs and hides secrets, GPS, and full VINs", async () => {
    const db = new AppDatabase(":memory:");
    try {
      await db.init();
      await db.upsertVehicle({
        id: "LRW3E7EK9PC819094",
        name: "F.R.I.D.A.Y.",
        adapterType: "tesla",
        priority: 1,
        config: JSON.stringify({ access_token: "secret-veh-tok" }),
        mode: "auto",
      });
      await db.setConfig("charging_enabled", "true");
      await db.setConfig(
        "vehicle_solar_current_limits",
        JSON.stringify({ LRW3E7EK9PC819094: 22 }),
      );
      await db.setConfig("home_latitude", "48.8566");
      await db.setConfig("home_longitude", "2.3522");
      await db.storeSecret(
        "notification_telegram_bot_token",
        "987654321:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
      );

      await db.logs.insertControllerLogEntries([{
        vehicleId: "LRW3E7EK9PC819094",
        vehicleName: "F.R.I.D.A.Y.",
        mode: "auto",
        inputsJson: JSON.stringify({
          energy: {
            solarProductionW: 5200,
            gridPowerW: -1100,
            homeConsumptionW: 900,
            batterySoc: 88,
          },
          vehicleState: {
            isPluggedIn: true,
            isCharging: true,
            batteryLevel: 65,
            chargeLimit: 80,
            chargeAmps: 22,
            chargeAmpsMin: 5,
            chargeAmpsMax: 32,
            chargePowerKw: 5.06,
            latitude: 48.8566,
            longitude: 2.3522,
          },
          config: {},
          activeSchedules: [],
        }),
        checksJson: JSON.stringify([
          { check: "mode", result: "auto" },
          { check: "solar_allocation", result: "22A" },
        ]),
        action: "adjust_amps",
        actionDetail: "Solar tracking at 22A for LRW3E7EK9PC819094",
        targetAmps: 22,
        traceId: "trace-1",
      }]);

      await db.logs.insertPluginLog({
        pluginId: "tesla",
        level: "warn",
        origin: "command",
        message: "Token check Authorization: Bearer top-secret-bearer",
        payload: JSON.stringify({
          refresh_token: "secret-refresh-tok",
          status: 429,
        }),
        traceId: "trace-2",
      });

      await db.logs.insertVehiclePollLog({
        vehicleId: "LRW3E7EK9PC819094",
        vehicleName: "F.R.I.D.A.Y.",
        isOnline: true,
        isPluggedIn: true,
        isCharging: true,
        batteryLevel: 65,
        chargeLimit: 80,
        chargeAmps: 22,
        chargeAmpsMax: 32,
        chargePowerKw: 5.06,
        chargerVoltage: 230,
        energyAddedKwh: 4.2,
        minutesToFull: 90,
        isHome: true,
      });

      const logger = new Logger("ChargeController", "info");
      logger.info("Set amps 22A on LRW3E7EK9PC819094");

      const app = new Hono();
      app.route("/api/logs", createLogsExportRoutes(db));

      const res = await app.request("/api/logs/export?hours=24");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
      expect(res.headers.get("Content-Disposition")).toMatch(
        /^attachment; filename="evsolar-logs-\d{4}-\d{2}-\d{2}_\d{4}\.txt"$/,
      );
      expect(res.headers.get("Cache-Control")).toBe("no-store");

      const body = await res.text();
      expect(body).toContain("E.V. Solar — Diagnostic & Logs Export");
      expect(body).toContain("Window: last 24h");
      expect(body).toContain("home_location_configured=true");
      expect(body).toContain("charging_enabled=true");
      expect(body).toContain("F.R.I.D.A.Y. (...819094)");
      expect(body).toContain("Set amps 22A on ...819094");
      expect(body).toContain("solar=5200W grid=-1100W home=900W batSoc=88%");
      expect(body).toContain("Solar tracking at 22A for ...819094");
      expect(body).toContain("Bearer [REDACTED]");
      expect(body).toContain('"refresh_token":"[REDACTED]"');

      // Ensure sensitive values are absent
      expect(body).not.toContain("secret-veh-tok");
      expect(body).not.toContain("987654321:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd");
      expect(body).not.toContain("top-secret-bearer");
      expect(body).not.toContain("secret-refresh-tok");
      expect(body).not.toContain("48.8566");
      expect(body).not.toContain("2.3522");
      expect(body).not.toContain("LRW3E7EK9PC819094");
    } finally {
      db.close();
    }
  });

  it("clamps hours parameter between 1 and 168 and defaults invalid values to 24", async () => {
    const db = new AppDatabase(":memory:");
    try {
      await db.init();
      const app = new Hono();
      app.route("/api/logs", createLogsExportRoutes(db));

      const minRes = await app.request("/api/logs/export?hours=0");
      expect(await minRes.text()).toContain("Window: last 1h");

      const maxRes = await app.request("/api/logs/export?hours=999");
      expect(await maxRes.text()).toContain("Window: last 168h");

      const invalidRes = await app.request("/api/logs/export?hours=abc");
      expect(await invalidRes.text()).toContain("Window: last 24h");

      const customRes = await app.request("/api/logs/export?hours=48");
      expect(await customRes.text()).toContain("Window: last 48h");
    } finally {
      db.close();
    }
  });

  it("requires an active session when authentication is enabled", async () => {
    const db = new AppDatabase(":memory:");
    try {
      await db.init();
      const session = makeSession();
      const { app } = setupAuthApp({
        authMode: "local",
        validateSession: (id) =>
          Promise.resolve(id === session.id ? session : null),
        extraRoutes: (a) => a.route("/api/logs", createLogsExportRoutes(db)),
      });

      const unauth = await app.request("/api/logs/export");
      expect(unauth.status).toBe(401);

      const auth = await app.request("/api/logs/export", {
        headers: { Cookie: `session_id=${session.id}` },
      });
      expect(auth.status).toBe(200);
      expect(await auth.text()).toContain("E.V. Solar — Diagnostic & Logs Export");
    } finally {
      db.close();
    }
  });

  it("degrades gracefully if a database section query throws", async () => {
    const failingDb = {
      getConfig: () => Promise.resolve(null),
      getVehicles: () => Promise.resolve([]),
      logs: {
        getControllerLogs: () => Promise.reject(new Error("controller-down")),
        getPluginLogs: () => Promise.resolve({ rows: [], total: 0 }),
        getVehiclePollLogsPaginated: () =>
          Promise.resolve({ rows: [], total: 0 }),
      },
    } as unknown as LogsExportDb;

    const app = new Hono();
    app.route("/api/logs", createLogsExportRoutes(failingDb));
    const res = await app.request("/api/logs/export");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("[Export Warnings (1)]");
    expect(body).toContain("controller_logs: controller-down");
  });
});
