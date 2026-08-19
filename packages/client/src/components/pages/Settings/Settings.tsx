import { useState } from "react";
import type { ReactNode } from "react";
import {
  Car,
  CircleDollarSign,
  History,
  Key,
  Settings2,
  Sun,
  Zap,
} from "lucide-react";
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
import { SolarWebHistoryImport } from "./SolarWebHistoryImport.tsx";

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

type SettingsPage = "cars" | "home" | "electricity" | "history" | "advanced";

interface MenuItem {
  id: SettingsPage;
  title: string;
  description: string;
  icon: ReactNode;
}

const MENU_ITEMS: readonly MenuItem[] = [
  {
    id: "cars",
    title: "My cars",
    description: "Cars and automatic charging",
    icon: <Car size={21} />,
  },
  {
    id: "home",
    title: "Solar & home",
    description: "Solar, battery and home energy",
    icon: <Sun size={21} />,
  },
  {
    id: "electricity",
    title: "Electricity price",
    description: "Prices and cheap hours",
    icon: <CircleDollarSign size={21} />,
  },
  {
    id: "history",
    title: "Charging history",
    description: "Bring old charges into Stats",
    icon: <History size={21} />,
  },
  {
    id: "advanced",
    title: "Advanced",
    description: "System, forecast and security",
    icon: <Settings2 size={21} />,
  },
];

function SettingsMenu({
  page,
  onChange,
}: {
  page: SettingsPage;
  onChange: (page: SettingsPage) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
        gap: 10,
      }}
    >
      {MENU_ITEMS.map((item) => {
        const selected = item.id === page;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(item.id)}
            style={{
              appearance: "none",
              textAlign: "left",
              cursor: "pointer",
              minHeight: 82,
              padding: "12px 14px",
              borderRadius: 10,
              border: selected
                ? "1px solid var(--accent-9)"
                : "1px solid var(--gray-a5)",
              background: selected ? "var(--accent-a3)" : "var(--gray-a2)",
              color: "var(--gray-12)",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 5,
                color: selected ? "var(--accent-11)" : "var(--gray-12)",
              }}
            >
              {item.icon}
              <Text size="2" weight="bold">{item.title}</Text>
            </span>
            <Text size="1" color="gray">{item.description}</Text>
          </button>
        );
      })}
    </div>
  );
}

function PageIntro({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Text size="4" weight="bold">{title}</Text>
      <Text size="2" color="gray">{description}</Text>
    </div>
  );
}

function AutomaticChargingSettings() {
  const { data: charging, isLoading } = useChargingConfig();
  const chargingMutation = useChargingConfigMutation();
  const { fields, setField, isDirty, save, saveStatus } = useDraftConfig(
    charging,
    chargingMutation,
  );

  if (isLoading) return <Text size="2" color="gray">Loading charging...</Text>;

  return (
    <SettingsSection
      icon={<Zap size={18} />}
      title="Automatic charging"
      description="Turn E.V. Solar automatic charging on or off."
      saveStatus={saveStatus}
      isDirty={isDirty}
      onSave={save}
    >
      <SettingsRow
        label="Automatic charging"
        help="Off pauses automatic start, stop and current changes. Your other settings are kept."
      >
        <Switch
          size="2"
          checked={fields?.chargingEnabled ?? true}
          onCheckedChange={(value) => setField("chargingEnabled", value)}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

function CarsSettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageIntro
        title="My cars"
        description="Connect your cars and choose how E.V. Solar charges them."
      />
      <AutomaticChargingSettings />
      <VehicleSettings />
    </div>
  );
}

function HomeSettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageIntro
        title="Solar & home"
        description="Tell E.V. Solar where home energy comes from and how to protect the home battery."
      />
      <InverterSettings />
      <GeneralSettings mode="home" />
      <SolarTrackingSettings />
      <BatterySettings />
    </div>
  );
}

function ElectricitySettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageIntro
        title="Electricity price"
        description="Set your electricity prices and the hours when grid charging is cheaper."
      />
      <TariffSettings />
    </div>
  );
}

function HistoryHelp() {
  return (
    <Card style={{ borderLeft: "3px solid var(--blue-9)" }}>
      <Text size="2" weight="bold" style={{ display: "block" }}>
        You only need this for old charging data
      </Text>
      <Text size="2" color="gray" style={{ display: "block", marginTop: 3 }}>
        Normal charging works without importing anything here. Choose the car,
        then use the import that matches where its old charging data comes from.
      </Text>
    </Card>
  );
}

function HistorySettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageIntro
        title="Charging history"
        description="Optional: add old charging sessions to Stats."
      />
      <HistoryHelp />
      <HistoryMigrationSettings />
      <SolarWebHistoryImport />
    </div>
  );
}

function AdvancedSettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageIntro
        title="Advanced settings"
        description="These settings are normally left alone after setup."
      />
      <SolarForecastSettings />
      <GeneralSettings mode="system" />
      <NotificationSettings />
      <AuthSettings />
    </div>
  );
}

function SettingsPageContent({ page }: { page: SettingsPage }) {
  if (page === "home") return <HomeSettingsPage />;
  if (page === "electricity") return <ElectricitySettingsPage />;
  if (page === "history") return <HistorySettingsPage />;
  if (page === "advanced") return <AdvancedSettingsPage />;
  return <CarsSettingsPage />;
}

export function Settings() {
  const [page, setPage] = useState<SettingsPage>("cars");
  const { data: encryptionHealth } = trpc.health.encryption.useQuery();
  const encryptionMissing = encryptionHealth
    ? !encryptionHealth.configured
    : false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Text size="5" weight="bold">Settings</Text>
        <Text size="2" color="gray">What do you want to change?</Text>
      </div>
      {encryptionMissing && <EncryptionWarning />}
      <SettingsMenu page={page} onChange={setPage} />
      <SettingsPageContent page={page} />
      <VersionFooter />
    </div>
  );
}
