import { type ReactNode, useEffect, useState } from "react";
import {
  BatteryCharging,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Key,
  Pause,
  Plug,
  RefreshCw,
  Sparkles,
  Sun,
  Unplug,
  Zap,
} from "lucide-react";
import { Button, Card, Skeleton, Text } from "@radix-ui/themes";
import type { VehicleChargeState, VehicleMode } from "@chargeha/shared";
import { formatRelativeTime } from "../../utils/Format.ts";
import { Spinner } from "../ui/Spinner.tsx";
import { ErrorBanner } from "../ui/ErrorBanner.tsx";
import { VehicleBatterySection } from "./VehicleBatterySection.tsx";
import { VehicleCardDetails } from "./VehicleCardDetails.tsx";
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
  auto: "Smart",
  charge_now: "Now",
  vacation: "Solar",
  stop: "Pause",
};

const OTHER_MODE_BUTTONS: {
  value: VehicleMode;
  label: string;
  color: "orange" | "blue" | "green" | "gray";
  icon: ReactNode;
}[] = [
  {
    value: "vacation",
    label: "Solar",
    color: "orange",
    icon: <Sun size={18} aria-hidden="true" />,
  },
  {
    value: "charge_now",
    label: "Now",
    color: "green",
    icon: <Zap size={18} aria-hidden="true" />,
  },
  {
    value: "stop",
    label: "Pause",
    color: "gray",
    icon: <Pause size={18} aria-hidden="true" />,
  },
];

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

  if (state.isCharging) {
    if (mode === "charge_now") return "Charging now";
    if (controllerReason === "schedule") {
      return "Charging with lower-cost electricity";
    }
    if (controllerReason === "solar_tracking" || mode === "vacation") {
      return "Charging with available solar";
    }
    return "Smart charging in progress";
  }

  if (mode === "stop") return "Charging paused";
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

function getStatusColor(state: VehicleChargeState): string {
  if (state.isCharging) return "var(--color-charging)";
  if (state.isPluggedIn) return "var(--color-vehicle)";
  return "var(--color-disconnected)";
}

function StatusIcon({ state }: { state: VehicleChargeState }) {
  const iconStyle = { color: getStatusColor(state), flexShrink: 0 };
  if (state.isCharging) {
    return <BatteryCharging size={20} style={iconStyle} aria-hidden="true" />;
  }
  if (state.isPluggedIn) {
    return <Plug size={20} style={iconStyle} aria-hidden="true" />;
  }
  return <Unplug size={20} style={iconStyle} aria-hidden="true" />;
}

function PrimaryStatus(
  {
    state,
    mode,
    atHome,
    controllerReason,
  }: {
    state: VehicleChargeState;
    mode: VehicleMode;
    atHome: boolean | null | undefined;
    controllerReason: string | null | undefined;
  },
) {
  return (
    <div className={styles.status} aria-live="polite">
      <div className={styles.statusIcon}>
        <StatusIcon state={state} />
      </div>
      <div className={styles.statusCopy}>
        <Text size="1" color="gray" weight="medium">
          Charging status
        </Text>
        <Text size="3" weight="bold">
          {getStatusText(state, mode, atHome, controllerReason)}
        </Text>
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
  const [otherOptionsOpen, setOtherOptionsOpen] = useState(false);
  const smartActive = mode === "auto";
  const smartPending = pending === "mode:auto";

  const selectOtherMode = (nextMode: VehicleMode) => {
    onChangeMode(nextMode);
    setOtherOptionsOpen(false);
  };
  const hint = smartChargeHint(mode, state.isPluggedIn);

  return (
    <div className={styles.modeSection}>
      <Button
        variant="solid"
        color="blue"
        size="3"
        className={`${styles.smartChargeButton} ${
          smartActive ? styles.smartChargeActive : ""
        }`}
        disabled={disabled}
        onClick={() => {
          if (!smartActive) onChangeMode("auto");
        }}
        aria-pressed={smartActive}
      >
        {smartPending ? <Spinner /> : <Sparkles size={21} aria-hidden="true" />}
        {smartActive ? "Smart Charge is on" : "Use Smart Charge"}
      </Button>

      <Text size="1" color="gray" className={styles.smartChargeHint}>
        {hint}
      </Text>

      <Button
        variant="ghost"
        color="gray"
        size="2"
        className={styles.otherOptionsToggle}
        onClick={() => setOtherOptionsOpen((open) => !open)}
        aria-expanded={otherOptionsOpen}
      >
        Other options
        {otherOptionsOpen
          ? <ChevronUp size={17} aria-hidden="true" />
          : <ChevronDown size={17} aria-hidden="true" />}
      </Button>

      {otherOptionsOpen && (
        <div
          className={styles.otherOptions}
          aria-label="Other charging options"
        >
          {OTHER_MODE_BUTTONS.map((btn) => (
            <Button
              key={btn.value}
              variant={mode === btn.value ? "solid" : "soft"}
              color={mode === btn.value ? btn.color : "gray"}
              size="2"
              disabled={disabled}
              onClick={() => selectOtherMode(btn.value)}
              aria-pressed={mode === btn.value}
            >
              {pending === `mode:${btn.value}` ? <Spinner /> : btn.icon}
              {btn.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function smartChargeHint(mode: VehicleMode, isPluggedIn: boolean): string {
  if (mode !== "auto") return `${MODE_LABELS[mode]} mode is active.`;
  if (!isPluggedIn) return "Ready for the next connection.";
  return "E.V. Solar chooses the cleanest, lowest-cost time.";
}

function TechnicalMeta(
  {
    priority,
    isOnline,
    lastUpdatedText,
    refreshing,
    onRefresh,
  }: {
    priority: number;
    isOnline: boolean;
    lastUpdatedText: string | null;
    refreshing: boolean;
    onRefresh?: () => Promise<unknown>;
  },
) {
  return (
    <div className={styles.technicalMeta}>
      <Text size="1" color="gray">
        {isOnline ? "Online" : "Offline"} · Priority {priority}
        {lastUpdatedText ? ` · Updated ${lastUpdatedText}` : ""}
      </Text>
      {onRefresh && (
        <Button
          variant="ghost"
          size="1"
          color="gray"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw
            size={12}
            className={refreshing ? styles.spinning : undefined}
          />
          {refreshing ? "Updating…" : "Refresh"}
        </Button>
      )}
    </div>
  );
}

interface TechnicalPanelProps {
  open: boolean;
  state: VehicleChargeState;
  priority: number;
  lastUpdatedText: string | null;
  refreshing: boolean;
  onRefresh?: () => Promise<unknown>;
  pollingSuspended?: boolean;
  pollingSuspendReason?: string | null;
  commandsDisabledReason?: string;
  vehicleError?: string | null;
  allocationStatus?: string | null;
  controllerReason?: string | null;
  controllerDetail?: string | null;
  disabled: boolean;
  commandPending: string | false;
  onStartCharging: () => void;
  onStopCharging: () => void;
  onSetAmps: (amps: number) => void;
  solarPowerW: number;
  batteryPowerW: number;
  gridPowerW: number;
  chargeLimitPercent: number;
}

function TechnicalPanel(props: TechnicalPanelProps) {
  if (!props.open) return null;

  return (
    <div className={styles.technicalPanel}>
      <TechnicalMeta
        priority={props.priority}
        isOnline={props.state.isOnline}
        lastUpdatedText={props.lastUpdatedText}
        refreshing={props.refreshing}
        onRefresh={props.onRefresh}
      />

      {props.pollingSuspended && (
        <Text size="1" color="gray">
          Polling paused — {props.pollingSuspendReason ?? "idle"}
        </Text>
      )}
      {props.commandsDisabledReason && (
        <Text size="1" color="gray">
          Control detail: {props.commandsDisabledReason}
        </Text>
      )}
      {props.vehicleError && (
        <Text size="1" color="gray">
          Connection detail: {props.vehicleError}
        </Text>
      )}

      {props.state.isPluggedIn && (
        <VehicleCardDetails
          allocationStatus={props.allocationStatus ?? null}
          controllerReason={props.controllerReason ?? null}
          controllerDetail={props.controllerDetail ?? null}
          state={props.state}
          disabled={props.disabled}
          commandPending={props.commandPending}
          onStartCharging={props.onStartCharging}
          onStopCharging={props.onStopCharging}
          onSetAmps={props.onSetAmps}
          solarPowerW={props.solarPowerW}
          batteryPowerW={props.batteryPowerW}
          gridPowerW={props.gridPowerW}
          chargeLimitPercent={props.chargeLimitPercent}
        />
      )}
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

function useVehicleCardRefresh(onRefresh: VehicleCardProps["onRefresh"]) {
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return { refreshing, handleRefresh };
}

export function VehicleCard({
  name,
  state,
  priority,
  mode,
  commandPending,
  onStartCharging,
  onStopCharging,
  onSetAmps,
  onSetChargeLimit,
  onChangeMode,
  onNavigateSettings,
  solarPowerW = 0,
  batteryPowerW = 0,
  gridPowerW = 0,
  loading = false,
  commandsDisabled = false,
  commandsDisabledReason,
  vehicleError,
  atHome,
  allocationStatus,
  onRefresh,
  pollingSuspended,
  pollingSuspendReason,
  controllerReason,
  controllerDetail,
  forecastContent,
  scheduledCharge,
}: VehicleCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [, setTick] = useState(0);
  const { refreshing, handleRefresh } = useVehicleCardRefresh(onRefresh);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (loading) return <VehicleCardSkeleton />;

  const batteryPercent = Math.round(state.batteryLevel);
  const chargeLimitPercent = Math.round(state.chargeLimit);
  const pending = commandPending || "";
  const disabled = !!commandPending || commandsDisabled;
  const lastUpdatedText = state.lastUpdated
    ? formatRelativeTime(new Date(state.lastUpdated))
    : null;

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

      <Button
        variant="ghost"
        color="gray"
        size="2"
        className={styles.detailsToggle}
        onClick={() => setDetailsOpen((value) => !value)}
        aria-expanded={detailsOpen}
      >
        {detailsOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        {detailsOpen ? "Hide details" : "Show details"}
      </Button>

      <TechnicalPanel
        open={detailsOpen}
        state={state}
        priority={priority}
        lastUpdatedText={lastUpdatedText}
        refreshing={refreshing}
        onRefresh={onRefresh ? handleRefresh : undefined}
        pollingSuspended={pollingSuspended}
        pollingSuspendReason={pollingSuspendReason}
        commandsDisabledReason={commandsDisabledReason}
        vehicleError={vehicleError}
        allocationStatus={allocationStatus}
        controllerReason={controllerReason}
        controllerDetail={controllerDetail}
        disabled={disabled}
        commandPending={commandPending}
        onStartCharging={onStartCharging}
        onStopCharging={onStopCharging}
        onSetAmps={onSetAmps}
        solarPowerW={solarPowerW}
        batteryPowerW={batteryPowerW}
        gridPowerW={gridPowerW}
        chargeLimitPercent={chargeLimitPercent}
      />
    </Card>
  );
}
