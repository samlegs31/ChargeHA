import { Home, Sun, Zap } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { EnergyData } from "@chargeha/shared";
import { kwValue } from "../../utils/Format.ts";
import styles from "./EnergyFlowDiagram.module.css";
import { VehicleSilhouetteIcon } from "../icons/VehicleSilhouetteIcon.tsx";

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

type FlowSource = "solar" | "battery" | "grid" | "export" | "idle";
type ActiveFlowSource = Exclude<FlowSource, "idle">;
type FlowDirection = "up" | "down";

interface FlowStream {
  source: ActiveFlowSource;
  powerW: number;
}

const ACTIVE_FLOW_W = 25;

function flowDurationS(powerW: number): number {
  const kw = Math.abs(powerW) / 1000;
  return Math.min(2.8, Math.max(1.05, 2.9 - kw * 0.18));
}

function sourceColor(source: FlowSource): string {
  switch (source) {
    case "solar":
      return "var(--color-solar)";
    case "battery":
      return "var(--color-battery)";
    case "grid":
      return "var(--color-grid-import)";
    case "export":
      return "var(--color-grid-export)";
    default:
      return "var(--gray-7)";
  }
}

const FLOW_SOURCE_ORDER: ActiveFlowSource[] = [
  "solar",
  "battery",
  "grid",
  "export",
];

function flowStreams(
  values: Partial<Record<ActiveFlowSource, number>>,
): FlowStream[] {
  return FLOW_SOURCE_ORDER
    .map((source) => ({ source, powerW: Math.max(0, values[source] ?? 0) }))
    .filter((stream) => stream.powerW >= ACTIVE_FLOW_W);
}

function dominantStream(streams: FlowStream[]): FlowSource {
  return streams.reduce<FlowStream | null>(
    (largest, stream) =>
      !largest || stream.powerW > largest.powerW ? stream : largest,
    null,
  )?.source ?? "idle";
}

function busStreamStyle(stream: FlowStream): CSSProperties {
  const durationS = Math.max(1.7, flowDurationS(stream.powerW) * 1.35);
  return {
    "--energy-dot-color": sourceColor(stream.source),
    "--bus-duration": `${durationS}s`,
  } as CSSProperties;
}

function busBeadStyle(
  stream: FlowStream,
  beadIndex: number,
): CSSProperties {
  const durationS = Math.max(1.7, flowDurationS(stream.powerW) * 1.35);
  const delayS = -beadIndex * durationS / 2;
  return { "--bead-delay": `${delayS}s` } as CSSProperties;
}

function EnergyBus({ streams }: { streams: FlowStream[] }) {
  const source = dominantStream(streams);
  const dominant = streams.find((stream) => stream.source === source) ?? null;
  return (
    <div
      className={styles.energyBus}
      data-testid="energy-bus"
      data-source={source}
      data-available-sources={streams.map((stream) => stream.source).join(" ")}
      data-stream-count={dominant ? 1 : 0}
      style={{ "--energy-bar-color": sourceColor(source) } as CSSProperties}
      aria-hidden="true"
    >
      <span className={styles.energyBusBase} data-testid="energy-bus-track" />
      {dominant && (
        <span
          className={styles.energyBusStream}
          data-testid={`energy-bus-${dominant.source}`}
          data-source={dominant.source}
          data-motion={dominant.source === "grid" ? "reverse" : "forward"}
          data-bead-count="2"
          style={busStreamStyle(dominant)}
        >
          {[0, 1].map((beadIndex) => (
            <span
              key={beadIndex}
              className={styles.energyBead}
              data-testid={`energy-bead-${dominant.source}-${beadIndex}`}
              style={busBeadStyle(dominant, beadIndex)}
            />
          ))}
        </span>
      )}
    </div>
  );
}

function allocateHomeStreams(
  homeW: number,
  solarAvailableW: number,
  batteryAvailableW: number,
  gridAvailableW: number,
): FlowStream[] {
  const solarW = Math.min(homeW, Math.max(0, solarAvailableW));
  const afterSolarW = Math.max(0, homeW - solarW);
  const batteryW = Math.min(afterSolarW, Math.max(0, batteryAvailableW));
  const afterBatteryW = Math.max(0, afterSolarW - batteryW);
  const gridW = Math.min(afterBatteryW, Math.max(0, gridAvailableW));
  return flowStreams({ solar: solarW, battery: batteryW, grid: gridW });
}

function scaleStreamsToPower(
  powerW: number,
  candidates: FlowStream[],
): FlowStream[] {
  if (powerW < ACTIVE_FLOW_W) return [];
  const inputs = candidates.filter((stream) =>
    stream.source === "solar" || stream.source === "grid"
  );
  const availableW = inputs.reduce((total, stream) => total + stream.powerW, 0);
  if (availableW < ACTIVE_FLOW_W) return flowStreams({ grid: powerW });
  return inputs.map((stream) => ({
    ...stream,
    powerW: powerW * (stream.powerW / availableW),
  })).filter((stream) => stream.powerW >= ACTIVE_FLOW_W);
}

function flowSummary(
  loading: boolean,
  solarW: number,
  batteryW: number,
  gridW: number,
): string {
  if (loading) return "Connecting to live energy";
  if (solarW >= ACTIVE_FLOW_W) return "Solar energy is flowing";
  if (batteryW > ACTIVE_FLOW_W) return "Home battery is supporting";
  if (gridW > ACTIVE_FLOW_W) return "Grid is supporting the home";
  if (gridW < -ACTIVE_FLOW_W) return "Surplus energy is returning to the grid";
  return "Energy is balanced";
}

function gridFlowSource(gridW: number): FlowSource {
  if (gridW > ACTIVE_FLOW_W) return "grid";
  if (gridW < -ACTIVE_FLOW_W) return "export";
  return "idle";
}

function FlowBranch({
  testId,
  direction,
  streams,
}: {
  testId: string;
  direction: FlowDirection;
  streams: FlowStream[];
}) {
  const active = streams.length > 0;
  const source = dominantStream(streams);

  return (
    <div
      className={`${styles.flowBranch} ${
        active ? styles.flowActive : styles.flowIdle
      }`}
      data-testid={testId}
      data-direction={direction}
      data-source={source}
      data-sources={streams.map((stream) => stream.source).join(" ")}
      data-stream-count={streams.length}
      style={{ "--flow-color": sourceColor(source) } as CSSProperties}
      aria-hidden="true"
    >
      <div className={styles.flowTrack} />
      {active && <span className={styles.flowDirection} />}
    </div>
  );
}

function FlowNode({
  icon,
  label,
  value,
  className,
  active,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  className?: string;
  active: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={`${styles.node} ${className ?? ""} ${
        active ? styles.active : styles.idle
      }`}
    >
      <div className={styles.iconBadge} aria-hidden="true">{icon}</div>
      <div className={styles.nodeLabel}>{label}</div>
      <div className={styles.nodeValue}>{value}</div>
      {children}
    </div>
  );
}

function VehicleNode({ v }: { v: ChargingVehicleFlow }) {
  const batteryW = v.batteryW ?? 0;
  const totalW = Math.max(1, v.chargePowerW);
  const solarPct = Math.min(100, (Math.max(0, v.solarW) / totalW) * 100);
  const batteryPct = Math.min(
    100 - solarPct,
    (Math.max(0, batteryW) / totalW) * 100,
  );
  const gridPct = Math.max(0, 100 - solarPct - batteryPct);

  return (
    <div className={styles.vehicleFlow}>
      <div
        className={`${styles.node} ${styles.vehicle} ${styles.active}`}
        data-testid={`vehicle-node-${v.id}`}
      >
        <div className={styles.iconBadge} aria-hidden="true">
          <VehicleSilhouetteIcon size={36} />
        </div>
        <div className={styles.vehicleName}>{v.name}</div>
        <div className={styles.nodeValue}>{kwValue(v.chargePowerW)}</div>
        <div className={styles.splitBar}>
          <div
            className={styles.splitSolar}
            style={{ width: `${solarPct}%` }}
          />
          <div
            className={styles.splitBattery}
            style={{ width: `${batteryPct}%` }}
          />
          <div className={styles.splitGrid} style={{ width: `${gridPct}%` }} />
        </div>
        <div className={styles.splitLegend}>
          <span className={styles.legendSolar}>{kwValue(v.solarW)} solar</span>
          {batteryW >= ACTIVE_FLOW_W && (
            <span className={styles.legendBattery}>
              {kwValue(batteryW)} battery
            </span>
          )}
          <span className={styles.legendGrid}>{kwValue(v.gridW)} grid</span>
        </div>
      </div>
      <FlowBranch
        testId={`flow-vehicle-${v.id}`}
        direction="up"
        streams={flowStreams({
          solar: v.solarW,
          battery: batteryW,
          grid: v.gridW,
        })}
      />
    </div>
  );
}

function batteryStatus(batteryW: number): string {
  if (batteryW > ACTIVE_FLOW_W) return "Discharging";
  if (batteryW < -ACTIVE_FLOW_W) return "Charging";
  return "Idle";
}

function batteryFlowStreams(
  batteryW: number,
  chargingStreams: FlowStream[],
): FlowStream[] {
  if (batteryW > ACTIVE_FLOW_W) return flowStreams({ battery: batteryW });
  if (batteryW < -ACTIVE_FLOW_W) return chargingStreams;
  return [];
}

function batteryLevelName(
  soc: number | null,
): "unknown" | "low" | "medium" | "high" {
  if (soc == null) return "unknown";
  if (soc < 25) return "low";
  if (soc < 75) return "medium";
  return "high";
}

function HomeBatteryIcon(
  { soc, charging }: { soc: number | null; charging: boolean },
) {
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

function BatteryEndpoint({
  batteryW,
  batterySoc,
  loading,
  chargingStreams,
}: {
  batteryW: number;
  batterySoc: number | null;
  loading: boolean;
  chargingStreams: FlowStream[];
}) {
  const charging = batteryW < -ACTIVE_FLOW_W;
  const discharging = batteryW > ACTIVE_FLOW_W;
  const active = charging || discharging;
  const streams = batteryFlowStreams(batteryW, chargingStreams);

  return (
    <div className={styles.endpoint}>
      <FlowBranch
        testId="flow-battery"
        direction={charging ? "down" : "up"}
        streams={streams}
      />
      <FlowNode
        icon={<HomeBatteryIcon soc={batterySoc} charging={charging} />}
        label="Battery"
        value={loading ? "---" : kwValue(Math.abs(batteryW))}
        className={styles.battery}
        active={active}
      >
        {!loading && batterySoc != null && (
          <div className={styles.socText}>{Math.round(batterySoc)}%</div>
        )}
        {!loading && (
          <div className={styles.batteryStatus}>{batteryStatus(batteryW)}</div>
        )}
      </FlowNode>
    </div>
  );
}

function GridEndpoint({
  gridW,
  loading,
}: {
  gridW: number;
  loading: boolean;
}) {
  const exporting = gridW < -ACTIVE_FLOW_W;
  const importing = gridW > ACTIVE_FLOW_W;
  const active = exporting || importing;

  return (
    <div className={styles.endpoint}>
      <FlowBranch
        testId="flow-grid"
        direction={exporting ? "down" : "up"}
        streams={flowStreams({
          grid: importing ? gridW : 0,
          export: exporting ? Math.abs(gridW) : 0,
        })}
      />
      <FlowNode
        icon={<Zap size={29} />}
        label="Grid"
        value={loading ? "---" : kwValue(Math.abs(gridW))}
        className={exporting ? styles.gridExport : styles.gridImport}
        active={active}
      >
        {!loading && active && (
          <div className={styles.pill}>{exporting ? "Export" : "Import"}</div>
        )}
      </FlowNode>
    </div>
  );
}

function EnergyEndpoints({
  loading,
  hasBattery,
  solarW,
  batteryW,
  batterySoc,
  homeW,
  gridW,
  homeStreams,
  batteryChargingStreams,
}: {
  loading: boolean;
  hasBattery: boolean;
  solarW: number;
  batteryW: number;
  batterySoc: number | null;
  homeW: number;
  gridW: number;
  homeStreams: FlowStream[];
  batteryChargingStreams: FlowStream[];
}) {
  const endpointClass = hasBattery
    ? styles.endpointsWithBattery
    : styles.endpointsWithoutBattery;

  return (
    <div className={`${styles.endpoints} ${endpointClass}`}>
      <div className={styles.endpoint}>
        <FlowBranch
          testId="flow-solar"
          direction="up"
          streams={flowStreams({ solar: solarW })}
        />
        <FlowNode
          icon={<Sun size={29} />}
          label="Solar"
          value={loading ? "---" : kwValue(solarW)}
          className={styles.solar}
          active={solarW >= ACTIVE_FLOW_W}
        />
      </div>

      {hasBattery && (
        <BatteryEndpoint
          batteryW={batteryW}
          batterySoc={batterySoc}
          loading={loading}
          chargingStreams={batteryChargingStreams}
        />
      )}

      <div className={styles.endpoint}>
        <FlowBranch
          testId="flow-home"
          direction="down"
          streams={homeStreams}
        />
        <FlowNode
          icon={<Home size={29} />}
          label="Home"
          value={loading ? "---" : kwValue(homeW)}
          className={styles.home}
          active={homeW >= ACTIVE_FLOW_W}
        />
      </div>

      <GridEndpoint gridW={gridW} loading={loading} />
    </div>
  );
}

export function EnergyFlowDiagram({
  data,
  loading = false,
  chargingVehicles = [],
}: EnergyFlowDiagramProps) {
  const solarW = data?.solarProductionW ?? 0;
  const gridW = data?.gridPowerW ?? 0;
  const batteryW = data?.batteryPowerW ?? 0;
  const totalVehicleW = chargingVehicles.reduce(
    (total, vehicle) => total + vehicle.chargePowerW,
    0,
  );
  const vehicleSources = chargingVehicles.reduce(
    (totals, vehicle) => ({
      solarW: totals.solarW + Math.max(0, vehicle.solarW),
      batteryW: totals.batteryW + Math.max(0, vehicle.batteryW ?? 0),
      gridW: totals.gridW + Math.max(0, vehicle.gridW),
    }),
    { solarW: 0, batteryW: 0, gridW: 0 },
  );
  // Fronius reports site consumption, including the EV. Display ordinary home load only.
  const homeW = Math.max(0, (data?.homeConsumptionW ?? 0) - totalVehicleW);
  const hasBattery = data?.batteryPowerW !== null &&
    data?.batteryPowerW !== undefined;
  const busStreams = flowStreams({
    solar: solarW,
    battery: Math.max(0, batteryW),
    grid: Math.max(0, gridW),
  });
  const homeStreams = allocateHomeStreams(
    homeW,
    solarW - vehicleSources.solarW,
    Math.max(0, batteryW) - vehicleSources.batteryW,
    Math.max(0, gridW) - vehicleSources.gridW,
  );
  const batteryChargingStreams = scaleStreamsToPower(
    Math.max(0, -batteryW),
    busStreams,
  );
  const busSource = dominantStream(busStreams);
  const gridSource = gridFlowSource(gridW);
  const summary = flowSummary(loading, solarW, batteryW, gridW);

  return (
    <section
      className={styles.shell}
      data-testid="energy-flow"
      data-grid-flow={gridSource}
      style={{
        "--grid-flow-color": sourceColor(gridSource),
      } as CSSProperties}
      aria-label="Live energy flow"
    >
      <header className={styles.flowHeader}>
        <div>
          <div className={styles.flowEyebrow}>Live energy</div>
          <div
            className={styles.flowSummary}
            data-testid="flow-summary"
            aria-live="polite"
          >
            {summary}
          </div>
        </div>
        <div
          className={styles.liveSignal}
          data-active={busSource !== "idle"}
          style={{ "--signal-color": sourceColor(busSource) } as CSSProperties}
        >
          <span aria-hidden="true" />
          Live
        </div>
      </header>

      {chargingVehicles.length > 0 && (
        <div className={styles.vehicleFlows}>
          {chargingVehicles.map((vehicle) => (
            <VehicleNode key={vehicle.id} v={vehicle} />
          ))}
        </div>
      )}
      <EnergyBus streams={busStreams} />
      <EnergyEndpoints
        loading={loading}
        hasBattery={hasBattery}
        solarW={solarW}
        batteryW={batteryW}
        batterySoc={data?.batterySoc ?? null}
        homeW={homeW}
        gridW={gridW}
        homeStreams={homeStreams}
        batteryChargingStreams={batteryChargingStreams}
      />
    </section>
  );
}
