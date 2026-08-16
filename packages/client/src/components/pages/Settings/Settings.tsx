import type { ReactNode } from "react";
import { Key, Zap } from "lucide-react";
import { Card, Link, Switch, Text } from "@radix-ui/themes";
import { trpc } from "../../../trpc.ts";
import { version } from "../../../lib/version.ts";
import {
  useChargingConfig,
  useChargingConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";
import { AuthSettings } from "./AuthSettings.tsx";
import { InverterSettings } from "./InverterSettings.tsx";
import { VehicleSettings } from "./VehicleSettings.tsx";
import { SolarTrackingSettings } from "./SolarTrackingSettings.tsx";
import { SolarForecastSettings } from "./SolarForecastSettings.tsx";
import { BatterySettings } from "./BatterySettings.tsx";
import { TariffSettings } from "./TariffSettings.tsx";
import { GeneralSettings } from "./GeneralSettings.tsx";
import { NotificationSettings } from "./NotificationSettings.tsx";
import { HistoryMigrationSettings } from "./HistoryMigrationSettings.tsx";

function EncryptionWarning() {
  return (
    <Card style={{ borderLeft: "3px solid var(--orange-9)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Key size={20} style={{ color: "var(--orange-9)", flexShrink: 0 }} />
        <div>
          <Text size="2" weight="bold" style={{ display: "block" }}>
            Encryption Key Not Configured
          </Text>
          <Text size="2" color="gray">
            Secrets such as API keys, tokens, and passwords are currently stored
            without encryption. Configure <code>ENCRYPTION_KEY</code> or{" "}
            <code>ENCRYPTION_KEY_FILE</code>{" "}
            on the server before adding credentials.
          </Text>
        </div>
      </div>
    </Card>
  );
}

function SettingsGroup(
  { title, description, children }: {
    title: string;
    description: string;
    children: ReactNode;
  },
) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Text size="3" weight="bold">{title}</Text>
        <Text size="2" color="gray">{description}</Text>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {children}
      </div>
    </section>
  );
}

function VersionFooter() {
  const label = `version ${version.sha}`;
  if (!version.commitUrl) {
    return <Text size="1" color="gray" align="center">{label}</Text>;
  }
  return (
    <Text size="1" color="gray" align="center">
      <Link href={version.commitUrl} target="_blank" rel="noreferrer">
        {label}
      </Link>
    </Text>
  );
}

// ── Main Settings Component ──

export function Settings() {
  const { data: charging, isLoading: chargingLoading } = useChargingConfig();
  const chargingMutation = useChargingConfigMutation();
  const {
    fields: chargingFields,
    setField: setChargingField,
    isDirty: chargingDirty,
    save: saveCharging,
    saveStatus: chargingSaveStatus,
  } = useDraftConfig(charging, chargingMutation);

  const { data: encryptionHealth } = trpc.health.encryption.useQuery();
  const encryptionMissing = encryptionHealth
    ? !encryptionHealth.configured
    : false;

  if (chargingLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Text size="5" weight="bold">Settings</Text>
        <Text size="2" color="gray">Loading settings...</Text>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Text size="5" weight="bold">Settings</Text>
        <Text size="2" color="gray">
          Configure charging, energy monitoring, solar behaviour, and system
          services. Changes are saved per section.
        </Text>
      </div>

      {encryptionMissing && <EncryptionWarning />}

      <SettingsGroup
        title="Charging & equipment"
        description="Control charging automation and the hardware connected to E.V Solar."
      >
        <SettingsSection
          icon={<Zap size={18} />}
          title="Charging Control"
          description="Master switch for E.V Solar charging automation."
          saveStatus={chargingSaveStatus}
          isDirty={chargingDirty}
          onSave={saveCharging}
        >
          <SettingsRow
            label="Charging enabled"
            help="Turn this off to pause automatic charging decisions without changing your other settings."
          >
            <Switch
              size="2"
              checked={chargingFields?.chargingEnabled ?? true}
              onCheckedChange={(v) => setChargingField("chargingEnabled", v)}
            />
          </SettingsRow>
        </SettingsSection>

        <InverterSettings />
        <VehicleSettings />
      </SettingsGroup>

      <SettingsGroup
        title="Solar & energy"
        description="Tune solar charging, forecasts, electricity tariffs, and home-battery protection."
      >
        <SolarTrackingSettings />
        <SolarForecastSettings />
        <TariffSettings />
        <BatterySettings />
      </SettingsGroup>

      <SettingsGroup
        title="History & migration"
        description="Bring historical charging data into E.V Solar independently from the active Fronius realtime source."
      >
        <HistoryMigrationSettings />
      </SettingsGroup>

      <SettingsGroup
        title="System & access"
        description="Manage system behaviour, home location, notifications, and authentication."
      >
        <GeneralSettings />
        <NotificationSettings />
        <AuthSettings />
      </SettingsGroup>

      <VersionFooter />
    </div>
  );
}
