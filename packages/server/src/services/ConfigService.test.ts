import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../db/AppDatabase.ts";
import { ConfigService } from "./ConfigService.ts";
import { Logger } from "../lib/Logger.ts";
import type { EnergyAdapterManager } from "./EnergyAdapterManager.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";

describe("ConfigService", () => {
  const testLogger = new Logger("ConfigService", "error");
  let db: AppDatabase;
  let service: ConfigService;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    const mockEnergyManager = throwingMock<EnergyAdapterManager>(
      "EnergyAdapterManager",
      { reconfigure: () => Promise.resolve() },
    );
    service = new ConfigService(db, mockEnergyManager, null, testLogger);
  });

  afterEach(() => {
    db.close();
  });

  // ── Typed section getters ──────────────────────────────────────────────

  describe("getCharging", () => {
    it("returns defaults when no config is set", async () => {
      const result = await service.getCharging();
      expect(result.chargingEnabled).toBe(true);
    });

    it("returns stored value when config is set", async () => {
      await db.setConfig("charging_enabled", "false");
      const result = await service.getCharging();
      expect(result.chargingEnabled).toBe(false);
    });
  });

  describe("getSolar", () => {
    it("returns defaults when no config is set", async () => {
      const result = await service.getSolar();
      expect(result.solarTrackingEnabled).toBe(true);
      expect(result.solarTrackingMode).toBe("solar_only");
      expect(result.solarReference).toBe("excess");
      expect(result.solarMarginKw).toBe(0);
      expect(result.minSolarGenerationKw).toBe(0.2);
      expect(result.minExcessSolarKw).toBe(null);
      expect(result.gridVoltage).toBe(230);
      expect(result.threePhaseCharger).toBe(false);
      expect(result.consumptionExcludesCharging).toBe(false);
      expect(result.gracePeriodMinutes).toBe(6);
      expect(result.cooldownPeriodMinutes).toBe(15);
    });
  });

  describe("getSolarForecast", () => {
    it("returns disabled empty defaults when no config is set", async () => {
      const result = await service.getSolarForecast();
      expect(result.solarForecastEnabled).toBe(false);
      expect(result.solarForecastAddress).toBe("");
      expect(result.solarForecastLatitude).toBe(null);
      expect(result.solarForecastLongitude).toBe(null);
      expect(result.solarForecastInstallationDate).toBe("");
      expect(result.solarForecastArraysJson).toBe("[]");
    });
  });

  describe("getBattery", () => {
    it("returns defaults when no config is set", async () => {
      const result = await service.getBattery();
      expect(result.batteryPriorityEnabled).toBe(false);
      expect(result.batteryPriorityLimit).toBe(80);
      expect(result.batteryDischargeToleranceW).toBe(300);
      expect(result.batteryDischargeGraceMinutes).toBe(5);
    });
  });

  describe("getHome", () => {
    it("returns defaults when no config is set", async () => {
      const result = await service.getHome();
      expect(result.homeLatitude).toBe(null);
      expect(result.homeLongitude).toBe(null);
    });
  });

  describe("getEquipment", () => {
    it("returns defaults when no config is set", async () => {
      const result = await service.getEquipment();
      expect(result.energyAdapterType).toBe("");
    });
  });

  describe("getSystem", () => {
    it("returns defaults when no config is set", async () => {
      const result = await service.getSystem();
      expect(result.energyErrorThreshold).toBe(6);
      expect(result.controllerLoopSeconds).toBe(30);
      expect(result.recordingIntervalSeconds).toBe(60);
      expect(result.timezone).toBe("");
      expect(result.dataRetentionDays).toBe(730);
      expect(result.logRetentionDays).toBe(7);
    });
  });

  describe("getNotification", () => {
    it("returns defaults when no config is set", async () => {
      const result = await service.getNotification();
      expect(result.notificationProvider).toBe("");
      expect(result.notificationEnabledEvents).toBe("");
      expect(result.notificationTelegramBotToken).toBe("");
      expect(result.notificationTelegramChatId).toBe("");
      expect(result.notificationTelegramTopicId).toBe("");
      expect(result.notificationTelegramSilent).toBe(false);
    });
  });

  describe("getInternal", () => {
    it("returns stored values", async () => {
      await db.setConfig("wizard_completed", "true");
      await db.setConfig("system_alert", "test alert");
      const result = await service.getInternal();
      expect(result.wizardCompleted).toBe(true);
      expect(result.systemAlert).toBe("test alert");
    });
  });

  // ── Typed section setters ──────────────────────────────────────────────

  describe("setCharging", () => {
    it("persists values to DB", async () => {
      await service.setCharging({ chargingEnabled: false });
      const result = await service.getCharging();
      expect(result.chargingEnabled).toBe(false);
    });
  });

  describe("setSolar", () => {
    it("persists values to DB", async () => {
      await service.setSolar({
        solarTrackingEnabled: false,
        solarMarginKw: 1.5,
      });
      const result = await service.getSolar();
      expect(result.solarTrackingEnabled).toBe(false);
      expect(result.solarMarginKw).toBe(1.5);
    });
  });

  describe("setSolarForecast", () => {
    it("persists location, installation date, and array JSON", async () => {
      const arrays = JSON.stringify([
        { name: "South", capacityKwp: 4.15, azimuthDeg: 180, tiltDeg: 18 },
      ]);
      await service.setSolarForecast({
        solarForecastEnabled: true,
        solarForecastAddress: "Tarabel, France",
        solarForecastLatitude: 43.55,
        solarForecastLongitude: 1.68,
        solarForecastInstallationDate: "2022-05-30",
        solarForecastArraysJson: arrays,
      });
      const result = await service.getSolarForecast();
      expect(result.solarForecastEnabled).toBe(true);
      expect(result.solarForecastAddress).toBe("Tarabel, France");
      expect(result.solarForecastLatitude).toBe(43.55);
      expect(result.solarForecastLongitude).toBe(1.68);
      expect(result.solarForecastInstallationDate).toBe("2022-05-30");
      expect(result.solarForecastArraysJson).toBe(arrays);
    });
  });

  describe("setBattery", () => {
    it("persists values to DB", async () => {
      await service.setBattery({
        batteryPriorityEnabled: true,
        batteryPriorityLimit: 50,
        batteryDischargeToleranceW: 600,
        batteryDischargeGraceMinutes: 8,
      });
      const result = await service.getBattery();
      expect(result.batteryPriorityEnabled).toBe(true);
      expect(result.batteryPriorityLimit).toBe(50);
      expect(result.batteryDischargeToleranceW).toBe(600);
      expect(result.batteryDischargeGraceMinutes).toBe(8);
    });
  });

  describe("setHome", () => {
    it("persists values to DB", async () => {
      await service.setHome({ homeLatitude: -37.8, homeLongitude: 144.9 });
      const result = await service.getHome();
      expect(result.homeLatitude).toBe(-37.8);
      expect(result.homeLongitude).toBe(144.9);
    });
  });

  describe("setEquipment", () => {
    it("persists values to DB", async () => {
      await service.setEquipment({ energyAdapterType: "fronius" });
      const result = await service.getEquipment();
      expect(result.energyAdapterType).toBe("fronius");
    });
  });

  describe("setSystem", () => {
    it("persists values to DB", async () => {
      await service.setSystem({
        timezone: "Australia/Melbourne",
        controllerLoopSeconds: 5,
      });
      const result = await service.getSystem();
      expect(result.timezone).toBe("Australia/Melbourne");
      expect(result.controllerLoopSeconds).toBe(5);
    });
  });

  describe("setNotification", () => {
    it("persists values to DB", async () => {
      await service.setNotification({
        notificationProvider: "telegram",
        notificationTelegramSilent: true,
      });
      const result = await service.getNotification();
      expect(result.notificationProvider).toBe("telegram");
      expect(result.notificationTelegramSilent).toBe(true);
    });
  });

  describe("Telegram encryption with ENCRYPTION_KEY", () => {
    it("encrypts the token in the KV row and never returns plaintext", async () => {
      const encryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      const encryptedDb = new AppDatabase(":memory:", encryptionKey);
      await encryptedDb.init();
      const mockEnergyManager = throwingMock<EnergyAdapterManager>(
        "EnergyAdapterManager",
        { reconfigure: () => Promise.resolve() },
      );
      const encryptedService = new ConfigService(
        encryptedDb,
        mockEnergyManager,
        encryptionKey,
        testLogger,
      );

      try {
        await encryptedService.setNotification({
          notificationTelegramBotToken: "123:ENCRYPT-ME",
        });

        const row = await encryptedDb.getSecret(
          "notification_telegram_bot_token",
        );
        expect(row?.isEncrypted).toBe(true);
        expect(row?.value).not.toBe("123:ENCRYPT-ME");
        expect(
          await encryptedDb.readSecret("notification_telegram_bot_token"),
        ).toBe("123:ENCRYPT-ME");

        const data = await encryptedService.getNotification();
        expect(data.notificationTelegramBotToken).toBe("********");
      } finally {
        encryptedDb.close();
      }
    });
  });

  describe("Telegram secret handling", () => {
    it("stores the bot token as a secret and returns only a mask", async () => {
      await service.setNotification({
        notificationTelegramBotToken: "123:TOPSECRET",
      });

      expect(
        await db.readSecret("notification_telegram_bot_token"),
      ).toBe("123:TOPSECRET");
      expect(
        await db.getSecret("notification_telegram_bot_token"),
      ).not.toBeNull();

      const result = await service.getNotification();
      expect(result.notificationTelegramBotToken).toBe("********");
    });

    it("preserves the token when a masked form is saved", async () => {
      await service.setNotification({
        notificationTelegramBotToken: "123:KEEP",
      });
      await service.setNotification({
        notificationTelegramBotToken: "********",
        notificationTelegramChatId: "456",
      });

      expect(
        await db.readSecret("notification_telegram_bot_token"),
      ).toBe("123:KEEP");
      expect(await db.getConfig("notification_telegram_chat_id")).toBe("456");
    });

    it("migrates a legacy plaintext token on first read", async () => {
      await db.setConfig(
        "notification_telegram_bot_token",
        "123:LEGACY",
      );

      const result = await service.getNotification();

      expect(result.notificationTelegramBotToken).toBe("********");
      expect(
        await db.readSecret("notification_telegram_bot_token"),
      ).toBe("123:LEGACY");
      expect(
        await db.getSecret("notification_telegram_bot_token"),
      ).not.toBeNull();
    });
  });

  describe("setInternal", () => {
    it("persists values to DB", async () => {
      await service.setInternal({
        wizardCompleted: true,
        systemAlert: "alert!",
      });
      const result = await service.getInternal();
      expect(result.wizardCompleted).toBe(true);
      expect(result.systemAlert).toBe("alert!");
    });
  });

  // ── getSystemAlert ─────────────────────────────────────────────────────

  describe("getSystemAlert", () => {
    it("returns empty string when no alert is set", async () => {
      const result = await service.getSystemAlert();
      expect(result).toBe("");
    });

    it("returns stored alert string", async () => {
      await db.setConfig("system_alert", "critical issue");
      const result = await service.getSystemAlert();
      expect(result).toBe("critical issue");
    });
  });

  // ── dismissSystemAlert ─────────────────────────────────────────────────

  describe("dismissSystemAlert", () => {
    it("clears the system alert and returns success", async () => {
      await db.setConfig("system_alert", "alert to dismiss");
      const result = await service.dismissSystemAlert();
      expect(result).toEqual({ success: true });
      const alert = await service.getSystemAlert();
      expect(alert).toBe("");
    });
  });

  // ── setConfigValue ─────────────────────────────────────────────────────

  describe("setConfigValue", () => {
    it("sets a config value and returns key-value pair", async () => {
      const result = await service.setConfigValue("timezone", "UTC");
      expect(result).toEqual({ key: "timezone", value: "UTC" });
      const stored = await db.getConfig("timezone");
      expect(stored).toBe("UTC");
    });
  });
});
