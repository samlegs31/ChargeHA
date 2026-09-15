import type { AppDatabase } from "../db/AppDatabase.ts";
import {
  type BatteryConfig,
  batteryConfigDef,
  type ChargingConfig,
  chargingConfigDef,
  type CoreConfigKey,
  deserializeSection,
  type EquipmentConfig,
  equipmentConfigDef,
  type HomeConfig,
  homeConfigDef,
  type InternalConfig,
  internalConfigDef,
  type NotificationConfig,
  notificationConfigDef,
  sectionDbKeys,
  serializeSection,
  type SolarConfig,
  solarConfigDef,
  type SolarForecastConfig,
  solarForecastConfigDef,
  type SystemConfig,
  systemConfigDef,
  validateCoreConfigRawValue,
} from "@chargeha/shared/configSections";
import type { EnergyAdapterManager } from "./EnergyAdapterManager.ts";
import type { Logger } from "../lib/Logger.ts";

const SECRET_MASK = "********";
const TELEGRAM_TOKEN_KEY = "notification_telegram_bot_token" as const;

export class ConfigService {
  constructor(
    private db: AppDatabase,
    private energyManager: EnergyAdapterManager,
    private encryptionKey: string | null,
    private logger: Logger,
  ) {}

  // ── Generic section helpers ────────────────────────────────────────────

  /** Read raw string values for a section's DB keys. */
  private async readSectionRaw<K extends CoreConfigKey>(
    dbKeys: K[],
  ): Promise<Record<K, string | null>> {
    const values = await Promise.all(
      dbKeys.map((key) => this.db.getConfig(key)),
    );
    return Object.fromEntries(
      dbKeys.map((key, i) => [key, values[i]]),
    ) as Record<K, string | null>;
  }

  /** Write serialized key-value pairs to the DB. The EnergyPoller listens
   *  for config_changed events from the DB and drives any adapter rebuild
   *  itself, so we don't need to poke it from here. */
  private async writeSectionRaw<K extends CoreConfigKey>(
    kvPairs: Record<K, string>,
  ): Promise<void> {
    await Promise.all(
      (Object.entries(kvPairs) as [K, string][]).map(
        ([key, value]) => this.db.setConfig(key, value),
      ),
    );
  }

  // ── Typed section getters ──────────────────────────────────────────────

  async getCharging(): Promise<
    ChargingConfig & {
      chargingDisabledReason: InternalConfig["chargingDisabledReason"];
    }
  > {
    const [raw, disabledReasonRaw, legacyTripAt] = await Promise.all([
      this.readSectionRaw(sectionDbKeys(chargingConfigDef)),
      this.db.getConfig("charging_disabled_reason"),
      this.db.getConfig("oscillation_trip_at"),
    ]);
    const charging = deserializeSection(chargingConfigDef, raw);
    const internal = deserializeSection(internalConfigDef, {
      charging_disabled_reason: disabledReasonRaw,
    });
    const chargingDisabledReason = this.resolveChargingDisabledReason(
      charging.chargingEnabled,
      disabledReasonRaw,
      legacyTripAt,
      internal.chargingDisabledReason,
    );
    return {
      ...charging,
      chargingDisabledReason,
    };
  }

  private resolveChargingDisabledReason(
    chargingEnabled: boolean,
    disabledReasonRaw: string | null,
    legacyTripAt: string | null,
    parsedReason: InternalConfig["chargingDisabledReason"],
  ): InternalConfig["chargingDisabledReason"] {
    if (disabledReasonRaw !== null || chargingEnabled) return parsedReason;
    if (legacyTripAt) return "safety_trip";
    return "user";
  }

  async getSolar(): Promise<SolarConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(solarConfigDef));
    return deserializeSection(solarConfigDef, raw);
  }

  async getSolarForecast(): Promise<SolarForecastConfig> {
    const raw = await this.readSectionRaw(
      sectionDbKeys(solarForecastConfigDef),
    );
    return deserializeSection(solarForecastConfigDef, raw);
  }

  async getBattery(): Promise<BatteryConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(batteryConfigDef));
    return deserializeSection(batteryConfigDef, raw);
  }

  async getHome(): Promise<HomeConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(homeConfigDef));
    return deserializeSection(homeConfigDef, raw);
  }

  async getEquipment(): Promise<EquipmentConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(equipmentConfigDef));
    return deserializeSection(equipmentConfigDef, raw);
  }

  async getSystem(): Promise<SystemConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(systemConfigDef));
    return deserializeSection(systemConfigDef, raw);
  }

  async getNotification(): Promise<NotificationConfig> {
    const raw = await this.readSectionRaw(
      sectionDbKeys(notificationConfigDef),
    );

    // Telegram's bot token is write-only from the browser's perspective.
    // Migrate any pre-batch plaintext config value on first read.
    const token = await this.db.readSecretWithConfigMigration(
      TELEGRAM_TOKEN_KEY,
    );
    raw[TELEGRAM_TOKEN_KEY] = token ? SECRET_MASK : null;

    return deserializeSection(notificationConfigDef, raw);
  }

  async getInternal(): Promise<InternalConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(internalConfigDef));
    return deserializeSection(internalConfigDef, raw);
  }

  // ── Typed section setters ──────────────────────────────────────────────

  async setCharging(input: Partial<ChargingConfig>): Promise<void> {
    const kvPairs = serializeSection(chargingConfigDef, input);
    if (input.chargingEnabled === undefined) {
      await this.writeSectionRaw(kvPairs);
      return;
    }

    if (input.chargingEnabled) {
      // Re-enabling is the explicit acknowledgement/reset of a safety stop.
      // Keep the trip authoritative until charging_enabled is safely restored.
      await this.writeSectionRaw(kvPairs);
      await this.db.setConfig("charging_disabled_reason", "none");
      return;
    }

    // Record a voluntary pause before disabling automation. A concurrent
    // controller loop still sees charging enabled until the pause is stored.
    await this.db.setConfig("charging_disabled_reason", "user");
    await this.writeSectionRaw(kvPairs);
  }

  setSolar(input: Partial<SolarConfig>): Promise<void> {
    const kvPairs = serializeSection(solarConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  setSolarForecast(input: Partial<SolarForecastConfig>): Promise<void> {
    const kvPairs = serializeSection(solarForecastConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  setBattery(input: Partial<BatteryConfig>): Promise<void> {
    const kvPairs = serializeSection(batteryConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  setHome(input: Partial<HomeConfig>): Promise<void> {
    const kvPairs = serializeSection(homeConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  setEquipment(input: Partial<EquipmentConfig>): Promise<void> {
    const kvPairs = serializeSection(equipmentConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  setSystem(input: Partial<SystemConfig>): Promise<void> {
    const kvPairs = serializeSection(systemConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  async setNotification(
    input: Partial<NotificationConfig>,
  ): Promise<void> {
    const kvPairs = serializeSection(notificationConfigDef, input);
    const token = kvPairs[TELEGRAM_TOKEN_KEY];

    if (token !== undefined && token !== SECRET_MASK) {
      // storeSecret updates the same KV row and marks it encrypted when possible.
      await this.db.storeSecret(TELEGRAM_TOKEN_KEY, token);
    }

    await Promise.all(
      Object.entries(kvPairs)
        .filter(([key]) => key !== TELEGRAM_TOKEN_KEY)
        .map(([key, value]) => this.db.setConfig(key as CoreConfigKey, value)),
    );
  }

  setInternal(input: Partial<InternalConfig>): Promise<void> {
    const kvPairs = serializeSection(internalConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  /** Get the current system alert string. */
  async getSystemAlert(): Promise<string> {
    const internal = await this.getInternal();
    return internal.systemAlert;
  }

  /** Clear the system alert. */
  async dismissSystemAlert(): Promise<{ success: boolean }> {
    await this.db.setConfig("system_alert", "");
    return { success: true };
  }

  /** Set a single config value. The EnergyPoller subscribes to
   *  config_changed and drives any adapter rebuild itself. */
  async setConfigValue(
    key: CoreConfigKey,
    value: string,
  ): Promise<{ key: CoreConfigKey; value: string }> {
    if (!validateCoreConfigRawValue(key, value)) {
      throw new Error(`Invalid value for config key: ${key}`);
    }

    if (key === TELEGRAM_TOKEN_KEY) {
      if (value !== SECRET_MASK) {
        await this.db.storeSecret(key, value);
      }
      return { key, value: value ? SECRET_MASK : "" };
    }

    if (key === "charging_enabled") {
      await this.setCharging({ chargingEnabled: value === "true" });
      return { key, value };
    }

    await this.db.setConfig(key, value);
    return { key, value };
  }
}
