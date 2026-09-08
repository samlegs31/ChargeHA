import type { ReactNode } from "react";
import {
  AlertTriangle,
  BatteryCharging,
  CalendarClock,
  Clock3,
  Key,
  Plug,
  Sparkles,
  Square,
  Sun,
  Unplug,
  Zap,
} from "lucide-react";
import { Button, Card, Skeleton, Text } from "@radix-ui/themes";
import type { VehicleChargeState, VehicleMode } from "@chargeha/shared";
import { Spinner } from "../ui/Spinner.tsx";
import { ErrorBanner } from "../ui/ErrorBanner.tsx";
import { VehicleBatterySection } from "./VehicleBatterySection.tsx";
import { VehicleSilhouetteIcon } from "../icons/VehicleSilhouetteIcon.tsx";
import styles from "./VehicleCard.module.css";
import type { ScheduledChargeDisplay } from "../pages/Dashboard/scheduledCharge.ts";
import {
  type ChargeStatusKind,
  getChargeStatusKind,
  getStatusDetail,
  getStatusHeadline,
  VEHICLE_MODE_LABELS,
} from "./vehiclePresentation.ts";

interface VehicleCardProps {
  name: string;
  state: VehicleChargeState;
  priority: number;
  mode: VehicleMode;
  commandPending: string | false;
  onStartCharging: () => void;
  onStopCharging: () => void;
  onSetAmps: (amps: number) => void;
  onSetChargeLimit?: (percent: number) => Promise<void>;
  onChangeMode: (mode: VehicleMode) => void;
  onNavigateSettings?: () => void;
  solarPowerW?: number;
  batteryPowerW?: number;
  gridPowerW?: number;
  loading?: boolean;
  commandsDisabled?: boolean;
  commandsDisabledReason?: string;
  vehicleError?: string | null;
  atHome?: boolean | null;
  allocationStatus?: string | null;
  onRefresh?: () => Promise<unknown>;
  pollingSuspended?: boolean;
  pollingSuspendReason?: string | null;
  controllerReason?: string | null;
  controllerDetail?: string | null;
  forecastContent?: ReactNode;
  scheduledCharge?: ScheduledChargeDisplay | null;
}

const MODE_OPTIONS: Array<{
  value: "stop" | "auto" | "vacation";
  label: string;
  icon: ReactNode;
}> = [
  {
    value: "stop",
    label: "Stop",
    icon: <Square size={17} aria-hidden="true" />,
  },
  {
    value: "auto",
    label: "Solar + Off-Peak",
    icon: <Sparkles size={18} aria-hidden="true" />,
  },
  {
    value: "vacation",
    label: "Solar Only",
    icon: <Sun size={18} aria-hidden="true" />,
  },
];

function ActiveMode({ mode }: { mode: VehicleMode }) {
  const icons: Record<VehicleMode, ReactNode> = {
    auto: <Sparkles size={14} aria-hidden="true" />,
    vacation: <Sun size={14} aria-hidden="true" />,
    charge_now: <Zap size={14} aria-hidden="true" />,
    stop: <Square size={12} aria-hidden="true" />,
  };

  return (
    <div
      className={styles.activeMode}
      data-mode={mode}
      aria-label={`Active mode: ${VEHICLE_MODE_LABELS[mode]}`}
    >
      {icons[mode]}
      <strong>{VEHICLE_MODE_LABELS[mode]}</strong>
    </div>
  );
}

function StatusIcon({ kind }: { kind: ChargeStatusKind }) {
  if (kind === "charging") {
    return <BatteryCharging size={21} aria-hidden="true" />;
  }
  if (kind === "waiting") return <Clock3 size={20} aria-hidden="true" />;
  if (kind === "connected") return <Plug size={20} aria-hidden="true" />;
  if (kind === "error") return <AlertTriangle size={20} aria-hidden="true" />;
  return <Unplug size={20} aria-hidden="true" />;
}

function PrimaryStatus({
  state,
  mode,
  atHome,
  controllerReason,
  controllerDetail,
  vehicleError,
  commandsDisabled,
}: {
  state: VehicleChargeState;
  mode: VehicleMode;
  atHome: boolean | null | undefined;
  controllerReason: string | null | undefined;
  controllerDetail?: string | null;
  vehicleError: string | null | undefined;
  commandsDisabled: boolean;
}) {
  const kind = getChargeStatusKind({
    state,
    mode,
    controllerReason,
    vehicleError,
    commandsDisabled,
  });

  return (
    <div
      className={styles.status}
      data-status={kind}
      data-mode={mode}
      aria-live="polite"
      data-testid="vehicle-charge-status"
    >
      <div className={styles.statusIcon} aria-hidden="true">
        <StatusIcon kind={kind} />
      </div>
      <div className={styles.statusCopy}>
        <Text size="3" weight="bold" className={styles.statusHeadline}>
          {getStatusHeadline(kind, state, mode)}
        </Text>
        <Text size="1" color="gray" weight="medium">
          {commandsDisabled
            ? "Vehicle control unavailable"
            : getStatusDetail(state, mode, atHome, controllerReason)}
        </Text>
        {controllerDetail && kind === "waiting" && atHome !== false && (
          <Text size="1" color="gray" data-testid="charging-decision-detail">
            {controllerDetail}
          </Text>
        )}
        {kind === "charging" && (
          <Text size="1" color="gray" className={styles.chargeMetrics}>
            {state.chargeAmps} A · {state.energyAddedKwh.toFixed(1)} kWh added
            {state.minutesToFull > 0
              ? ` · ${state.minutesToFull} min remaining`
              : ""}
          </Text>
        )}
      </div>
    </div>
  );
}

function ScheduledChargeNotice({ charge }: { charge: ScheduledChargeDisplay }) {
  const active = charge.status === "active";
  return (
    <div
      className={styles.scheduleNotice}
      data-active={active}
      data-testid="scheduled-charge-notice"
      aria-live="polite"
    >
      <div className={styles.scheduleIcon} aria-hidden="true">
        <CalendarClock size={19} />
      </div>
      <div className={styles.scheduleCopy}>
        <Text size="2" weight="bold">{charge.title}</Text>
        <Text size="1" color="gray">{charge.detail}</Text>
      </div>
    </div>
  );
}

function VehicleCardBanners({
  commandsDisabled,
  onNavigateSettings,
  vehicleError,
}: {
  commandsDisabled: boolean;
  onNavigateSettings?: () => void;
  vehicleError?: string | null;
}) {
  if (!commandsDisabled && !vehicleError) return null;

  if (commandsDisabled) {
    return (
      <div className={styles.bannerWrap}>
        <ErrorBanner
          title="Vehicle control unavailable"
          description="Check Settings if the connection does not recover."
        >
          {onNavigateSettings && (
            <Button
              variant="soft"
              color="orange"
              size="2"
              onClick={onNavigateSettings}
            >
              <Key size={14} />
              Open Settings
            </Button>
          )}
        </ErrorBanner>
      </div>
    );
  }

  return (
    <div className={styles.bannerWrap}>
      <ErrorBanner
        title="Vehicle connection unavailable"
        description="E.V. Solar will retry automatically."
      />
    </div>
  );
}

function VehicleModeSection({
  mode,
  disabled,
  pending,
  onChangeMode,
}: {
  mode: VehicleMode;
  disabled: boolean;
  pending: string;
  onChangeMode: (mode: VehicleMode) => void;
}) {
  return (
    <div className={styles.modeSection}>
      <Text size="1" color="gray" weight="medium" className={styles.modeLabel}>
        Charging mode
      </Text>
      <div className={styles.modeGrid} aria-label="Charging mode">
        {MODE_OPTIONS.map((option) => {
          const active = mode === option.value;
          const isPending = pending === `mode:${option.value}`;
          return (
            <button
              key={option.value}
              type="button"
              className={styles.modeButton}
              data-mode={option.value}
              data-active={active}
              disabled={disabled}
              onClick={() => {
                if (!active) onChangeMode(option.value);
              }}
              aria-label={`${option.label} mode${active ? ", selected" : ""}`}
              aria-pressed={active}
            >
              <span className={styles.modeIcon} aria-hidden="true">
                {isPending ? <Spinner /> : option.icon}
              </span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NowAmpsControl({
  state,
  disabled,
  commandPending,
  onSetAmps,
}: {
  state: VehicleChargeState;
  disabled: boolean;
  commandPending: string | false;
  onSetAmps: (amps: number) => void;
}) {
  const amps = state.chargeAmps;
  return (
    <div className={styles.nowAmpsRow}>
      <Text size="2" weight="bold">Manual current</Text>
      <div className={styles.ampsControl}>
        <Button
          variant="ghost"
          size="1"
          disabled={disabled || amps <= state.chargeAmpsMin}
          onClick={() => onSetAmps(Math.round(amps) - 1)}
        >
          {commandPending === "amps" ? <Spinner /> : "−"}
        </Button>
        <Text size="2" weight="bold">{amps} A</Text>
        <Button
          variant="ghost"
          size="1"
          disabled={disabled || amps >= state.chargeAmpsMax}
          onClick={() => onSetAmps(Math.round(amps) + 1)}
        >
          {commandPending === "amps" ? <Spinner /> : "+"}
        </Button>
      </div>
    </div>
  );
}

function VehicleCardSkeleton() {
  return (
    <Card className={styles.card}>
      <Skeleton width="100%" height="220px" />
    </Card>
  );
}

export function VehicleCard({
  name,
  state,
  mode,
  commandPending,
  onSetAmps,
  onSetChargeLimit,
  onChangeMode,
  onNavigateSettings,
  loading = false,
  commandsDisabled = false,
  vehicleError,
  atHome,
  controllerReason,
  controllerDetail,
  forecastContent,
  scheduledCharge,
}: VehicleCardProps) {
  if (loading) return <VehicleCardSkeleton />;

  const batteryPercent = Math.round(state.batteryLevel);
  const chargeLimitPercent = Math.round(state.chargeLimit);
  const pending = commandPending || "";
  const disabled = !!commandPending || commandsDisabled;

  return (
    <Card className={styles.card}>
      <div className={styles.header}>
        <div className={styles.vehicleIdentity}>
          <span className={styles.vehicleIcon} aria-hidden="true">
            <VehicleSilhouetteIcon size={46} />
          </span>
          <div className={styles.vehicleNameGroup}>
            <Text size="4" weight="bold" className={styles.vehicleName}>
              {name}
            </Text>
            <Text size="1" color="gray">
              {state.isPluggedIn ? "Plugged in" : "Unplugged"}
            </Text>
          </div>
        </div>
        <ActiveMode mode={mode} />
      </div>

      <PrimaryStatus
        state={state}
        mode={mode}
        atHome={atHome}
        controllerReason={controllerReason}
        controllerDetail={controllerDetail}
        vehicleError={vehicleError}
        commandsDisabled={commandsDisabled}
      />

      <VehicleCardBanners
        commandsDisabled={commandsDisabled}
        onNavigateSettings={onNavigateSettings}
        vehicleError={vehicleError}
      />

      {scheduledCharge && <ScheduledChargeNotice charge={scheduledCharge} />}

      <VehicleBatterySection
        batteryPercent={batteryPercent}
        chargeLimitPercent={chargeLimitPercent}
        isCharging={state.isCharging}
        isPluggedIn={state.isPluggedIn}
        disabled={disabled}
        onSetChargeLimit={onSetChargeLimit}
      />

      {forecastContent}

      <VehicleModeSection
        mode={mode}
        disabled={disabled}
        pending={pending}
        onChangeMode={onChangeMode}
      />

      {mode === "charge_now" && state.isOnline && state.isPluggedIn && (
        <NowAmpsControl
          state={state}
          disabled={disabled}
          commandPending={commandPending}
          onSetAmps={onSetAmps}
        />
      )}
    </Card>
  );
}
