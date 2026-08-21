import { Home, Sun, Zap } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { EnergyData } from "@chargeha/shared";
import { kwValue } from "../../utils/Format.ts";
import { VehicleSilhouetteIcon } from "../icons/VehicleSilhouetteIcon.tsx";
import styles from "./EnergyFlowDiagram.module.css";

export interface ChargingVehicleFlow {
  id: string;
  name: string;
  chargePowerW: number;
  solarW: number;
  batteryW?: number;
  gridW: number;
}

interface EnergyFlowDiagramProps {
  data: EnergyData | null;
  loading?: boolean;
  chargingVehicles?: ChargingVehicleFlow[];
}

type FlowSource = "solar" | "battery" | "grid" | "idle";
type FlowDirection = "up" | "down";
type FlowRole = "source" | "destination" | "idle";
type Producer = "solar" | "battery" | "grid";
type Consumer = "home" | "battery" | "grid" | `vehicle:${string}`;

interface EnergyTransfer {
  source: Producer;
  destination: Consumer;
  powerW: number;
}

interface FlowStream {
  source: Producer;
  powerW: number;
}

interface AllocationState {
  available: Record<Producer, number>;
  transfers: EnergyTransfer[];
}

interface BusRoute {
  id: string;
  color: string;
  startPct: number;
  endPct: number;
  powerW: number;
  limitW: number;
}

const ACTIVE_FLOW_W = 25;
const INVERTER_LIMIT_W = 6_000;
const GRID_LIMIT_W = 12_000;

function flowDurationS(powerW: number): number {
  const kw = Math.abs(powerW) / 1000;
  return Math.min(2.8, Math.max(1.1, 2.9 - kw * 0.18));
}

function flowBeadSizePx(powerW: number, limitW: number): number {
  const ratio = Math.min(1, Math.abs(powerW) / limitW);
  return Math.round((7 + ratio * 6) * 10) / 10;
}

function flowProgressDeg(powerW: number, limitW: number): number {
  return Math.round(Math.min(1, Math.abs(powerW) / limitW) * 360);
}

function sourceColor(source: FlowSource): string {
  switch (source) {
    case "solar":
      return "var(--color-solar)";
    case "battery":
      return "var(--color-battery)";
    case "grid":
      return "var(--color-grid-import)";
    default:
      return "var(--gray-7)";
  }
}

function dominantSupply(
  solarW: number,
  batteryW: number,
  gridW: number,
): { source: FlowSource; powerW: number } {
  const candidates: Array<{ source: Exclude<FlowSource, "idle">; powerW: number }> = [
    { source: "solar", powerW: Math.max(0, solarW) },
    { source: "battery", powerW: Math.max(0, batteryW) },
    { source: "grid", powerW: Math.max(0, gridW) },
  ];
  const dominant = candidates.reduce((largest, candidate) =>
    candidate.powerW > largest.powerW ? candidate : largest
  );
  return dominant.powerW >= ACTIVE_FLOW_W
    ? dominant
    : { source: "idle", powerW: 0 };
}

function EnergyBus({ source, routes }: {
  source: FlowSource;
  routes: BusRoute[];
}) {
  return (
    <div
      className={styles.energyBus}
      data-testid="energy-bus"
      data-source={source}
      data-route-count={routes.length}
      aria-hidden="true"
    >
      <span className={styles.energyBusTrack} data-testid="energy-bus-track" />
      {routes.map((route) => {
        const forward = route.endPct > route.startPct;
        const leftPct = Math.min(route.startPct, route.endPct);
        const widthPct = Math.abs(route.endPct - route.startPct);
        const durationS = Math.max(1.45, flowDurationS(route.powerW));
        return (
        <span
          key={route.id}
          className={styles.energyBusStream}
          data-testid={`energy-bus-${route.id}`}
          data-motion={forward ? "forward" : "reverse"}
          data-bead-count="1"
          style={{
            "--route-color": route.color,
            "--route-left": `${leftPct}%`,
            "--route-width": `${widthPct}%`,
            "--bus-duration": `${durationS}s`,
            "--bus-bead-size": `${
              flowBeadSizePx(route.powerW, route.limitW)
            }px`,
          } as CSSProperties}
        >
          <span className={styles.energyBead} />
        </span>
        );
      })}
    </div>
  );
}

function allocateTo(
  state: AllocationState,
  destination: Consumer,
  demandW: number,
  sourceOrder: Producer[],
): AllocationState {
  return sourceOrder.reduce(
    (current, source) => {
      const alreadyAllocatedW = current.transfers
        .filter((transfer) => transfer.destination === destination)
        .reduce((total, transfer) => total + transfer.powerW, 0);
      const remainingW = Math.max(0, demandW - alreadyAllocatedW);
      const powerW = Math.min(remainingW, current.available[source]);
      if (powerW < ACTIVE_FLOW_W) return current;
      return {
        available: {
          ...current.available,
          [source]: Math.max(0, current.available[source] - powerW),
        },
        transfers: [
          ...current.transfers,
          { source, destination, powerW },
        ],
      };
    },
    state,
  );
}

function addVehicleTransfers(
  state: AllocationState,
  vehicle: ChargingVehicleFlow,
): AllocationState {
  const destination: Consumer = `vehicle:${vehicle.id}`;
  const known = [
    { source: "solar" as const, powerW: Math.max(0, vehicle.solarW) },
    { source: "battery" as const, powerW: Math.max(0, vehicle.batteryW ?? 0) },
    { source: "grid" as const, powerW: Math.max(0, vehicle.gridW) },
  ];
  const withKnown = known.reduce(
    (current, contribution) => {
      if (contribution.powerW < ACTIVE_FLOW_W) return current;
      return {
        available: {
          ...current.available,
          [contribution.source]: Math.max(
            0,
            current.available[contribution.source] - contribution.powerW,
          ),
        },
        transfers: [
          ...current.transfers,
          {
            source: contribution.source,
            destination,
            powerW: contribution.powerW,
          },
        ],
      };
    },
    state,
  );
  return allocateTo(
    withKnown,
    destination,
    vehicle.chargePowerW,
    ["solar", "battery", "grid"],
  );
}

function energyTransfers({
  solarW,
  batteryW,
  gridW,
  homeW,
  vehicles,
}: {
  solarW: number;
  batteryW: number;
  gridW: number;
  homeW: number;
  vehicles: ChargingVehicleFlow[];
}): EnergyTransfer[] {
  const initial: AllocationState = {
    available: {
      solar: Math.max(0, solarW),
      battery: Math.max(0, batteryW),
      grid: Math.max(0, gridW),
    },
    transfers: [],
  };
  const afterVehicles = vehicles.reduce(addVehicleTransfers, initial);
  const afterHome = allocateTo(
    afterVehicles,
    "home",
    homeW,
    ["solar", "battery", "grid"],
  );
  const afterBattery = allocateTo(
    afterHome,
    "battery",
    Math.max(0, -batteryW),
    ["solar", "grid"],
  );
  const afterExport = allocateTo(
    afterBattery,
    "grid",
    Math.max(0, -gridW),
    ["solar", "battery"],
  );
  return afterExport.transfers;
}

function transferPower(
  transfers: EnergyTransfer[],
  predicate: (transfer: EnergyTransfer) => boolean,
): number {
  return transfers
    .filter(predicate)
    .reduce((total, transfer) => total + transfer.powerW, 0);
}

function transferStreams(
  transfers: EnergyTransfer[],
  predicate: (transfer: EnergyTransfer) => boolean,
): FlowStream[] {
  return transfers.filter(predicate).reduce<FlowStream[]>(
    (streams, transfer) => {
      const matching = streams.find((stream) =>
        stream.source === transfer.source
      );
      if (!matching) {
        return [...streams, { source: transfer.source, powerW: transfer.powerW }];
      }
      return streams.map((stream) =>
        stream === matching
          ? { ...stream, powerW: stream.powerW + transfer.powerW }
          : stream
      );
    },
    [],
  );
}

function dominantStream(streams: FlowStream[]): FlowStream | null {
  return streams.reduce<FlowStream | null>(
    (largest, stream) =>
      !largest || stream.powerW > largest.powerW ? stream : largest,
    null,
  );
}

function busRoutes(
  hasBattery: boolean,
  transfers: EnergyTransfer[],
  vehicles: ChargingVehicleFlow[],
): BusRoute[] {
  const positions = hasBattery
    ? { solar: 12.5, battery: 37.5, home: 62.5, grid: 87.5 }
    : { solar: 16.67, battery: 50, home: 50, grid: 83.33 };
  const vehiclePositions = new Map(
    vehicles.map((vehicle, index) => [
      `vehicle:${vehicle.id}` as Consumer,
      vehicles.length === 1
        ? 50
        : 50 + (index - (vehicles.length - 1) / 2) * 25,
    ]),
  );
  const destinationPosition = (destination: Consumer): number => {
    if (destination.startsWith("vehicle:")) {
      return vehiclePositions.get(destination) ?? 50;
    }
    if (destination === "battery") return positions.battery;
    if (destination === "grid") return positions.grid;
    return positions.home;
  };
  const groupedTransfers = transfers.reduce<EnergyTransfer[]>(
    (groups, transfer) => {
      const matching = groups.find((group) =>
        group.source === transfer.source &&
        group.destination === transfer.destination
      );
      if (!matching) return [...groups, transfer];
      return groups.map((group) =>
        group === matching
          ? { ...group, powerW: group.powerW + transfer.powerW }
          : group
      );
    },
    [],
  );
  return groupedTransfers.map((transfer) => {
    const startPct = positions[transfer.source];
    const endPct = destinationPosition(transfer.destination);
    const destinationId = transfer.destination.replace(":", "-");
    return {
      id: `${transfer.source}-to-${destinationId}`,
      color: sourceColor(transfer.source),
      startPct,
      endPct,
      powerW: transfer.powerW,
      limitW: transfer.source === "grid"
        ? GRID_LIMIT_W
        : INVERTER_LIMIT_W,
    };
  }).filter((route) => route.startPct !== route.endPct);
}

function FlowBranch({
  testId,
  direction,
  role,
  limitW,
  streams,
}: {
  testId: string;
  direction: FlowDirection;
  role: FlowRole;
  limitW: number;
  streams: FlowStream[];
}) {
  const activeStreams = streams.filter((stream) =>
    stream.powerW >= ACTIVE_FLOW_W
  );
  const dominant = dominantStream(activeStreams);
  const active = activeStreams.length > 0;
  return (
    <div
      className={`${styles.flowBranch} ${
        active ? styles.flowActive : styles.flowIdle
      }`}
      data-testid={testId}
      data-direction={direction}
      data-role={role}
      data-active={active}
      data-bead-count={activeStreams.length}
      data-sources={activeStreams.map((stream) => stream.source).join(" ")}
      style={{
        "--branch-color": dominant
          ? sourceColor(dominant.source)
          : "var(--gray-7)",
      } as CSSProperties}
      aria-hidden="true"
    >
      <span className={styles.flowTrack} />
      {activeStreams.map((stream, streamIndex) => {
        const durationS = flowDurationS(stream.powerW);
        return (
        <span
          key={stream.source}
          className={styles.branchBead}
          data-source={stream.source}
          style={{
            "--bead-color": sourceColor(stream.source),
            "--branch-duration": `${durationS}s`,
            "--branch-delay": `${-streamIndex * durationS / activeStreams.length}s`,
            "--branch-bead-size": `${
              flowBeadSizePx(stream.powerW, limitW)
            }px`,
            "--branch-lane": `${
              (streamIndex - (activeStreams.length - 1) / 2) * 5
            }px`,
          } as CSSProperties}
        />
        );
      })}
    </div>
  );
}

function FlowNode({
  testId,
  icon,
  label,
  value,
  tone,
  role,
  active,
  powerW,
  limitW,
  children,
}: {
  testId: string;
  icon: ReactNode;
  label: string;
  value: string;
  tone: "solar" | "battery" | "home" | "grid-import" | "grid-export";
  role: FlowRole;
  active: boolean;
  powerW: number;
  limitW: number;
  children?: ReactNode;
}) {
  return (
    <div
      className={`${styles.node} ${active ? styles.active : styles.idle}`}
      data-testid={testId}
      data-tone={tone}
      data-role={role}
      style={{
        "--node-progress": `${flowProgressDeg(powerW, limitW)}deg`,
      } as CSSProperties}
    >
      <div className={styles.iconBadge} aria-hidden="true">{icon}</div>
      <div className={styles.nodeLabel}>{label}</div>
      <div className={styles.nodeValue}>{value}</div>
      {children}
    </div>
  );
}

function VehicleNode({ vehicle, loading, streams }: {
  vehicle: ChargingVehicleFlow;
  loading: boolean;
  streams: FlowStream[];
}) {
  const active = vehicle.chargePowerW >= ACTIVE_FLOW_W;
  const totalW = Math.max(
    1,
    streams.reduce((total, stream) => total + stream.powerW, 0),
  );
  const sourcePower = (source: Producer): number =>
    streams.find((stream) => stream.source === source)?.powerW ?? 0;
  const solarStop = flowProgressDeg(sourcePower("solar"), totalW);
  const batteryStop = solarStop +
    flowProgressDeg(sourcePower("battery"), totalW);
  const gridStop = batteryStop + flowProgressDeg(sourcePower("grid"), totalW);
  const dominant = dominantStream(streams);
  const energyColor = dominant
    ? sourceColor(dominant.source)
    : "var(--gray-8)";
  return (
    <div className={styles.vehicleFlow}>
      <div
        className={`${styles.vehicleNode} ${active ? styles.active : styles.idle}`}
        data-testid={`vehicle-node-${vehicle.id}`}
        data-role={active ? "destination" : "idle"}
        data-sources={streams.map((stream) => stream.source).join(" ")}
        style={{ "--vehicle-energy-color": energyColor } as CSSProperties}
      >
        <div
          className={styles.vehicleIcon}
          aria-hidden="true"
          style={{
            "--vehicle-solar-stop": `${solarStop}deg`,
            "--vehicle-battery-stop": `${batteryStop}deg`,
            "--vehicle-grid-stop": `${gridStop}deg`,
          } as CSSProperties}
        >
          <VehicleSilhouetteIcon size={42} />
        </div>
        <div className={styles.vehicleText}>
          <div className={styles.vehicleName}>{vehicle.name}</div>
          <div className={styles.vehicleValue}>
            {loading ? "---" : kwValue(vehicle.chargePowerW)}
          </div>
        </div>
      </div>
      <FlowBranch
        testId={`flow-vehicle-${vehicle.id}`}
        direction="up"
        role={active ? "destination" : "idle"}
        limitW={GRID_LIMIT_W}
        streams={streams}
      />
    </div>
  );
}

function batteryLevelName(
  soc: number | null,
): "unknown" | "low" | "medium" | "high" {
  if (soc == null) return "unknown";
  if (soc < 25) return "low";
  if (soc < 75) return "medium";
  return "high";
}

function HomeBatteryIcon({
  soc,
  charging,
}: {
  soc: number | null;
  charging: boolean;
}) {
  const fill = soc == null ? 0 : Math.min(100, Math.max(0, Math.round(soc)));
  return (
    <span
      className={styles.batteryGlyph}
      data-testid="home-battery-icon"
      data-fill={fill}
      data-level={batteryLevelName(soc)}
      data-charging={charging}
      style={{ "--battery-fill": `${fill}%` } as CSSProperties}
    >
      <span className={styles.batteryGlyphFill} />
    </span>
  );
}

function readableList(items: string[]): string {
  if (items.length < 2) return items[0] ?? "home";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function flowSummary(
  loading: boolean,
  transfers: EnergyTransfer[],
): string {
  if (loading) return "Connecting to live energy";
  const producers: Producer[] = ["solar", "battery", "grid"];
  const dominant = producers.reduce(
    (largest, source) =>
      transferPower(
          transfers,
          (transfer) => transfer.source === source,
        ) > transferPower(
          transfers,
          (transfer) => transfer.source === largest,
        )
        ? source
        : largest,
    "solar",
  );
  const destinations = transfers
    .filter((transfer) => transfer.source === dominant)
    .map((transfer) =>
      transfer.destination.startsWith("vehicle:")
        ? "car"
        : transfer.destination
    );
  const uniqueDestinations = [...new Set(destinations)];
  if (uniqueDestinations.length === 0) return "Energy is balanced";
  const sourceLabels: Record<Producer, string> = {
    solar: "Solar",
    battery: "Battery",
    grid: "Grid",
  };
  return `${sourceLabels[dominant]} is flowing to ${
    readableList(uniqueDestinations)
  }`;
}

export function EnergyFlowDiagram({
  data,
  loading = false,
  chargingVehicles = [],
}: EnergyFlowDiagramProps) {
  const solarW = data?.solarProductionW ?? 0;
  const batteryW = data?.batteryPowerW ?? 0;
  const gridW = data?.gridPowerW ?? 0;
  const totalVehicleW = chargingVehicles.reduce(
    (total, vehicle) => total + vehicle.chargePowerW,
    0,
  );
  const homeW = Math.max(0, (data?.homeConsumptionW ?? 0) - totalVehicleW);
  const hasBattery = data?.batteryPowerW !== null &&
    data?.batteryPowerW !== undefined;
  const batteryCharging = batteryW < -ACTIVE_FLOW_W;
  const batteryDischarging = batteryW > ACTIVE_FLOW_W;
  const gridImporting = gridW > ACTIVE_FLOW_W;
  const gridExporting = gridW < -ACTIVE_FLOW_W;
  const dominant = dominantSupply(solarW, batteryW, gridW);
  const transfers = energyTransfers({
    solarW,
    batteryW,
    gridW,
    homeW,
    vehicles: chargingVehicles,
  });
  const routes = busRoutes(hasBattery, transfers, chargingVehicles);
  const solarTransferW = transferPower(
    transfers,
    (transfer) => transfer.source === "solar",
  );
  const batteryTransferW = transferPower(
    transfers,
    (transfer) => transfer.source === "battery" ||
      transfer.destination === "battery",
  );
  const homeTransferW = transferPower(
    transfers,
    (transfer) => transfer.destination === "home",
  );
  const gridTransferW = transferPower(
    transfers,
    (transfer) => transfer.source === "grid" ||
      transfer.destination === "grid",
  );
  const solarStreams = transferStreams(
    transfers,
    (transfer) => transfer.source === "solar",
  );
  const batteryStreams = transferStreams(
    transfers,
    (transfer) => batteryCharging
      ? transfer.destination === "battery"
      : transfer.source === "battery",
  );
  const homeStreams = transferStreams(
    transfers,
    (transfer) => transfer.destination === "home",
  );
  const gridStreams = transferStreams(
    transfers,
    (transfer) => gridImporting
      ? transfer.source === "grid"
      : transfer.destination === "grid",
  );
  const summary = flowSummary(loading, transfers);

  return (
    <section
      className={styles.shell}
      data-testid="energy-flow"
      data-source={dominant.source}
      style={{ "--flow-color": sourceColor(dominant.source) } as CSSProperties}
      aria-label="Live energy flow"
    >
      <header className={styles.flowHeader}>
        <div>
          <div className={styles.flowEyebrow}>Energy now</div>
          <div
            className={styles.flowSummary}
            data-testid="flow-summary"
            aria-live="polite"
          >
            {summary}
          </div>
        </div>
        <div className={styles.liveSignal} data-active={dominant.source !== "idle"}>
          <span aria-hidden="true" />
          Live
        </div>
      </header>

      {chargingVehicles.length > 0 && (
        <div className={styles.vehicleFlows}>
          {chargingVehicles.map((vehicle) => (
            <VehicleNode
              key={vehicle.id}
              vehicle={vehicle}
              loading={loading}
              streams={transferStreams(
                transfers,
                (transfer) =>
                  transfer.destination === `vehicle:${vehicle.id}`,
              )}
            />
          ))}
        </div>
      )}

      <EnergyBus source={dominant.source} routes={routes} />

      <div
        className={`${styles.endpoints} ${
          hasBattery ? styles.withBattery : styles.withoutBattery
        }`}
      >
        <div className={styles.endpoint}>
          <FlowBranch
            testId="flow-solar"
            direction="up"
            role={solarTransferW >= ACTIVE_FLOW_W ? "source" : "idle"}
            limitW={INVERTER_LIMIT_W}
            streams={solarStreams}
          />
          <FlowNode
            testId="node-solar"
            icon={<Sun size={28} />}
            label="Solar"
            value={loading ? "---" : kwValue(solarW)}
            tone="solar"
            role={solarW >= ACTIVE_FLOW_W ? "source" : "idle"}
            active={solarW >= ACTIVE_FLOW_W}
            powerW={solarW}
            limitW={INVERTER_LIMIT_W}
          />
        </div>

        {hasBattery && (
          <div className={styles.endpoint}>
            <FlowBranch
              testId="flow-battery"
              direction={batteryCharging ? "down" : "up"}
              role={
                batteryCharging
                  ? "destination"
                  : batteryDischarging
                  ? "source"
                  : "idle"
              }
              limitW={INVERTER_LIMIT_W}
              streams={batteryStreams}
            />
            <FlowNode
              testId="node-battery"
              icon={
                <HomeBatteryIcon
                  soc={data?.batterySoc ?? null}
                  charging={batteryCharging}
                />
              }
              label="Battery"
              value={loading ? "---" : kwValue(Math.abs(batteryW))}
              tone="battery"
              role={
                batteryCharging
                  ? "destination"
                  : batteryDischarging
                  ? "source"
                  : "idle"
              }
              active={batteryCharging || batteryDischarging}
              powerW={batteryW}
              limitW={INVERTER_LIMIT_W}
            >
              {!loading && data?.batterySoc != null && (
                <div className={styles.nodeMeta}>
                  {Math.round(data.batterySoc)}% · {batteryCharging
                    ? "Charging"
                    : batteryDischarging
                    ? "Discharging"
                    : "Idle"}
                </div>
              )}
            </FlowNode>
          </div>
        )}

        <div className={styles.endpoint}>
          <FlowBranch
            testId="flow-home"
            direction="down"
            role={homeTransferW >= ACTIVE_FLOW_W ? "destination" : "idle"}
            limitW={GRID_LIMIT_W}
            streams={homeStreams}
          />
          <FlowNode
            testId="node-home"
            icon={<Home size={28} />}
            label="Home"
            value={loading ? "---" : kwValue(homeW)}
            tone="home"
            role={homeW >= ACTIVE_FLOW_W ? "destination" : "idle"}
            active={homeW >= ACTIVE_FLOW_W}
            powerW={homeW}
            limitW={GRID_LIMIT_W}
          />
        </div>

        <div className={styles.endpoint}>
          <FlowBranch
            testId="flow-grid"
            direction={gridExporting ? "down" : "up"}
            role={gridImporting ? "source" : gridExporting ? "destination" : "idle"}
            limitW={GRID_LIMIT_W}
            streams={gridStreams}
          />
          <FlowNode
            testId="node-grid"
            icon={<Zap size={28} />}
            label="Grid"
            value={loading ? "---" : kwValue(Math.abs(gridW))}
            tone={gridExporting ? "grid-export" : "grid-import"}
            role={gridImporting ? "source" : gridExporting ? "destination" : "idle"}
            active={gridImporting || gridExporting}
            powerW={gridW}
            limitW={GRID_LIMIT_W}
          >
            {!loading && (gridImporting || gridExporting) && (
              <div className={styles.nodeMeta}>
                {gridExporting ? "Export" : "Import"}
              </div>
            )}
          </FlowNode>
        </div>
      </div>
    </section>
  );
}
