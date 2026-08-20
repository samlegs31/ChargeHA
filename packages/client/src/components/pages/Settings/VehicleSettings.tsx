import { Car, Plus, Trash2 } from "lucide-react";
import { ArrowDownIcon, ArrowUpIcon } from "@radix-ui/react-icons";
import { Badge, Button, Card, Switch, Text } from "@radix-ui/themes";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import {
  pluginSettingsComponents,
  vehiclePluginOptions,
  vehiclePluginSteps,
} from "@chargeha/plugins/componentRegistry";
import { demoMode } from "../../../lib/featureFlags.ts";
import {
  useChargingConfig,
  useChargingConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { vehicleColorPalette } from "../../../utils/vehicleColor.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";
import {
  type HomeChargingSource,
  useVehicleSettings,
} from "./useVehicleSettings.ts";

type Vehicle = ReturnType<typeof useVehicleSettings>["vehicles"][number];
type VehiclePlugin = ReturnType<
  typeof useVehicleSettings
>["vehiclePlugins"][number];

function sourceLabel(source: HomeChargingSource | null): string {
  if (source === "chargehq") return "ChargeHQ file";
  if (source === "solarweb") return "Wattpilot";
  return "Not chosen yet";
}

function HomeChargingData({
  vehicle,
  pending,
  onChange,
}: {
  vehicle: Vehicle;
  pending: boolean;
  onChange: (vin: string, source: HomeChargingSource | null) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginTop: 12,
        paddingTop: 10,
        borderTop: "1px solid var(--gray-a4)",
      }}
    >
      <div style={{ minWidth: 190, flex: "1 1 260px" }}>
        <Text size="2" weight="medium">Old home charges</Text>
        <Text size="1" color="gray" style={{ display: "block", marginTop: 2 }}>
          Where should E.V. Solar look to recognise this car's old charges at home?
          Current: {sourceLabel(vehicle.homeChargingSource)}.
        </Text>
      </div>
      <select
        aria-label={`${vehicle.name} old home charges`}
        value={vehicle.homeChargingSource ?? ""}
        disabled={pending}
        onChange={(event) => {
          const value = event.currentTarget.value;
          onChange(
            vehicle.id,
            value === "" ? null : value as HomeChargingSource,
          );
        }}
        style={{
          width: 220,
          maxWidth: "100%",
          height: 34,
          borderRadius: 6,
          border: "1px solid var(--gray-a7)",
          background: "var(--color-panel-solid)",
          color: "var(--gray-12)",
          padding: "0 9px",
        }}
      >
        <option value="">Choose later</option>
        <option value="chargehq">ChargeHQ file</option>
        <option value="solarweb">Wattpilot (Solar.web)</option>
      </select>
    </div>
  );
}

function VehicleRow(
  {
    v,
    idx,
    vehiclesLength,
    sourcePending,
    handleMovePriority,
    handleDelete,
    handleHomeChargingSource,
  }: {
    v: Vehicle;
    idx: number;
    vehiclesLength: number;
    sourcePending: boolean;
    handleMovePriority: (vin: string, direction: "up" | "down") => void;
    handleDelete: (vin: string) => void;
    handleHomeChargingSource: (
      vin: string,
      source: HomeChargingSource | null,
    ) => void;
  },
) {
  const palette = vehicleColorPalette(v.state?.exteriorColor);
  return (
    <div
      style={{
        padding: "12px",
        border: "1px solid var(--gray-a4)",
        borderLeft: `4px solid ${palette.base}`,
        borderRadius: 8,
        background: "var(--gray-a2)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Car size={17} style={{ color: palette.base }} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Text size="2" weight="bold">{v.name}</Text>
              <Badge variant="outline" size="1">{v.adapterType}</Badge>
              {v.state?.exteriorColor && (
                <Text size="1" color="gray">{palette.label}</Text>
              )}
            </div>
            <Text size="1" color="gray" style={{ display: "block" }}>
              {v.id}
            </Text>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {vehiclesLength > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Text size="1" color="gray">Car #{v.priority}</Text>
              <Button
                variant="soft"
                size="1"
                disabled={idx === 0}
                onClick={() => handleMovePriority(v.id, "up")}
                aria-label={`Move ${v.name} up`}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="soft"
                size="1"
                disabled={idx === vehiclesLength - 1}
                onClick={() => handleMovePriority(v.id, "down")}
                aria-label={`Move ${v.name} down`}
              >
                <ArrowDownIcon />
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            color="red"
            size="1"
            onClick={() => handleDelete(v.id)}
            aria-label={`Delete ${v.name}`}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      <HomeChargingData
        vehicle={v}
        pending={sourcePending}
        onChange={handleHomeChargingSource}
      />
    </div>
  );
}

function UnconfiguredPluginCard(
  { plugin, handleStartOnboarding }: {
    plugin: VehiclePlugin;
    handleStartOnboarding: (id: string) => void;
  },
) {
  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid var(--gray-a4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <Car size={14} />
        <Text size="2" weight="medium">{plugin.displayName}</Text>
        <Badge color="gray" size="1">Not connected</Badge>
      </div>
      <Text size="1" color="gray" style={{ display: "block", marginBottom: 8 }}>
        Follow the setup steps to connect {plugin.displayName}.
      </Text>
      <Button
        size="1"
        variant="soft"
        onClick={() => handleStartOnboarding(plugin.id)}
      >
        <Plus size={14} />
        Connect {plugin.displayName}
      </Button>
    </div>
  );
}

function ConfiguredPluginSettings(
  { vehiclePlugins }: { vehiclePlugins: VehiclePlugin[] },
) {
  return (
    <>
      {vehiclePlugins
        .filter(
          (p): p is typeof p & { settingsComponentKey: string } =>
            !!(p.configured && p.settingsComponentKey),
        )
        .map((p) => {
          const SettingsComponent =
            pluginSettingsComponents[p.settingsComponentKey];
          if (!SettingsComponent) return null;
          return (
            <ErrorBoundary key={p.id} label="Plugin Settings">
              <SettingsComponent />
            </ErrorBoundary>
          );
        })}
    </>
  );
}

function PriorityChargingHeader(
  { priorityChargingEnabled, setPriorityCharging }: {
    priorityChargingEnabled: boolean;
    setPriorityCharging: (enabled: boolean) => void;
  },
) {
  return (
    <>
      <SettingsRow
        label="Charge one car first"
        help="On: car #1 gets spare solar first. Off: spare solar is shared between eligible cars."
      >
        <Switch
          size="2"
          checked={priorityChargingEnabled}
          onCheckedChange={setPriorityCharging}
        />
      </SettingsRow>
      <Text
        size="1"
        color="gray"
        style={{ display: "block", marginBottom: 4 }}
      >
        Use the arrows to choose which car is #1.
      </Text>
    </>
  );
}

function VehicleListBlock(
  {
    vehicles,
    loadFailed,
    sourcePending,
    handleMovePriority,
    handleDelete,
    handleHomeChargingSource,
  }: {
    vehicles: Vehicle[];
    loadFailed: boolean;
    sourcePending: boolean;
    handleMovePriority: (vin: string, direction: "up" | "down") => void;
    handleDelete: (vin: string) => void;
    handleHomeChargingSource: (
      vin: string,
      source: HomeChargingSource | null,
    ) => void;
  },
) {
  return (
    <>
      {vehicles.length === 0 && !loadFailed && (
        <Text size="2" color="gray">No cars connected yet.</Text>
      )}
      {vehicles.length === 0 && loadFailed && (
        <Text size="2" color="gray">
          Could not load cars. Check that the server is running and try again.
        </Text>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[...vehicles].sort((a, b) => a.priority - b.priority).map((v, idx) => (
          <VehicleRow
            key={v.id}
            v={v}
            idx={idx}
            vehiclesLength={vehicles.length}
            sourcePending={sourcePending}
            handleMovePriority={handleMovePriority}
            handleDelete={handleDelete}
            handleHomeChargingSource={handleHomeChargingSource}
          />
        ))}
      </div>
    </>
  );
}

export function VehicleSettings() {
  const {
    vehicles,
    loading,
    loadFailed,
    error,
    handleDelete,
    handleMovePriority,
    handleHomeChargingSource,
    homeSourcePending,
    vehiclePlugins,
    handleStartOnboarding,
  } = useVehicleSettings();

  const { data: chargingConfig } = useChargingConfig();
  const chargingMutation = useChargingConfigMutation();
  const priorityChargingEnabled = chargingConfig?.priorityChargingEnabled ??
    false;
  const setPriorityCharging = (enabled: boolean) => {
    chargingMutation.mutate({ priorityChargingEnabled: enabled });
  };

  if (loading) {
    return (
      <SettingsSection
        icon={<Car size={18} />}
        title="My cars"
        description="Cars connected to E.V. Solar."
      >
        <Text size="2" color="gray">Loading cars...</Text>
      </SettingsSection>
    );
  }

  const demoBlockedIds = demoMode.blockedPlugins(vehiclePluginOptions);

  const unconfiguredPlugins = vehiclePlugins.filter(
    (p) =>
      !p.configured && (vehiclePluginSteps[p.id]?.length ?? 0) > 0 &&
      !demoBlockedIds.has(p.id),
  );

  return (
    <>
      {error && (
        <Card style={{ borderLeft: "3px solid var(--red-9)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text size="2" color="red">{error}</Text>
          </div>
        </Card>
      )}

      <SettingsSection
        icon={<Car size={18} />}
        title="My cars"
        description="See your cars, choose which one charges first, and tell Stats where old home charges come from."
      >
        {vehicles.length > 1 && (
          <PriorityChargingHeader
            priorityChargingEnabled={priorityChargingEnabled}
            setPriorityCharging={setPriorityCharging}
          />
        )}

        <VehicleListBlock
          vehicles={vehicles}
          loadFailed={loadFailed}
          sourcePending={homeSourcePending}
          handleMovePriority={handleMovePriority}
          handleDelete={handleDelete}
          handleHomeChargingSource={handleHomeChargingSource}
        />

        {unconfiguredPlugins.map((plugin) => (
          <UnconfiguredPluginCard
            key={plugin.id}
            plugin={plugin}
            handleStartOnboarding={handleStartOnboarding}
          />
        ))}

        <ConfiguredPluginSettings vehiclePlugins={vehiclePlugins} />
      </SettingsSection>
    </>
  );
}
