import { type ReactNode, useEffect, useState } from "react";
import {
  BatteryCharging,
  Car,
  Key,
  Plug,
  RefreshCw,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { Badge, Button, Callout, Card, Skeleton, Text } from "@radix-ui/themes";
import type { VehicleChargeState, VehicleMode } from "@chargeha/shared";
import type { VehicleChargeController } from "@chargeha/shared/vehicleControl";
import { formatRelativeTime } from "../../utils/Format.ts";
import { StaticMap } from "../StaticMap/StaticMap.tsx";
import { Spinner } from "../ui/Spinner.tsx";
import { ErrorBanner } from "../ui/ErrorBanner.tsx";
import { VehicleCardDetails } from "./VehicleCardDetails.tsx";
import styles from "./VehicleCard.module.css";

interface VehicleCardProps {
  name: string;
  state: VehicleChargeState;
  priority: number;
  mode: VehicleMode;
  chargeController?: VehicleChargeController;
  commandPending: string | false;
  onStartCharging: () => void;
  onStopCharging: () => void;
  onSetAmps: (amps: number) => void;
  onChangeMode: (mode: VehicleMode) => void;
  onNavigateSettings?: () => void;
  solarPowerW?: number;
  batteryPowerW?: number;
  gridPowerW?: number;
  loading?: boolean;
  commandsDisabled?: boolean;
  commandsDisabledReason?: string;
  vehicleError?: string | null;
  lastLocation?: { latitude: number; longitude: number } | null;
  atHome?: boolean | null;
  allocationStatus?: string | null;
  onRefresh?: () => Promise<unknown>;
  pollingSuspended?: boolean;
  pollingSuspendReason?: string | null;
  controllerReason?: string | null;
  controllerDetail?: string | null;
  forecastContent?: ReactNode;
}

const MODE_LABELS: Record<VehicleMode, string> = {
  auto: "Solar + clock",
  charge_now: "Charge Now",
  vacation: "Solar Only",
  stop: "Stopped",
};

function getStatusText(
  state: VehicleChargeState,
  mode: VehicleMode,
  atHome: boolean | null | undefined,
  chargeController: VehicleChargeController,
): string {
  const label = MODE_LABELS[mode];
  const homeSuffix = atHome ? " - Home" : "";
  if (state.isCharging) {
    if (atHome === false) {
      return `Charging away from home at ${state.chargePowerKw.toFixed(1)} kW`;
    }
    if (chargeController === "wattpilot") {
      return `Charging via Wattpilot at ${state.chargePowerKw.toFixed(1)} kW`;
    }
    return `${label} - Charging at ${
      state.chargePowerKw.toFixed(1)
    } kW${homeSuffix}`;
  }
  if (chargeController === "wattpilot" && state.isPluggedIn) {
    return "Connected to Wattpilot";
  }
  if (state.isPluggedIn) return `${label} - Plugged In${homeSuffix}`;
  return `${label} - Unplugged${homeSuffix}`;
}

function getStatusColor(state: VehicleChargeState): string {
  if (state.isCharging) return "var(--color-charging)";
  if (state.isPluggedIn) return "var(--color-vehicle)";
  return "var(--color-disconnected)";
}

function StatusIcon({ state }: { state: VehicleChargeState }) {
  const iconStyle = { color: getStatusColor(state), flexShrink: 0 };
  if (state.isCharging) return <BatteryCharging size={14} style={iconStyle} />;
  if (state.isPluggedIn) return <Plug size={14} style={iconStyle} />;
  return <Unplug size={14} style={iconStyle} />;
}

const MODE_BUTTONS: {
  value: VehicleMode;
  label: string;
  color: "red" | "blue" | "green" | "orange";
}[] = [
  { value: "stop", label: "STOP", color: "red" },
  { value: "auto", label: "SOLAR + 🕒", color: "blue" },
  { value: "vacation", label: "SOLAR ONLY", color: "orange" },
  { value: "charge_now", label: "CHARGE NOW", color: "green" },
];

function VehicleCardHeader(
  { name, priority, isOnline, lastUpdatedText, onRefresh }: {
    name: string;
    priority: number;
    isOnline: boolean;
    lastUpdatedText: string | null;
    onRefresh?: () => Promise<unknown>;
  },
) {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <div className={styles.header}>
      <div className={styles.headerLeft}>
        <Car size={20} style={{ color: "var(--color-vehicle)" }} />
        <Text size="3" weight="bold">{name}</Text>
        <Badge variant="outline" color="gray" size="1">
          Priority {priority}
        </Badge>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {lastUpdatedText && <Text size="1" color="gray">{lastUpdatedText}
        </Text>}
        {onRefresh && (
          <Button
            variant="soft"
            size="1"
            color="gray"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                await onRefresh();
              } finally {
                setRefreshing(false);
              }
            }}
          >
            <RefreshCw
              size={12}
              style={refreshing
                ? { animation: "spin 1s linear infinite" }
                : undefined}
            />
            {refreshing ? "Updating…" : "Update"}
          </Button>
        )}
        <Badge variant="soft" color={isOnline ? "green" : "gray"}>
          {isOnline ? "Online" : "Offline"}
        </Badge>
      </div>
    </div>
  );
}

function VehicleCardBanners(
  {
    commandsDisabled,
    commandsDisabledReason,
    onNavigateSettings,
    vehicleError,
    pollingSuspended,
    pollingSuspendReason,
  }: {
    commandsDisabled: boolean;
    commandsDisabledReason?: string;
    onNavigateSettings?: () => void;
    vehicleError?: string | null;
    pollingSuspended?: boolean;
    pollingSuspendReason?: string | null;
  },
) {
  return (
    <>
      {commandsDisabled && (
        <div style={{ marginBottom: 12 }}>
          <ErrorBanner
            title="Charging control unavailable"
            description={`${
              commandsDisabledReason ?? "Commands are currently unavailable."
            } Smart charging, schedules, and manual controls won't work until this is resolved.`}
          >
            {onNavigateSettings && (
              <Button
                variant="soft"
                color="orange"
                size="2"
                style={{ alignSelf: "flex-start" }}
                onClick={onNavigateSettings}
              >
                <Key size={14} />
                Fix in Settings
              </Button>
            )}
          </ErrorBanner>
        </div>
      )}
      {vehicleError && (
        <div style={{ marginBottom: 12 }}>
          <ErrorBanner title="Vehicle API error" description={vehicleError} />
        </div>
      )}
      {pollingSuspended && (
        <Text
          size="1"
          color="gray"
          style={{ display: "block", marginBottom: 8 }}
        >
          Polling paused — {pollingSuspendReason ?? "idle"}
        </Text>
      )}
    </>
  );
}

function VehicleModeToggle(
  { mode, disabled, isPluggedIn, pending, onChangeMode }: {
    mode: VehicleMode;
    disabled: boolean;
    isPluggedIn: boolean;
    pending: string;
    onChangeMode: (mode: VehicleMode) => void;
  },
) {
  return (
    <>
      <div className={styles.modeToggle}>
        {MODE_BUTTONS.map((btn) => (
          <Button
            key={btn.value}
            variant={mode === btn.value ? "solid" : "outline"}
            color={mode === btn.value ? btn.color : "gray"}
            size="1"
            disabled={disabled || !isPluggedIn}
            onClick={() => onChangeMode(btn.value)}
          >
            {pending === `mode:${btn.value}` ? <Spinner /> : null}
            {btn.label}
          </Button>
        ))}
      </div>
      {mode === "charge_now" && (
        <Callout.Root size="1" color="orange" style={{ marginBottom: 8 }}>
          <Callout.Icon>
            <TriangleAlert size={14} />
          </Callout.Icon>
          <Callout.Text>
            Charge Now overrides all schedules and solar tracking.
          </Callout.Text>
        </Callout.Root>
      )}
    </>
  );
}

function ExternalControllerNotice() {
  return (
    <Callout.Root size="1" color="blue" style={{ marginBottom: 8 }}>
      <Callout.Icon><Plug size={14} /></Callout.Icon>
      <Callout.Text>Charge control managed by Wattpilot</Callout.Text>
    </Callout.Root>
  );
}

function ChargeControlModeSection(
  { externallyManaged, mode, disabled, isPluggedIn, pending, onChangeMode }: {
    externallyManaged: boolean;
    mode: VehicleMode;
    disabled: boolean;
    isPluggedIn: boolean;
    pending: string;
    onChangeMode: (mode: VehicleMode) => void;
  },
) {
  if (externallyManaged) return <ExternalControllerNotice />;
  return (
    <VehicleModeToggle
      mode={mode}
      disabled={disabled}
      isPluggedIn={isPluggedIn}
      pending={pending}
      onChangeMode={onChangeMode}
    />
  );
}

function VehicleBatterySection(
  { batteryPercent, chargeLimitPercent, isCharging }: {
    batteryPercent: number;
    chargeLimitPercent: number;
    isCharging: boolean;
  },
) {
  return (
    <div className={styles.batterySection}>
      <div className={styles.batteryBar}>
        <div
          className={styles.batteryFill}
          style={{
            width: `${batteryPercent}%`,
            backgroundColor: isCharging
              ? "var(--color-charging)"
              : "var(--color-vehicle)",
          }}
        />
        <div
          className={styles.chargeLimitMarker}
          style={{ left: `${chargeLimitPercent}%` }}
        />
      </div>
      <div className={styles.batteryLabels}>
        <Text size="2" weight="bold">{batteryPercent}%</Text>
        <Text size="1" color="gray">Limit: {chargeLimitPercent}%</Text>
      </div>
    </div>
  );
}

function isPublicKeyPairingError(error: string | null | undefined): boolean {
  if (!error) return false;
  const normalized = error.toLowerCase();
  return normalized.includes("public key") &&
    (normalized.includes("not been paired") || normalized.includes("not paired"));
}

function getVisibleVehicleError(
  externallyManaged: boolean,
  vehicleError: string | null | undefined,
) {
  if (externallyManaged && isPublicKeyPairingError(vehicleError)) return null;
  return vehicleError;
}

function VehicleStatus(
  { state, mode, atHome, chargeController }: {
    state: VehicleChargeState;
    mode: VehicleMode;
    atHome: boolean | null | undefined;
    chargeController: VehicleChargeController;
  },
) {
  return (
    <div className={styles.status}>
      <StatusIcon state={state} />
      <Text size="2">{getStatusText(state, mode, atHome, chargeController)}</Text>
    </div>
  );
}

export function VehicleCard({
  name,
  state,
  priority,
  mode,
  chargeController = "vehicle",
  commandPending,
  onStartCharging,
  onStopCharging,
  onSetAmps,
  onChangeMode,
  onNavigateSettings,
  solarPowerW = 0,
  batteryPowerW = 0,
  gridPowerW = 0,
  loading = false,
  commandsDisabled = false,
  commandsDisabledReason,
  vehicleError,
  lastLocation,
  atHome,
  allocationStatus,
  onRefresh,
  pollingSuspended,
  pollingSuspendReason,
  controllerReason,
  controllerDetail,
  forecastContent,
}: VehicleCardProps) {
  if (loading) {
    return (
      <Card className={styles.card}>
        <Skeleton width="100%" height="180px" />
      </Card>
    );
  }

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const batteryPercent = Math.round(state.batteryLevel);
  const chargeLimitPercent = Math.round(state.chargeLimit);
  const pending = commandPending || "";
  const externallyManaged = chargeController === "wattpilot";
  const disabled = !!commandPending || commandsDisabled;
  const visibleVehicleError = getVisibleVehicleError(
    externallyManaged,
    vehicleError,
  );
  const lastUpdatedText = state.lastUpdated
    ? formatRelativeTime(new Date(state.lastUpdated))
    : null;

  return (
    <Card
      className={styles.card}
      style={{ "--accent": "var(--color-vehicle)" } as React.CSSProperties}
    >
      <VehicleCardHeader
        name={name}
        priority={priority}
        isOnline={state.isOnline}
        lastUpdatedText={lastUpdatedText}
        onRefresh={onRefresh}
      />
      <VehicleCardBanners
        commandsDisabled={externallyManaged ? false : commandsDisabled}
        commandsDisabledReason={commandsDisabledReason}
        onNavigateSettings={onNavigateSettings}
        vehicleError={visibleVehicleError}
        pollingSuspended={pollingSuspended}
        pollingSuspendReason={pollingSuspendReason}
      />
      <ChargeControlModeSection
        externallyManaged={externallyManaged}
        mode={mode}
        disabled={disabled}
        isPluggedIn={state.isPluggedIn}
        pending={pending}
        onChangeMode={onChangeMode}
      />
      <VehicleBatterySection
        batteryPercent={batteryPercent}
        chargeLimitPercent={chargeLimitPercent}
        isCharging={state.isCharging}
      />
      <VehicleStatus
        state={state}
        mode={mode}
        atHome={atHome}
        chargeController={chargeController}
      />
      {forecastContent}
      {!state.isPluggedIn && <div style={{ height: 20 }} />}
      {state.isPluggedIn && (
        <VehicleCardDetails
          allocationStatus={allocationStatus ?? null}
          controllerReason={controllerReason ?? null}
          controllerDetail={controllerDetail ?? null}
          state={state}
          disabled={disabled}
          commandPending={commandPending}
          onStartCharging={onStartCharging}
          onStopCharging={onStopCharging}
          onSetAmps={onSetAmps}
          solarPowerW={solarPowerW}
          batteryPowerW={batteryPowerW}
          gridPowerW={gridPowerW}
          chargeLimitPercent={chargeLimitPercent}
          externalControllerLabel={externallyManaged ? "Wattpilot" : null}
        />
      )}
      {lastLocation && (
        <div className={styles.mapCircle}>
          <div className={styles.mapInner}>
            <StaticMap
              latitude={lastLocation.latitude}
              longitude={lastLocation.longitude}
              width={240}
              height={150}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
