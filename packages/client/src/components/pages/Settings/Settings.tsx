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
import styles from "./Settings.module.css";

function EncryptionWarning() {
  return (
    <Card className={styles.warning}>
      <div className={styles.warningContent}>
        <Key size={24} className={styles.warningIcon} />
        <div>
          <Text weight="bold" className={styles.warningTitle}>
            Encryption Key Not Configured
          </Text>
          <Text color="gray" className={styles.warningText}>
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
    return (
      <Text size="1" color="gray" align="center" className={styles.version}>
        {label}
      </Text>
    );
  }
  return (
    <Text size="1" color="gray" align="center" className={styles.version}>
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
    icon: <Car size={26} />,
  },
  {
    id: "home",
    title: "Solar & home",
    description: "Solar, battery and home energy",
    icon: <Sun size={26} />,
  },
  {
    id: "electricity",
    title: "Electricity price",
    description: "Prices and cheap hours",
    icon: <CircleDollarSign size={26} />,
  },
  {
    id: "history",
    title: "Charging history",
    description: "Bring old charges into Stats",
    icon: <History size={26} />,
  },
  {
    id: "advanced",
    title: "Advanced",
    description: "Fine tuning and system tools",
    icon: <Settings2 size={26} />,
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
    <nav className={styles.menu} aria-label="Settings categories">
      {MENU_ITEMS.map((item) => {
        const selected = item.id === page;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(item.id)}
            className={styles.menuButton}
          >
            <span className={styles.menuIcon} aria-hidden="true">
              {item.icon}
            </span>
            <span className={styles.menuTitle}>{item.title}</span>
            <span className={styles.menuDescription}>{item.description}</span>
          </button>
        );
      })}
    </nav>
  );
}

function PageIntro(
  { title, description }: { title: string; description: string },
) {
  return (
    <div className={styles.pageIntro}>
      <h2 className={styles.introTitle}>{title}</h2>
      <p className={styles.introDescription}>{description}</p>
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
    <div className={styles.settingsPage}>
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
    <div className={styles.settingsPage}>
      <PageIntro
        title="Solar & home"
        description="Connect home energy and choose how much battery to keep for the house."
      />
      <InverterSettings />
      <GeneralSettings mode="home" />
      <BatterySettings mode="basic" />
    </div>
  );
}

function ElectricitySettingsPage() {
  return (
    <div className={styles.settingsPage}>
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
    <Card className={styles.historyHelp}>
      <Text weight="bold" className={styles.historyTitle}>
        You only need this for old charging data
      </Text>
      <Text color="gray" className={styles.historyText}>
        Normal charging works without importing anything here. Choose the car,
        then use the import that matches where its old charging data comes from.
      </Text>
    </Card>
  );
}

function HistorySettingsPage() {
  return (
    <div className={styles.settingsPage}>
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
    <div className={styles.settingsPage}>
      <PageIntro
        title="Advanced settings"
        description="Fine tuning. Most people can leave these settings alone."
      />
      <SolarTrackingSettings />
      <BatterySettings mode="advanced" />
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
    <div className={styles.settings}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Settings</h1>
        <p className={styles.pageSubtitle}>Choose a large category below.</p>
      </div>
      {encryptionMissing && <EncryptionWarning />}
      <SettingsMenu page={page} onChange={setPage} />
      <SettingsPageContent page={page} />
      <VersionFooter />
    </div>
  );
}
