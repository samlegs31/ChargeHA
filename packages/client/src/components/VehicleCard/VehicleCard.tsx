import type { ReactNode } from "react";
import {
  BatteryCharging,
  CalendarClock,
  Check,
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

const MODE_LABELS: Record<VehicleMode, string> = {
  auto: "Smart charging",
  charge_now: "Now",
  vacation: "Solar",
  stop: "Stop",
};

const MODE_OPTIONS: {
  value: VehicleMode;
  label: string;
  description: string;
  icon: ReactNode;
}[] = [
  {
    value: "auto",
    label: "Smart",
    description: "Solar + off-peak",
    icon: <Sparkles size={20} aria-hidden="true" />,
  },
  {
    value: "vacation",
    label: "Solar",
    description: "Solar surplus only",
    icon: <Sun size={20} aria-hidden="true" />,
  },
  {
    value: "charge_now",
    label: "Now",
    description: "Manual grid charging",
    icon: <Zap size={20} aria-hidden="true" />,
  },
  {
    value: "stop",
    label: "Stop",
    description: "Stop charging",
    icon: <Square size={18} aria-hidden="true" />,
  },
];

function ActiveMode({ mode }: { mode: VehicleMode }) {
  const icons: Record<VehicleMode, ReactNode> = {
    auto: <Sparkles size={15} aria-hidden="true" />,
    vacation: <Sun size={15} aria-hidden="true" />,
    charge_now: <Zap size={15} aria-hidden="true" />,
    stop: <Square size={13} aria-hidden="true" />,
  };

  return (
    <div
      className={styles.activeMode}
      data-mode={mode}
      aria-label={`Active mode: ${MODE_LABELS[mode]}`}
    >
      {icons[mode]}
      <span>Mode</span>
      <strong>{MODE_LABELS[mode]}</strong>
    </div>
  );
}

function getStatusText(
  state: VehicleChargeState,
  mode: VehicleMode,
  atHome: boolean | null | undefined,
  controllerReason: string | null | undefined,
): string {
  if (!state.isOnline) return "Vehicle offline — waiting to reconnect";

  if (!state.isPluggedIn) {
    return `Unplugged — ${MODE_LABELS[mode]} ready for next connection`;
  }

  if (atHome === false) {
    return state.isCharging
      ? "Charging away from home"
      : "Plugged in away from home";
  }

  if (mode === "stop") return "Charging stopped until next connection";

  if (state.isCharging) {
    if (mode === "charge_now") return "Charging now";
    if (controllerReason === "energy_unavailable") {
      return "Solar data unavailable — charging safely at minimum";
    }
    if (controllerReason === "schedule") {
      return "Charging with lower-cost electricity";
    }
    if (controllerReason === "solar_tracking" || mode === "vacation") {
      return "Charging with available solar";
    }
    return "Smart charging in progress";
  }

  if (controllerReason === "energy_unavailable") {
    return "Waiting for live solar data";
  }
  if (controllerReason === "battery_priority") {
    return "Home battery has priority";
  }
  if (controllerReason === "grace_period") {
    return "Solar is low — waiting briefly";
  }
  if (controllerReason === "cooldown") {
    return "Waiting for solar to return";
  }
  if (controllerReason === "blockout") {
    return "Charging paused for this time period";
  }
  if (mode === "vacation") return "Waiting for enough solar";
  if (mode === "charge_now") return "Starting charge";
  return "Ready — E.V. Solar will choose the best time";
}

type ChargeStatusKind =
  | "charging"
  | "waiting"
  | "connected"
  | "stopped"
  | "disconnected"
  | "error";

function getChargeStatusKind(
  state: VehicleChargeState,
  mode: VehicleMode,
  controllerReason: string | null | undefined,
  vehicleError: string | null | undefined,
): ChargeStatusKind {
  if (vehicleError || !state.isOnline) return "error";
  if (!state.isPluggedIn) return "disconnected";
  if (mode === "stop") return "stopped";
  if (state.isCharging) return "charging";
  if (
    mode === "vacation" ||
    controllerReason === "energy_unavailable" ||
    controllerReason === "battery_priority" ||
    controllerReason === "grace_period" ||
    controllerReason === "cooldown"
  ) return "waiting";
  return "connected";
}

function formatChargingPower(chargePowerKw: number): string {
  const watts = Math.max(0, Math.round(chargePowerKw * 1000));
  return `${new Intl.NumberFormat("fr-FR").format(watts)} W`;
}

function getStatusHeadline(
  kind: ChargeStatusKind,
  chargePowerKw: number,
): string {
  if (kind === "charging") {
    return `Charging · ${formatChargingPower(chargePowerKw)}`;
  }
  if (kind === "waiting") return "Waiting for energy";
  if (kind === "connected") return "Connected · Not charging";
  if (kind === "stopped") return "Stopped";
  if (kind === "disconnected") return "Disconnected";
  return "Connection error";
}

function StatusIcon({ kind }: { kind: ChargeStatusKind }) {
  if (kind === "charging") {
    const iconStyle = { color: "currentColor", flexShrink: 0 };
    return <BatteryCharging size={20} style={iconStyle} aria-hidden="true" />;
  }
  if (kind === "connected" || kind === "waiting") {
    const iconStyle = { color: "currentColor", flexShrink: 0 };
    return <Plug size={20} style={iconStyle} aria-hidden="true" />;
  }
  if (kind === "stopped") {
    return (
      <Square size={17} style={{ color: "currentColor" }} aria-hidden="true" />
    );
  }
  const iconStyle = { color: "currentColor", flexShrink: 0 };
  return <Unplug size={20} style={iconStyle} aria-hidden="true" />;
}

function PrimaryStatus(
  {
    state,
    mode,
    atHome,
    controllerReason,
    vehicleError,
  }: {
    state: VehicleChargeState;
    mode: VehicleMode;
    atHome: boolean | null | undefined;
    controllerReason: string | null | undefined;
    vehicleError: string | null | undefined;
  },
) {
  const kind = getChargeStatusKind(
    state,
    mode,
    controllerReason,
    vehicleError,
  );
  return (
    <div
      className={styles.status}
      data-status={kind}
      data-mode={mode}
      aria-live="polite"
      data-testid="vehicle-charge-status"
    >
      <div className={styles.statusIcon}>
        <StatusIcon kind={kind} />
      </div>
      <div className={styles.statusCopy}>
        <Text size="3" weight="bold" className={styles.statusHeadline}>
          {getStatusHeadline(kind, state.chargePowerKw)}
        </Text>
        <Text size="1" color="gray" weight="medium">
          {getStatusText(state, mode, atHome, controllerReason)}
        </Text>
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

function ScheduledChargeNotice(
  { charge }: { charge: ScheduledChargeDisplay },
) {
  const active = charge.status === "active";
  return (
    <div
      className={styles.scheduleNotice}
      data-active={active}
      data-testid="scheduled-charge-notice"
      aria-live="polite"
    >
      <div className={styles.scheduleIcon} aria-hidden="true">
        <CalendarClock size={22} />
      </div>
      <div className={styles.scheduleCopy}>
        <Text size="2" weight="bold">{charge.title}</Text>
        <Text size="2" color="gray">{charge.detail}</Text>
      </div>
    </div>
  );
}

function VehicleCardBanners(
  {
    commandsDisabled,
    onNavigateSettings,
    vehicleError,
  }: {
    commandsDisabled: boolean;
    onNavigateSettings?: () => void;
    vehicleError?: string | null;
  },
) {
  return (
    <>
      {commandsDisabled && (
        <div style={{ marginBottom: 14 }}>
          <ErrorBanner
            title="Automatic charging unavailable"
            description="E.V. Solar cannot control this vehicle right now. Open Settings if the connection does not recover automatically."
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
                Open Settings
              </Button>
            )}
          </ErrorBanner>
        </div>
      )}
      {vehicleError && (
        <div style={{ marginBottom: 14 }}>
          <ErrorBanner
            title="Vehicle connection problem"
            description="E.V. Solar cannot communicate with the vehicle right now. It will keep trying automatically."
          />
        </div>
      )}
    </>
  );
}

function VehicleModeSection(
  {
    state,
    mode,
    disabled,
    pending,
    onChangeMode,
  }: {
    state: VehicleChargeState;
    mode: VehicleMode;
    disabled: boolean;
    pending: string;
    onChangeMode: (mode: VehicleMode) => void;
  },
) {
  const hint = chargingModeHint(mode, state.isPluggedIn);

  return (
    <div className={styles.modeSection}>
      <div className={styles.modeHeading}>
        <Text size="2" weight="bold">Charging mode</Text>
        <Text size="1" color="gray">Choose how this vehicle charges</Text>
      </div>

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
              <span className={styles.modeButtonTop}>
                <span className={styles.modeIcon} aria-hidden="true">
                  {isPending ? <Spinner /> : option.icon}
                </span>
                {active && (
                  <span className={styles.modeSelected}>
                    <Check size={12} aria-hidden="true" />
                    Active
                  </span>
                )}
              </span>
              <strong>{option.label}</strong>
              <span className={styles.modeDescription}>
                {option.description}
              </span>
            </button>
          );
        })}
      </div>

      <Text size="1" color="gray" className={styles.modeHint}>
        {hint}
      </Text>
    </div>
  );
}

function chargingModeHint(mode: VehicleMode, isPluggedIn: boolean): string {
  if (!isPluggedIn) return "Ready for the next connection.";
  switch (mode) {
    case "auto":
      return "Smart uses solar first, then your off-peak schedule.";
    case "vacation":
      return "Solar charges only from available solar surplus.";
    case "charge_now":
      return "Now charges from the grid at your selected current.";
    case "stop":
      return "Stop prevents charging until the vehicle is unplugged.";
  }
}

function NowAmpsControl(
  {
    state,
    disabled,
    commandPending,
    onSetAmps,
  }: {
    state: VehicleChargeState;
    disabled: boolean;
    commandPending: string | false;
    onSetAmps: (amps: number) => void;
  },
) {
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
      <Skeleton width="100%" height="180px" />
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
        <div className={styles.headerLeft}>
          <VehicleSilhouetteIcon
            size={34}
            style={{ color: "var(--color-vehicle)" }}
            aria-hidden="true"
          />
          <Text size="3" weight="bold">{name}</Text>
        </div>
        <ActiveMode mode={mode} />
      </div>

      <VehicleCardBanners
        commandsDisabled={commandsDisabled}
        onNavigateSettings={onNavigateSettings}
        vehicleError={vehicleError}
      />

      <PrimaryStatus
        state={state}
        mode={mode}
        atHome={atHome}
        controllerReason={controllerReason}
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
        state={state}
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
