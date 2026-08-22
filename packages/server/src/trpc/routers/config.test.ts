import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../../db/AppDatabase.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import { ConfigService } from "../../services/ConfigService.ts";
import { Logger } from "../../lib/Logger.ts";
import type { EnergyAdapterManager } from "../../services/EnergyAdapterManager.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";

describe("Config tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);

  const mockLogger: Logger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  } as unknown as Logger;

  const mockEnergyManager = {
    reconfigure: () => Promise.resolve(),
  };

  let db: AppDatabase;
  let caller: ReturnType<typeof createCaller>;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    const configService = new ConfigService(
      db,
      mockEnergyManager as unknown as EnergyAdapterManager,
      null,
      new Logger("ConfigService", "error"),
    );
    caller = createCaller(throwingMock<TrpcContext>("TrpcContext", {
      db,
      encryptionKey: null,
      energyManager: mockEnergyManager as unknown as EnergyAdapterManager,
      logger: mockLogger,
      configService,
    }));
  });

  afterEach(() => {
    db.close();
  });

  describe("config.set", () => {
    it("sets a config value", async () => {
      const result = await caller.config.set({
        key: "charging_enabled",
        value: "false",
      });
      expect(result.key).toBe("charging_enabled");
      expect(result.value).toBe("false");

      const val = await db.getConfig("charging_enabled");
      expect(val).toBe("false");
    });
  });

  describe("config.systemAlert", () => {
    it("returns empty string by default", async () => {
      const alert = await caller.config.systemAlert();
      expect(alert).toBe("");
    });

    it("returns stored alert JSON", async () => {
      await db.setConfig("system_alert", '{"message":"test"}');
      const alert = await caller.config.systemAlert();
      expect(alert).toBe('{"message":"test"}');
    });
  });

  describe("config.dismissSystemAlert", () => {
    it("clears system alert", async () => {
      await db.setConfig("system_alert", '{"message":"test"}');

      const result = await caller.config.dismissSystemAlert();
      expect(result.success).toBe(true);

      const val = await db.getConfig("system_alert");
      expect(val).toBe("");
    });
  });

  // ── Per-section typed endpoints ──────────────────────────────────────────

  describe("config.charging", () => {
    it("get returns typed defaults", async () => {
      const data = await caller.config.charging.get();
      expect(data.chargingEnabled).toBe(true);
    });

    it("set persists typed values", async () => {
      await caller.config.charging.set({ chargingEnabled: false });
      const data = await caller.config.charging.get();
      expect(data.chargingEnabled).toBe(false);

      // Verify it's stored as string in DB
      expect(await db.getConfig("charging_enabled")).toBe("false");
    });
  });

  describe("config.solar", () => {
    it("get returns typed defaults", async () => {
      const data = await caller.config.solar.get();
      expect(data.solarTrackingEnabled).toBe(true);
      expect(data.solarTrackingMode).toBe("solar_only");
      expect(data.solarReference).toBe("excess");
      expect(data.solarMarginKw).toBe(0);
      expect(data.minSolarGenerationKw).toBe(0.2);
      expect(data.minExcessSolarKw).toBe(null);
      expect(data.threePhaseCharger).toBe(false);
      expect(data.consumptionExcludesCharging).toBe(false);
      expect(data.gracePeriodMinutes).toBe(6);
      expect(data.cooldownPeriodMinutes).toBe(15);
    });

    it("set persists partial updates", async () => {
      await caller.config.solar.set({
        solarTrackingMode: "solar_grid",
        solarMarginKw: 1.5,
        minExcessSolarKw: 2.0,
      });
      const data = await caller.config.solar.get();
      expect(data.solarTrackingMode).toBe("solar_grid");
      expect(data.solarMarginKw).toBe(1.5);
      expect(data.minExcessSolarKw).toBe(2.0);
      // Untouched fields keep defaults
      expect(data.solarTrackingEnabled).toBe(true);
    });

    it("set nullable to null serializes as empty string", async () => {
      // First set it to a value
      await caller.config.solar.set({ minExcessSolarKw: 3.0 });
      let data = await caller.config.solar.get();
      expect(data.minExcessSolarKw).toBe(3.0);

      // Set it back to null
      await caller.config.solar.set({ minExcessSolarKw: null });
      data = await caller.config.solar.get();
      expect(data.minExcessSolarKw).toBe(null);
      expect(await db.getConfig("min_excess_solar_kw")).toBe("");
    });
  });

  describe("config.solarForecast", () => {
    it("get returns safe defaults", async () => {
      const data = await caller.config.solarForecast.get();
      expect(data.solarForecastEnabled).toBe(false);
      expect(data.solarForecastLatitude).toBe(null);
      expect(data.solarForecastLongitude).toBe(null);
      expect(data.solarForecastArraysJson).toBe("[]");
      expect(data.solarForecastInverterModel).toBe("");
      expect(data.solarForecastInverterAcMaxKw).toBe(null);
      expect(data.solarForecastBatteryModel).toBe("");
      expect(data.solarForecastBatteryCapacityKwh).toBe(null);
      expect(data.solarForecastSubscribedPowerKva).toBe(null);
    });

    it("set persists typed forecast settings", async () => {
      await caller.config.solarForecast.set({
        solarForecastEnabled: true,
        solarForecastInstallationDate: "2022-05-30",
        solarForecastLatitude: 43.55,
        solarForecastLongitude: 1.68,
        solarForecastInverterModel: "Fronius Primo GEN24 6.0 Plus",
        solarForecastInverterAcMaxKw: 6,
        solarForecastBatteryModel: "BYD Battery-Box Premium HVS 7.7",
        solarForecastBatteryCapacityKwh: 7.68,
        solarForecastBatteryMaxChargeKw: 6,
        solarForecastBatteryMaxDischargeKw: 6,
        solarForecastBatteryRoundTripEfficiencyPct: 96,
        solarForecastSubscribedPowerKva: 12,
      });
      const data = await caller.config.solarForecast.get();
      expect(data.solarForecastEnabled).toBe(true);
      expect(data.solarForecastInstallationDate).toBe("2022-05-30");
      expect(data.solarForecastLatitude).toBe(43.55);
      expect(data.solarForecastLongitude).toBe(1.68);
      expect(data.solarForecastInverterAcMaxKw).toBe(6);
      expect(data.solarForecastBatteryCapacityKwh).toBe(7.68);
      expect(data.solarForecastBatteryRoundTripEfficiencyPct).toBe(96);
      expect(data.solarForecastSubscribedPowerKva).toBe(12);
    });
  });

  describe("config.battery", () => {
    it("get returns typed defaults", async () => {
      const data = await caller.config.battery.get();
      expect(data.batteryPriorityEnabled).toBe(false);
      expect(data.batteryPriorityLimit).toBe(80);
      expect(data.batteryDischargeToleranceW).toBe(300);
      expect(data.batteryDischargeGraceMinutes).toBe(5);
    });

    it("set persists typed values", async () => {
      await caller.config.battery.set({
        batteryPriorityEnabled: true,
        batteryPriorityLimit: 90,
        batteryDischargeToleranceW: 500,
        batteryDischargeGraceMinutes: 7,
      });
      const data = await caller.config.battery.get();
      expect(data.batteryPriorityEnabled).toBe(true);
      expect(data.batteryPriorityLimit).toBe(90);
      expect(data.batteryDischargeToleranceW).toBe(500);
      expect(data.batteryDischargeGraceMinutes).toBe(7);
    });
  });

  describe("config.home", () => {
    it("get returns null defaults for lat/lng", async () => {
      const data = await caller.config.home.get();
      expect(data.homeLatitude).toBe(null);
      expect(data.homeLongitude).toBe(null);
    });

    it("set persists nullable numbers", async () => {
      await caller.config.home.set({
        homeLatitude: -33.8688,
        homeLongitude: 151.2093,
      });
      const data = await caller.config.home.get();
      expect(data.homeLatitude).toBe(-33.8688);
      expect(data.homeLongitude).toBe(151.2093);
    });

    it("set to null clears coordinates", async () => {
      await caller.config.home.set({
        homeLatitude: -33.8688,
        homeLongitude: 151.2093,
      });
      await caller.config.home.set({
        homeLatitude: null,
        homeLongitude: null,
      });
      const data = await caller.config.home.get();
      expect(data.homeLatitude).toBe(null);
      expect(data.homeLongitude).toBe(null);
    });
  });

  describe("config validation guardrails", () => {
    it("rejects unsafe system intervals", async () => {
      await expect(
        caller.config.system.set({ controllerLoopSeconds: 0 }),
      ).rejects.toThrow();

      await expect(
        caller.config.system.set({ recordingIntervalSeconds: 301 }),
      ).rejects.toThrow();
    });

    it("rejects invalid battery percentage and coordinates", async () => {
      await expect(
        caller.config.battery.set({ batteryPriorityLimit: 101 }),
      ).rejects.toThrow();

      await expect(
        caller.config.battery.set({ batteryDischargeToleranceW: -1 }),
      ).rejects.toThrow();

      await expect(
        caller.config.battery.set({ batteryDischargeGraceMinutes: 31 }),
      ).rejects.toThrow();

      await expect(
        caller.config.home.set({ homeLatitude: 91 }),
      ).rejects.toThrow();
    });

    it("prevents raw config.set from bypassing typed bounds", async () => {
      await expect(
        caller.config.set({
          key: "controller_loop_seconds",
          value: "-1",
        }),
      ).rejects.toThrow();
    });

    it("routes a raw Telegram token write into the secret store", async () => {
      const result = await caller.config.set({
        key: "notification_telegram_bot_token",
        value: "raw-secret",
      });

      expect(result.value).toBe("********");
      expect(
        await db.readSecret("notification_telegram_bot_token"),
      ).toBe("raw-secret");
      expect(
        await db.getSecret("notification_telegram_bot_token"),
      ).not.toBeNull();
    });
  });

  describe("config.system", () => {
    it("get returns typed defaults", async () => {
      const data = await caller.config.system.get();
      expect(data.controllerLoopSeconds).toBe(30);
      expect(data.recordingIntervalSeconds).toBe(60);
      expect(data.dataRetentionDays).toBe(730);
      expect(data.logRetentionDays).toBe(30);
      expect(data.timezone).toBe("");
      expect(data.energyErrorThreshold).toBe(6);
    });

    it("set persists timezone", async () => {
      await caller.config.system.set({ timezone: "Australia/Sydney" });
      const data = await caller.config.system.get();
      expect(data.timezone).toBe("Australia/Sydney");
    });
  });

  describe("config.equipment", () => {
    it("get returns typed defaults", async () => {
      const data = await caller.config.equipment.get();
      expect(data.energyAdapterType).toBe("");
    });

    it("set persists equipment config", async () => {
      await caller.config.equipment.set({
        energyAdapterType: "fronius_local",
      });
      const data = await caller.config.equipment.get();
      expect(data.energyAdapterType).toBe("fronius_local");
    });
  });

  describe("config.notification", () => {
    it("get returns typed defaults", async () => {
      const data = await caller.config.notification.get();
      expect(data.notificationProvider).toBe("");
      expect(data.notificationEnabledEvents).toBe("");
      expect(data.notificationTelegramSilent).toBe(false);
    });

    it("set persists notification config", async () => {
      await caller.config.notification.set({
        notificationProvider: "telegram",
        notificationTelegramBotToken: "123:abc",
        notificationTelegramChatId: "456",
        notificationTelegramSilent: true,
      });
      const data = await caller.config.notification.get();
      expect(data.notificationProvider).toBe("telegram");
      expect(data.notificationTelegramBotToken).toBe("********");
      expect(await db.readSecret("notification_telegram_bot_token")).toBe(
        "123:abc",
      );
      expect(
        await db.getSecret("notification_telegram_bot_token"),
      ).not.toBeNull();
      expect(data.notificationTelegramChatId).toBe("456");
      expect(data.notificationTelegramSilent).toBe(true);
    });
  });

  describe("cross-layer consistency", () => {
    it("typed setter writes are visible via raw DB read", async () => {
      await caller.config.solar.set({ solarTrackingMode: "solar_grid" });
      const raw = await db.getConfig("solar_tracking_mode");
      expect(raw).toBe("solar_grid");
    });

    it("config.set writes are visible in typed getter", async () => {
      await caller.config.set({
        key: "grace_period_minutes",
        value: "20",
      });
      const data = await caller.config.solar.get();
      expect(data.gracePeriodMinutes).toBe(20);
    });
  });
});
