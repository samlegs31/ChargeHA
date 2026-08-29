import { type ComponentProps, type ReactNode, useMemo, useState } from "react";
import { CalendarClock, ChevronRight, Settings, Zap } from "lucide-react";
import { Button, Card, Text } from "@radix-ui/themes";
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
import { trpc } from "../../../trpc.ts";
import { useVehicleSolarGrid } from "./energyHelpers.ts";
import {
  getScheduledChargeDisplay,
  type ScheduledChargeDisplay,
} from "./scheduledCharge.ts";
import styles from "./VehicleList.module.css";

type VehicleCardProps = ComponentProps<typeof VehicleCard>;

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

/** Wraps VehicleCard with per-vehicle command status and charge-limit control. */
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
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "spin 0.6s linear infinite",
        verticalAlign: "middle",
      }}
    />
  );
}

function AsleepVehicleCard(
  { v, isWaking, onWake, scheduledCharge }: {
    v: { id: string; name: string };
    isWaking: boolean;
    onWake: () => void;
    scheduledCharge: ScheduledChargeDisplay | null;
  },
) {
  const wakeIcon = isWaking ? <WakingSpinner /> : <Zap size={14} />;
  return (
    <Card key={v.id} style={{ borderLeft: "3px solid var(--gray-a6)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <VehicleSilhouetteIcon
          size={30}
          style={{ color: "var(--gray-9)" }}
          aria-hidden="true"
        />
        <div style={{ flex: 1 }}>
          <Text size="2" weight="bold">{v.name}</Text>
          <Text size="1" color="gray" style={{ display: "block" }}>
            Vehicle is asleep or unreachable
          </Text>
          {scheduledCharge && (
            <Text
              size="2"
              color="blue"
              weight="medium"
              style={{ display: "flex", alignItems: "center", gap: 5 }}
            >
              <CalendarClock size={15} aria-hidden="true" />
              {scheduledCharge.title} · {scheduledCharge.detail}
            </Text>
          )}
        </div>
        <Button variant="soft" size="1" disabled={isWaking} onClick={onWake}>
          {wakeIcon}
          {isWaking ? "Waking..." : "Wake"}
        </Button>
      </div>
    </Card>
  );
}

function SecondaryVehicleCard(
  {
    vehicle,
    scheduledCharge,
    onSelect,
  }: {
    vehicle: ReturnType<typeof useVehicles>["vehicles"][number];
    scheduledCharge: ScheduledChargeDisplay | null;
    onSelect: () => void;
  },
) {
  const state = vehicle.state;
  const name = vehicle.name || state?.vehicleName || "Vehicle";
  const status = getSecondaryVehicleStatus(state);

  return (
    <button
      type="button"
      className={styles.secondaryVehicle}
      onClick={onSelect}
      aria-label={`Show ${name} as the main vehicle`}
      data-testid="secondary-vehicle-card"
    >
      <span className={styles.secondaryVehicleIcon} aria-hidden="true">
        <VehicleSilhouetteIcon size={40} />
      </span>
      <span className={styles.secondaryVehicleCopy}>
        <strong>{name}</strong>
        <span>{scheduledCharge?.title ?? status}</span>
      </span>
      <span className={styles.secondaryVehicleBattery}>
        <strong>{state ? `${Math.round(state.batteryLevel)}%` : "—"}</strong>
        <span>{state?.isPluggedIn ? "PLUGGED IN" : "VEHICLE"}</span>
      </span>
      <ChevronRight size={22} className={styles.secondaryVehicleChevron} />
    </button>
  );
}

function getSecondaryVehicleStatus(
  state: ReturnType<typeof useVehicles>["vehicles"][number]["state"],
): string {
  if (state === null) return "Asleep or unreachable";
  if (state.isCharging) {
    return `Charging · ${state.chargePowerKw.toFixed(1)} kW`;
  }
  if (state.isPluggedIn) return "Plugged in · ready";
  return "Unplugged";
}

function VehicleListErrorCard(
  { error, onRetry }: { error: string; onRetry: () => void },
) {
  return (
    <Card style={{ borderLeft: "3px solid var(--red-a7)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <VehicleSilhouetteIcon
          size={34}
          style={{ color: "var(--red-9)" }}
          aria-hidden="true"
        />
        <div style={{ flex: 1 }}>
          <Text size="3" weight="bold" style={{ display: "block" }}>
            Unable to load vehicles
          </Text>
          <Text size="2" color="gray">{error}</Text>
        </div>
        <Button variant="soft" size="2" onClick={onRetry}>Retry</Button>
      </div>
    </Card>
  );
}

function NoVehiclesCard(
  { onNavigateSettings }: { onNavigateSettings?: () => void },
) {
  return (
    <Card style={{ borderLeft: "3px solid var(--color-vehicle)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <VehicleSilhouetteIcon
          size={34}
          style={{ color: "var(--color-vehicle)" }}
          aria-hidden="true"
        />
        <div style={{ flex: 1 }}>
          <Text size="3" weight="bold" style={{ display: "block" }}>
            No vehicles configured
          </Text>
          <Text size="2" color="gray">
            Add a vehicle to monitor charging and control solar allocation.
          </Text>
        </div>
        <Button variant="soft" size="2" onClick={onNavigateSettings}>
          <Settings size={16} />
          Add Vehicle
        </Button>
      </div>
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

function VehicleCards(
  {
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
    home: { lat: number; lng: number } | null;
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
  },
) {
  const now = new Date();
  const primaryId = selectedVehicleId ?? vehicles[0]?.id ?? null;
  const primaryVehicle = vehicles.find((vehicle) => vehicle.id === primaryId) ??
    vehicles[0];
  const secondaryVehicles = vehicles.filter((vehicle) =>
    vehicle.id !== primaryVehicle?.id
  );

  if (!primaryVehicle) return null;

  const scheduledCharge = getScheduledChargeDisplay(
    schedules,
    primaryVehicle.id,
    primaryVehicle.mode as VehicleMode,
    now,
    timezone,
  );

  return (
    <>
      {primaryVehicle.state && (
        <ConnectedVehicleCard
          key={primaryVehicle.id}
          vehicleId={primaryVehicle.id}
          name={primaryVehicle.name || primaryVehicle.state.vehicleName}
          state={primaryVehicle.state}
          priority={primaryVehicle.priority}
          mode={primaryVehicle.mode as VehicleMode}
          commandPending={commandPending[primaryVehicle.id] ?? false}
          onStartCharging={() => startCharging(primaryVehicle.id)}
          onStopCharging={() => stopCharging(primaryVehicle.id)}
          onSetAmps={(amps) => setAmps(primaryVehicle.id, amps)}
          onChangeMode={(mode) => changeMode(primaryVehicle.id, mode)}
          solarPowerW={vehicleSolarGrid[primaryVehicle.id]?.solarW ?? 0}
          batteryPowerW={vehicleSolarGrid[primaryVehicle.id]?.batteryW ?? 0}
          gridPowerW={vehicleSolarGrid[primaryVehicle.id]?.gridW ?? 0}
          loading={vehiclesLoading}
          atHome={primaryVehicle.lastLocation
            ? isHome(home, primaryVehicle.lastLocation)
            : null}
          vehicleError={vehicleErrors[primaryVehicle.id]}
          allocationStatus={allocationStatus[primaryVehicle.id] ?? null}
          pollingSuspended={primaryVehicle.pollingSuspended}
          pollingSuspendReason={primaryVehicle.pollingSuspendReason}
          controllerReason={controllerStatuses[primaryVehicle.id]?.reason ??
            null}
          controllerDetail={controllerStatuses[primaryVehicle.id]?.detail ??
            null}
          scheduledCharge={scheduledCharge}
          onNavigateSettings={onNavigateSettings}
          onRefresh={() =>
            refreshMutation.mutateAsync({ vehicleId: primaryVehicle.id })}
        />
      )}

      {!primaryVehicle.state && (
        <AsleepVehicleCard
          key={primaryVehicle.id}
          v={primaryVehicle}
          isWaking={wakeMutation.isPending &&
            wakeMutation.variables?.vehicleId === primaryVehicle.id}
          scheduledCharge={scheduledCharge}
          onWake={() =>
            wakeMutation.mutate({
              vehicleId: primaryVehicle.id,
              command: "wake",
            })}
        />
      )}

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
              onSelect={() => onSelectVehicle(vehicle.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function VehicleList(
  { onNavigateSettings }: VehicleListProps,
) {
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Vehicle section — one card per configured vehicle */}
      <Text
        size="2"
        color="gray"
        weight="medium"
        style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
      >
        Vehicles
      </Text>
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
        <VehicleListErrorCard
          error={vehiclesError}
          onRetry={refreshVehicles}
        />
      )}

      {!vehiclesLoading && vehicles.length === 0 && !vehiclesError && (
        <NoVehiclesCard onNavigateSettings={onNavigateSettings} />
      )}
    </div>
  );
}
