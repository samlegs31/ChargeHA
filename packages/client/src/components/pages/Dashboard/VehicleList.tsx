import { type ComponentProps, type ReactNode, useMemo, useState } from "react";
import { CalendarClock, Settings, Zap } from "lucide-react";
import { Button, Card, Skeleton, Text } from "@radix-ui/themes";
import type { Schedule, VehicleMode } from "@chargeha/shared";
import type { SolarChargeForecastResult } from "@chargeha/shared/forecast";
import { isHome } from "@chargeha/shared/geo";
import {
  useChargingConfig,
  useHomeConfig,
  useSystemConfig,
} from "../../../hooks/useSectionConfig.ts";
import { useEnergyData } from "../../../hooks/useEnergyData.ts";
import { useVehicles } from "../../../hooks/useVehicles.ts";
import { useToast } from "../../../hooks/useToast.tsx";
import { useControllerStatuses } from "../../../hooks/controllerStatusStore.ts";
import { VehicleCard } from "../../VehicleCard/VehicleCard.tsx";
import { VehicleSilhouetteIcon } from "../../icons/VehicleSilhouetteIcon.tsx";
import { SolarForecastInline } from "../../VehicleCard/SolarForecastInline.tsx";
import {
  type ChargeStatusKind,
  getChargeStatusKind,
  getStatusDetail,
  getStatusHeadline,
  VEHICLE_MODE_LABELS,
} from "../../VehicleCard/vehiclePresentation.ts";
import { trpc } from "../../../trpc.ts";
import { useVehicleSolarGrid } from "./energyHelpers.ts";
import {
  getScheduledChargeDisplay,
  type ScheduledChargeDisplay,
} from "./scheduledCharge.ts";
import styles from "./VehicleList.module.css";

type VehicleCardProps = ComponentProps<typeof VehicleCard>;
type VehicleItem = ReturnType<typeof useVehicles>["vehicles"][number];
type HomePoint = { lat: number; lng: number } | null;

function renderSolarForecast(
  eligible: boolean,
  mode: VehicleMode,
  data: SolarChargeForecastResult | undefined,
  isLoading: boolean,
  isError: boolean,
): ReactNode {
  if (!eligible) return null;
  return (
    <SolarForecastInline
      mode={mode}
      data={data}
      isLoading={isLoading}
      isError={isError}
    />
  );
}

function ConnectedVehicleCard(
  { vehicleId, ...props }:
    & { vehicleId: string }
    & Omit<VehicleCardProps, "commandsDisabled" | "commandsDisabledReason">,
) {
  const utils = trpc.useUtils();
  const { data: cmdStatus } = trpc.vehicle.commandStatus.useQuery(
    { vehicleId },
    { refetchInterval: 30_000 },
  );
  const setChargeLimitMutation = trpc.vehicle.setChargeLimit.useMutation();
  const forecastEligible = props.state.isPluggedIn && props.atHome === true &&
    (props.mode === "vacation" || props.mode === "auto");
  const forecast = trpc.forecast.today.useQuery(
    { vehicleId },
    {
      enabled: forecastEligible,
      refetchInterval: 15 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  );
  const forecastContent = renderSolarForecast(
    forecastEligible,
    props.mode,
    forecast.data,
    forecast.isLoading,
    forecast.isError,
  );

  const setChargeLimit = async (percent: number) => {
    const result = await setChargeLimitMutation.mutateAsync({
      vehicleId,
      percent,
    });
    if (!result.success) {
      throw new Error(result.error ?? "Unable to change charge limit");
    }
    if (result.state) {
      utils.vehicle.list.setData(undefined, (old) => {
        if (!old) return old;
        return {
          vehicles: old.vehicles.map((vehicle) =>
            vehicle.id === vehicleId
              ? { ...vehicle, state: result.state ?? vehicle.state }
              : vehicle
          ),
        };
      });
    }
  };

  return (
    <VehicleCard
      {...props}
      commandsDisabled={cmdStatus?.commandsDisabled ?? false}
      commandsDisabledReason={cmdStatus?.reason ?? undefined}
      forecastContent={forecastContent}
      onSetChargeLimit={setChargeLimit}
    />
  );
}

interface VehicleListProps {
  onNavigateSettings?: () => void;
}

function WakingSpinner() {
  return <span className={styles.wakingSpinner} aria-hidden="true" />;
}

function AsleepVehicleCard({
  vehicle,
  isWaking,
  onWake,
  scheduledCharge,
}: {
  vehicle: VehicleItem;
  isWaking: boolean;
  onWake: () => void;
  scheduledCharge: ScheduledChargeDisplay | null;
}) {
  const mode = vehicle.mode as VehicleMode;
  return (
    <Card className={styles.asleepCard} data-status="disconnected">
      <div className={styles.asleepMain}>
        <span className={styles.asleepIcon} aria-hidden="true">
          <VehicleSilhouetteIcon size={46} />
        </span>
        <div className={styles.asleepCopy}>
          <Text size="4" weight="bold">{vehicle.name || "Vehicle"}</Text>
          <Text size="2" weight="bold" className={styles.asleepStatus}>
            Disconnected
          </Text>
          <Text size="1" color="gray">Vehicle is asleep or unreachable</Text>
        </div>
        <span className={styles.compactMode}>{VEHICLE_MODE_LABELS[mode]}</span>
      </div>
      {scheduledCharge && (
        <div className={styles.compactSchedule}>
          <CalendarClock size={15} aria-hidden="true" />
          <span>{scheduledCharge.title}</span>
        </div>
      )}
      <Button
        variant="soft"
        size="2"
        className={styles.wakeButton}
        disabled={isWaking}
        onClick={onWake}
      >
        {isWaking ? <WakingSpinner /> : <Zap size={15} />}
        {isWaking ? "Waking…" : "Wake"}
      </Button>
    </Card>
  );
}

interface SecondaryPresentation {
  statusKind: ChargeStatusKind;
  statusHeadline: string;
  statusDetail: string;
  batteryPercent: number | null;
}

function getSecondaryPresentation({
  state,
  mode,
  atHome,
  controllerReason,
  vehicleError,
  commandsDisabled,
  scheduledCharge,
}: {
  state: VehicleItem["state"];
  mode: VehicleMode;
  atHome: boolean | null;
  controllerReason: string | null;
  vehicleError?: string;
  commandsDisabled: boolean;
  scheduledCharge: ScheduledChargeDisplay | null;
}): SecondaryPresentation {
  if (!state) {
    return {
      statusKind: "disconnected",
      statusHeadline: "Disconnected",
      statusDetail: scheduledCharge?.title ??
        "Vehicle is asleep or unreachable",
      batteryPercent: null,
    };
  }

  const statusKind = getChargeStatusKind({
    state,
    mode,
    controllerReason,
    vehicleError,
    commandsDisabled,
  });
  const statusDetail = scheduledCharge?.title ??
    getStatusDetail(state, mode, atHome, controllerReason);
  return {
    statusKind,
    statusHeadline: getStatusHeadline(statusKind, state, mode),
    statusDetail,
    batteryPercent: Math.round(state.batteryLevel),
  };
}

function SecondaryVehicleCard({
  vehicle,
  scheduledCharge,
  home,
  controllerReason,
  vehicleError,
  onSelect,
}: {
  vehicle: VehicleItem;
  scheduledCharge: ScheduledChargeDisplay | null;
  home: HomePoint;
  controllerReason: string | null;
  vehicleError?: string;
  onSelect: () => void;
}) {
  const state = vehicle.state;
  const mode = vehicle.mode as VehicleMode;
  const name = vehicle.name || state?.vehicleName || "Vehicle";
  const atHome = vehicle.lastLocation
    ? isHome(home, vehicle.lastLocation)
    : null;
  const { data: cmdStatus } = trpc.vehicle.commandStatus.useQuery(
    { vehicleId: vehicle.id },
    { enabled: state !== null, refetchInterval: 30_000 },
  );
  const presentation = getSecondaryPresentation({
    state,
    mode,
    atHome,
    controllerReason,
    vehicleError,
    commandsDisabled: cmdStatus?.commandsDisabled ?? false,
    scheduledCharge,
  });

  return (
    <button
      type="button"
      className={styles.secondaryVehicle}
      onClick={onSelect}
      aria-label={`Show ${name} as the main vehicle`}
      data-status={presentation.statusKind}
      data-testid="secondary-vehicle-card"
    >
      <span className={styles.secondaryVehicleIcon} aria-hidden="true">
        <VehicleSilhouetteIcon size={46} />
      </span>
      <span className={styles.secondaryVehicleCopy}>
        <span className={styles.secondaryTopLine}>
          <strong>{name}</strong>
          <span className={styles.compactMode}>
            {VEHICLE_MODE_LABELS[mode]}
          </span>
        </span>
        <span className={styles.secondaryStatus}>
          {presentation.statusHeadline}
        </span>
        <span className={styles.secondaryDetail}>
          {presentation.statusDetail}
        </span>
      </span>
      <span className={styles.secondaryVehicleBattery}>
        <strong>
          {presentation.batteryPercent === null
            ? "—"
            : `${presentation.batteryPercent}%`}
        </strong>
        <span className={styles.compactBatteryTrack} aria-hidden="true">
          <span
            className={styles.compactBatteryFill}
            style={{ width: `${presentation.batteryPercent ?? 0}%` }}
          />
        </span>
      </span>
    </button>
  );
}

function VehicleListLoadingCard() {
  return (
    <Card className={styles.loadingCard}>
      <Skeleton width="100%" height="168px" />
    </Card>
  );
}

function VehicleListErrorCard({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <Card className={styles.messageCard} data-tone="error">
      <VehicleSilhouetteIcon size={38} aria-hidden="true" />
      <div className={styles.messageCopy}>
        <Text size="3" weight="bold">Unable to load vehicles</Text>
        <Text size="2" color="gray">{error}</Text>
      </div>
      <Button variant="soft" size="2" onClick={onRetry}>Retry</Button>
    </Card>
  );
}

function NoVehiclesCard({
  onNavigateSettings,
}: {
  onNavigateSettings?: () => void;
}) {
  return (
    <Card className={styles.messageCard}>
      <VehicleSilhouetteIcon size={38} aria-hidden="true" />
      <div className={styles.messageCopy}>
        <Text size="3" weight="bold">No vehicles configured</Text>
        <Text size="2" color="gray">
          Add a vehicle to monitor charging and control solar allocation.
        </Text>
      </div>
      <Button variant="soft" size="2" onClick={onNavigateSettings}>
        <Settings size={16} />
        Add Vehicle
      </Button>
    </Card>
  );
}

function useAllocationStatus(
  priorityChargingEnabled: boolean | undefined,
  vehicles: ReturnType<typeof useVehicles>["vehicles"],
  controllerStatuses: ReturnType<typeof useControllerStatuses>,
) {
  return useMemo(() => {
    if (!priorityChargingEnabled || vehicles.length < 2) return {};
    const sorted = [...vehicles].sort((a, b) => a.priority - b.priority);
    const topCharging = sorted.find((v) =>
      v.state?.isCharging &&
      controllerStatuses[v.id]?.reason === "solar_tracking"
    );
    return Object.fromEntries(
      sorted
        .map((v): [string, string] | null => {
          const isSolarCharging = v.state?.isCharging &&
            controllerStatuses[v.id]?.reason === "solar_tracking";
          if (isSolarCharging && v === topCharging) {
            return [v.id, "Priority: receiving all solar"];
          }
          if (!v.state?.isCharging && topCharging) {
            return [v.id, "Waiting for priority vehicle"];
          }
          return null;
        })
        .filter((entry): entry is [string, string] => entry !== null),
    );
  }, [priorityChargingEnabled, vehicles, controllerStatuses]);
}

interface PrimaryVehicleCardProps {
  vehicle: VehicleItem;
  schedules: Schedule[];
  now: Date;
  timezone: string;
  home: HomePoint;
  vehiclesLoading: boolean;
  commandPending: Record<string, string | false>;
  vehicleErrors: Record<string, string | undefined>;
  vehicleSolarGrid: Record<
    string,
    { solarW: number; batteryW: number; gridW: number }
  >;
  allocationStatus: Record<string, string>;
  controllerStatuses: ReturnType<typeof useControllerStatuses>;
  wakeMutation: ReturnType<typeof trpc.vehicle.command.useMutation>;
  refreshMutation: ReturnType<typeof trpc.vehicle.refreshState.useMutation>;
  startCharging: (id: string) => void;
  stopCharging: (id: string) => void;
  setAmps: (id: string, amps: number) => void;
  changeMode: (id: string, mode: VehicleMode) => void;
  onNavigateSettings?: () => void;
}

function PrimaryVehicleCard({
  vehicle,
  schedules,
  now,
  timezone,
  home,
  vehiclesLoading,
  commandPending,
  vehicleErrors,
  vehicleSolarGrid,
  allocationStatus,
  controllerStatuses,
  wakeMutation,
  refreshMutation,
  startCharging,
  stopCharging,
  setAmps,
  changeMode,
  onNavigateSettings,
}: PrimaryVehicleCardProps) {
  const scheduledCharge = getScheduledChargeDisplay(
    schedules,
    vehicle.id,
    vehicle.mode as VehicleMode,
    now,
    timezone,
  );

  if (!vehicle.state) {
    return (
      <AsleepVehicleCard
        key={vehicle.id}
        vehicle={vehicle}
        isWaking={wakeMutation.isPending &&
          wakeMutation.variables?.vehicleId === vehicle.id}
        scheduledCharge={scheduledCharge}
        onWake={() =>
          wakeMutation.mutate({
            vehicleId: vehicle.id,
            command: "wake",
          })}
      />
    );
  }

  return (
    <ConnectedVehicleCard
      key={vehicle.id}
      vehicleId={vehicle.id}
      name={vehicle.name || vehicle.state.vehicleName}
      state={vehicle.state}
      priority={vehicle.priority}
      mode={vehicle.mode as VehicleMode}
      commandPending={commandPending[vehicle.id] ?? false}
      onStartCharging={() => startCharging(vehicle.id)}
      onStopCharging={() => stopCharging(vehicle.id)}
      onSetAmps={(amps) => setAmps(vehicle.id, amps)}
      onChangeMode={(mode) => changeMode(vehicle.id, mode)}
      solarPowerW={vehicleSolarGrid[vehicle.id]?.solarW ?? 0}
      batteryPowerW={vehicleSolarGrid[vehicle.id]?.batteryW ?? 0}
      gridPowerW={vehicleSolarGrid[vehicle.id]?.gridW ?? 0}
      loading={vehiclesLoading}
      atHome={vehicle.lastLocation ? isHome(home, vehicle.lastLocation) : null}
      vehicleError={vehicleErrors[vehicle.id]}
      allocationStatus={allocationStatus[vehicle.id] ?? null}
      pollingSuspended={vehicle.pollingSuspended}
      pollingSuspendReason={vehicle.pollingSuspendReason}
      controllerReason={controllerStatuses[vehicle.id]?.reason ?? null}
      controllerDetail={controllerStatuses[vehicle.id]?.detail ?? null}
      scheduledCharge={scheduledCharge}
      onNavigateSettings={onNavigateSettings}
      onRefresh={() => refreshMutation.mutateAsync({ vehicleId: vehicle.id })}
    />
  );
}

function VehicleCards({
  vehicles,
  schedules,
  timezone,
  home,
  vehiclesLoading,
  commandPending,
  vehicleErrors,
  vehicleSolarGrid,
  allocationStatus,
  controllerStatuses,
  wakeMutation,
  refreshMutation,
  startCharging,
  stopCharging,
  setAmps,
  changeMode,
  onNavigateSettings,
  selectedVehicleId,
  onSelectVehicle,
}: {
  vehicles: ReturnType<typeof useVehicles>["vehicles"];
  schedules: Schedule[];
  timezone: string;
  home: HomePoint;
  vehiclesLoading: boolean;
  commandPending: Record<string, string | false>;
  vehicleErrors: Record<string, string | undefined>;
  vehicleSolarGrid: Record<
    string,
    { solarW: number; batteryW: number; gridW: number }
  >;
  allocationStatus: Record<string, string>;
  controllerStatuses: ReturnType<typeof useControllerStatuses>;
  wakeMutation: ReturnType<typeof trpc.vehicle.command.useMutation>;
  refreshMutation: ReturnType<typeof trpc.vehicle.refreshState.useMutation>;
  startCharging: (id: string) => void;
  stopCharging: (id: string) => void;
  setAmps: (id: string, amps: number) => void;
  changeMode: (id: string, mode: VehicleMode) => void;
  onNavigateSettings?: () => void;
  selectedVehicleId: string | null;
  onSelectVehicle: (id: string) => void;
}) {
  const now = new Date();
  const primaryId = selectedVehicleId ?? vehicles[0]?.id ?? null;
  const primaryVehicle = vehicles.find((vehicle) => vehicle.id === primaryId) ??
    vehicles[0];
  const secondaryVehicles = vehicles.filter((vehicle) =>
    vehicle.id !== primaryVehicle?.id
  );

  if (!primaryVehicle) return null;

  return (
    <div className={styles.vehicleCards}>
      <PrimaryVehicleCard
        vehicle={primaryVehicle}
        schedules={schedules}
        now={now}
        timezone={timezone}
        home={home}
        vehiclesLoading={vehiclesLoading}
        commandPending={commandPending}
        vehicleErrors={vehicleErrors}
        vehicleSolarGrid={vehicleSolarGrid}
        allocationStatus={allocationStatus}
        controllerStatuses={controllerStatuses}
        wakeMutation={wakeMutation}
        refreshMutation={refreshMutation}
        startCharging={startCharging}
        stopCharging={stopCharging}
        setAmps={setAmps}
        changeMode={changeMode}
        onNavigateSettings={onNavigateSettings}
      />

      {secondaryVehicles.length > 0 && (
        <div className={styles.secondaryVehicles}>
          {secondaryVehicles.map((vehicle) => (
            <SecondaryVehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              scheduledCharge={getScheduledChargeDisplay(
                schedules,
                vehicle.id,
                vehicle.mode as VehicleMode,
                now,
                timezone,
              )}
              home={home}
              controllerReason={controllerStatuses[vehicle.id]?.reason ?? null}
              vehicleError={vehicleErrors[vehicle.id]}
              onSelect={() => onSelectVehicle(vehicle.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function VehicleList({ onNavigateSettings }: VehicleListProps) {
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    null,
  );
  const { addToast } = useToast();
  const { data: chargingConfig } = useChargingConfig();
  const { data: homeConfig } = useHomeConfig();
  const { data: systemConfig } = useSystemConfig();
  const { data: scheduleData } = trpc.schedule.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const homeLat = homeConfig?.homeLatitude;
  const homeLng = homeConfig?.homeLongitude;
  const home = homeLat != null && homeLng != null
    ? { lat: homeLat, lng: homeLng }
    : null;
  const timezone = systemConfig?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data: energyData } = useEnergyData();
  const realtime = energyData?.realtime ?? null;
  const {
    vehicles,
    loading: vehiclesLoading,
    error: vehiclesError,
    commandPending,
    vehicleErrors,
    startCharging,
    stopCharging,
    setAmps,
    changeMode,
    refreshVehicles,
  } = useVehicles();

  const wakeMutation = trpc.vehicle.command.useMutation({
    onError: (err) => {
      addToast(err.message || "Failed to wake vehicle", "error");
    },
  });

  const refreshMutation = trpc.vehicle.refreshState.useMutation({
    onError: (err) => {
      addToast(err.message || "Failed to refresh vehicle state", "error");
    },
  });

  const vehicleSolarGrid = useVehicleSolarGrid(realtime, vehicles);
  const controllerStatuses = useControllerStatuses();
  const allocationStatus = useAllocationStatus(
    chargingConfig?.priorityChargingEnabled,
    vehicles,
    controllerStatuses,
  );
  const orderedVehicles = useMemo(
    () => [...vehicles].sort((a, b) => a.priority - b.priority),
    [vehicles],
  );
  const activeVehicleId =
    orderedVehicles.some((vehicle) => vehicle.id === selectedVehicleId)
      ? selectedVehicleId
      : orderedVehicles[0]?.id ?? null;

  if (vehiclesLoading && vehicles.length === 0) {
    return <VehicleListLoadingCard />;
  }

  return (
    <div className={styles.list}>
      <VehicleCards
        vehicles={orderedVehicles}
        schedules={scheduleData?.schedules ?? []}
        timezone={timezone}
        home={home}
        vehiclesLoading={vehiclesLoading}
        commandPending={commandPending}
        vehicleErrors={vehicleErrors}
        vehicleSolarGrid={vehicleSolarGrid}
        allocationStatus={allocationStatus}
        controllerStatuses={controllerStatuses}
        wakeMutation={wakeMutation}
        refreshMutation={refreshMutation}
        startCharging={startCharging}
        stopCharging={stopCharging}
        setAmps={setAmps}
        changeMode={changeMode}
        onNavigateSettings={onNavigateSettings}
        selectedVehicleId={activeVehicleId}
        onSelectVehicle={setSelectedVehicleId}
      />

      {!vehiclesLoading && vehicles.length === 0 && vehiclesError && (
        <VehicleListErrorCard error={vehiclesError} onRetry={refreshVehicles} />
      )}

      {!vehiclesLoading && vehicles.length === 0 && !vehiclesError && (
        <NoVehiclesCard onNavigateSettings={onNavigateSettings} />
      )}
    </div>
  );
}
