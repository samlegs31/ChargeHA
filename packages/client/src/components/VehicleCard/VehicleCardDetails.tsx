import {
  ArrowUpDown,
  BatteryCharging,
  Calendar,
  CloudSun,
  Plug,
  ShieldBan,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, Text, Tooltip } from "@radix-ui/themes";
import type { VehicleChargeState } from "@chargeha/shared";
import { kwValue } from "../../utils/Format.ts";
import { Spinner } from "../ui/Spinner.tsx";
import styles from "./VehicleCard.module.css";

/** Tesla adds the sensed current to the runtime state without changing the
 * shared adapter contract used by other vehicle plugins. */
type VehicleStateWithActualAmps = VehicleChargeState & {
  chargeAmpsActual?: number;
};

/** Which controller reasons warrant a visible status row. */
const VISIBLE_REASONS = new Set([
  "schedule",
  "blockout",
  "grace_period",
  "cooldown",
  "battery_priority",
]);

const REASON_ICONS: Record<string, LucideIcon> = {
  schedule: Calendar,
  blockout: ShieldBan,
  grace_period: CloudSun,
  cooldown: CloudSun,
  battery_priority: BatteryCharging,
};

const REASON_COLORS: Record<string, "blue" | "orange"> = {
  schedule: "blue",
  blockout: "orange",
  grace_period: "orange",
  cooldown: "orange",
  battery_priority: "orange",
};

/** User-friendly label formatters per reason. */
const REASON_LABELS: Record<string, (detail: string) => string> = {
  schedule: (detail) => {
    const targetMatch = detail.match(/target reached \([^)]*>= (\d+)%\)/);
    if (targetMatch) {
      return `HC target reached · ${targetMatch[1]}%`;
    }

    const startMatch = detail.match(
      /Start charging at (\d+)A \(schedule (\d{2}:\d{2})-(\d{2}:\d{2})\)/,
    );
    if (startMatch) {
      return `Off-peak charging active · ${startMatch[1]}A · until ${
        startMatch[3]
      }`;
    }

    const scheduleMatch = detail.match(/schedule (\d{2}:\d{2})-(\d{2}:\d{2})/);
    if (scheduleMatch) {
      return `Off-peak charging active · until ${scheduleMatch[2]}`;
    }

    const ampsMatch = detail.match(/Adjust to (\d+)A \(schedule\)/);
    if (ampsMatch) {
      return `Off-peak charging active · ${ampsMatch[1]}A`;
    }

    return "Off-peak charging active";
  },
  blockout: () => "Blockout schedule active",
  grace_period: (detail) => {
    const match = detail.match(/(\d+s\/\d+s)/);
    return match
      ? `Low solar — grace period (${match[1]})`
      : "Low solar — grace period active";
  },
  cooldown: (detail) => {
    const match = detail.match(/(\d+)s remaining/);
    return match ? `Cooldown — ${match[1]}s remaining` : "Cooldown active";
  },
  battery_priority: (detail) => {
    const match = detail.match(/(\d+)%.*<.*(\d+)%/);
    return match
      ? `Home battery priority (${match[1]}% < ${match[2]}%)`
      : "Waiting for home battery";
  },
};

interface VehicleCardDetailsProps {
  state: VehicleChargeState;
  disabled: boolean;
  commandPending: string | false;
  onStartCharging: () => void;
  onStopCharging: () => void;
  onSetAmps: (amps: number) => void;
  solarPowerW: number;
  batteryPowerW: number;
  gridPowerW: number;
  chargeLimitPercent: number;
  allocationStatus: string | null;
  controllerReason: string | null;
  controllerDetail: string | null;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatAmps(amps: number): string {
  return Number.isInteger(amps) ? String(amps) : amps.toFixed(1);
}

function actualAmps(state: VehicleChargeState): number {
  return (state as VehicleStateWithActualAmps).chargeAmpsActual ??
    state.chargeAmps;
}

function isCurrentRamping(state: VehicleChargeState): boolean {
  return state.isCharging &&
    Math.abs(state.chargeAmps - actualAmps(state)) >= 0.5;
}

function ChargeButton(
  { isCharging, disabled, commandPending, onStart, onStop }: {
    isCharging: boolean;
    disabled: boolean;
    commandPending: string | false;
    onStart: () => void;
    onStop: () => void;
  },
) {
  if (isCharging) {
    return (
      <Button
        variant="soft"
        color="red"
        size="2"
        disabled={disabled}
        onClick={onStop}
      >
        {commandPending === "stop" ? <Spinner /> : null}
        {commandPending === "stop" ? "Stopping..." : "Stop Charging"}
      </Button>
    );
  }
  return (
    <Button
      variant="soft"
      color="green"
      size="2"
      disabled={disabled}
      onClick={onStart}
    >
      {commandPending === "start" ? <Spinner /> : null}
      {commandPending === "start" ? "Starting..." : "Start Charging"}
    </Button>
  );
}

function ControllerReasonRow(
  { reason, detail }: { reason: string; detail: string },
) {
  const Icon = REASON_ICONS[reason];
  const label = REASON_LABELS[reason]?.(detail) ?? detail;
  const color = REASON_COLORS[reason] ?? "gray";
  return (
    <div className={styles.detailRow}>
      {Icon && <Icon size={14} />}
      <Text size="1" color={color}>{label}</Text>
    </div>
  );
}

function AmpsControl(
  { state, disabled, commandPending, onSetAmps }: {
    state: VehicleChargeState;
    disabled: boolean;
    commandPending: string | false;
    onSetAmps: (amps: number) => void;
  },
) {
  const targetAmps = state.chargeAmps;
  return (
    <Tooltip content="Start charging to adjust amps" hidden={state.isCharging}>
      <div className={styles.ampsControl}>
        <Button
          variant="ghost"
          size="1"
          disabled={disabled || !state.isCharging ||
            targetAmps <= state.chargeAmpsMin}
          onClick={() =>
            onSetAmps(Math.round(targetAmps) - 1)}
        >
          {commandPending === "amps" ? <Spinner /> : "−"}
        </Button>
        <Text size="2" weight="bold">{formatAmps(targetAmps)}A</Text>
        <Button
          variant="ghost"
          size="1"
          disabled={disabled || !state.isCharging ||
            targetAmps >= state.chargeAmpsMax}
          onClick={() =>
            onSetAmps(Math.round(targetAmps) + 1)}
        >
          {commandPending === "amps" ? <Spinner /> : "+"}
        </Button>
      </div>
    </Tooltip>
  );
}

export function VehicleCardDetails({
  state,
  disabled,
  commandPending,
  onStartCharging,
  onStopCharging,
  onSetAmps,
  solarPowerW,
  batteryPowerW,
  gridPowerW,
  chargeLimitPercent,
  allocationStatus,
  controllerReason,
  controllerDetail,
}: VehicleCardDetailsProps) {
  const targetAmps = state.chargeAmps;
  const liveAmps = actualAmps(state);
  const ramping = isCurrentRamping(state);
  const currentLabel = ramping
    ? `${formatAmps(liveAmps)}A actual · ${formatAmps(targetAmps)}A target · ${
      formatAmps(state.chargeAmpsMax)
    }A max`
    : `${formatAmps(liveAmps)}A / ${formatAmps(state.chargeAmpsMax)}A max`;

  return (
    <>
      {/* Charge details */}
      <div className={styles.details}>
        <div className={styles.detailRow}>
          <Zap size={14} />
          <Text size="1" color="gray">
            {state.isCharging ? currentLabel : "Not Charging"}
          </Text>
        </div>
        {allocationStatus && (
          <div className={styles.detailRow}>
            <ArrowUpDown size={14} />
            <Text size="1" color="yellow">{allocationStatus}</Text>
          </div>
        )}
        {controllerReason && controllerDetail &&
          VISIBLE_REASONS.has(controllerReason) && (
          <ControllerReasonRow
            reason={controllerReason}
            detail={controllerDetail}
          />
        )}
        {state.isCharging && (
          <>
            {(solarPowerW > 0 || batteryPowerW > 0 || gridPowerW > 0) && (
              <div className={styles.detailRow}>
                <ArrowUpDown size={14} />
                <Text size="1" color="gray">
                  {kwValue(solarPowerW)} solar
                  {batteryPowerW > 0 &&
                    `, ${kwValue(batteryPowerW)} battery`}
                  {`, ${kwValue(gridPowerW)} grid`}
                </Text>
              </div>
            )}
            <div className={styles.detailRow}>
              <BatteryCharging size={14} />
              <Text size="1" color="gray">
                {state.energyAddedKwh.toFixed(1)} kWh added
              </Text>
            </div>
            {ramping
              ? (
                <div className={styles.detailRow}>
                  <Plug size={14} />
                  <Text size="1" color="gray">
                    ETA updating while charging current settles
                  </Text>
                </div>
              )
              : state.minutesToFull > 0 && (
                <div className={styles.detailRow}>
                  <Plug size={14} />
                  <Text size="1" color="gray">
                    {formatMinutes(state.minutesToFull)} to{" "}
                    {chargeLimitPercent}%
                  </Text>
                </div>
              )}
          </>
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.buttonRow}>
          <ChargeButton
            isCharging={state.isCharging}
            disabled={disabled}
            commandPending={commandPending}
            onStart={onStartCharging}
            onStop={onStopCharging}
          />
        </div>
        <AmpsControl
          state={state}
          disabled={disabled}
          commandPending={commandPending}
          onSetAmps={onSetAmps}
        />
      </div>
    </>
  );
}