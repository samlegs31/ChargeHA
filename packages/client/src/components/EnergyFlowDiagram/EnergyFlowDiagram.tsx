import { Battery, Car, Home, Sun, Zap } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { EnergyData } from "@chargeha/shared";
import { kwValue } from "../../utils/Format.ts";
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

const ACTIVE_FLOW_W = 25;

function flowDurationS(powerW: number): number {
  const kw = Math.abs(powerW) / 1000;
  return Math.min(2.8, Math.max(1.05, 2.9 - kw * 0.18));
}

function dominantSource(
  solarW: number,
  batteryW: number,
  gridW: number,
): FlowSource {
  const sources: Array<[FlowSource, number]> = [
    ["solar", Math.max(0, solarW)],
    ["battery", Math.max(0, batteryW)],
    ["grid", Math.max(0, gridW)],
  ];
  const [source, powerW] = sources.reduce((largest, current) =>
    current[1] > largest[1] ? current : largest
  );
  return powerW >= ACTIVE_FLOW_W ? source : "idle";
}

function sourceColor(source: FlowSource): string {
  switch (source) {
    case "solar":
      return "var(--color-solar-car)";
    case "battery":
      return "var(--color-battery)";
    case "grid":
      return "var(--color-grid-import)";
    default:
      return "var(--gray-7)";
  }
}

function FlowBranch({
  testId,
  active,
  direction,
  source,
  powerW,
  color,
}: {
  testId: string;
  active: boolean;
  direction: FlowDirection;
  source: FlowSource;
  powerW: number;
  color?: string;
}) {
  const style = {
    "--flow-color": color ?? sourceColor(source),
    "--flow-duration": `${flowDurationS(powerW)}s`,
  } as CSSProperties;

  return (
    <div
      className={`${styles.flowBranch} ${
        active ? styles.flowActive : styles.flowIdle
      }`}
      data-testid={testId}
      data-direction={direction}
      data-source={source}
      style={style}
      aria-hidden="true"
    >
      <div className={styles.flowTrack} />
      {active && (
        <span
          className={direction === "up" ? styles.arrowUp : styles.arrowDown}
        >
          {direction === "up" ? "↑" : "↓"}
        </span>
      )}
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
      <div className={styles.iconBadge}>{icon}</div>
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
        <div className={styles.iconBadge}>
          <Car size={25} />
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
        active={v.chargePowerW >= ACTIVE_FLOW_W}
        direction="up"
        source={dominantSource(v.solarW, batteryW, v.gridW)}
        powerW={v.chargePowerW}
      />
    </div>
  );
}

function batteryStatus(batteryW: number): string {
  if (batteryW > ACTIVE_FLOW_W) return "Discharging";
  if (batteryW < -ACTIVE_FLOW_W) return "Charging";
  return "Idle";
}

function BatteryEndpoint({
  batteryW,
  batterySoc,
  loading,
  busSource,
}: {
  batteryW: number;
  batterySoc: number | null;
  loading: boolean;
  busSource: FlowSource;
}) {
  const charging = batteryW < -ACTIVE_FLOW_W;
  const discharging = batteryW > ACTIVE_FLOW_W;
  const active = charging || discharging;

  return (
    <div className={styles.endpoint}>
      <FlowBranch
        testId="flow-battery"
        active={active}
        direction={charging ? "down" : "up"}
        source={discharging ? "battery" : busSource}
        powerW={batteryW}
      />
      <FlowNode
        icon={<Battery size={26} />}
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
  busSource,
}: {
  gridW: number;
  loading: boolean;
  busSource: FlowSource;
}) {
  const exporting = gridW < -ACTIVE_FLOW_W;
  const importing = gridW > ACTIVE_FLOW_W;
  const active = exporting || importing;

  return (
    <div className={styles.endpoint}>
      <FlowBranch
        testId="flow-grid"
        active={active}
        direction={exporting ? "down" : "up"}
        source={importing ? "grid" : busSource}
        powerW={gridW}
        color={exporting
          ? "var(--color-grid-export)"
          : "var(--color-grid-import)"}
      />
      <FlowNode
        icon={<Zap size={26} />}
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
  homeSource,
  busSource,
}: {
  loading: boolean;
  hasBattery: boolean;
  solarW: number;
  batteryW: number;
  batterySoc: number | null;
  homeW: number;
  gridW: number;
  homeSource: FlowSource;
  busSource: FlowSource;
}) {
  const endpointClass = hasBattery
    ? styles.endpointsWithBattery
    : styles.endpointsWithoutBattery;

  return (
    <div className={`${styles.endpoints} ${endpointClass}`}>
      <div className={styles.endpoint}>
        <FlowBranch
          testId="flow-solar"
          active={solarW >= ACTIVE_FLOW_W}
          direction="up"
          source="solar"
          powerW={solarW}
        />
        <FlowNode
          icon={<Sun size={26} />}
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
          busSource={busSource}
        />
      )}

      <div className={styles.endpoint}>
        <FlowBranch
          testId="flow-home"
          active={homeW >= ACTIVE_FLOW_W}
          direction="down"
          source={homeSource}
          powerW={homeW}
        />
        <FlowNode
          icon={<Home size={26} />}
          label="Home"
          value={loading ? "---" : kwValue(homeW)}
          className={styles.home}
          active={homeW >= ACTIVE_FLOW_W}
        />
      </div>

      <GridEndpoint gridW={gridW} loading={loading} busSource={busSource} />
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
  // Fronius reports site consumption, including the EV. Display ordinary home load only.
  const homeW = Math.max(0, (data?.homeConsumptionW ?? 0) - totalVehicleW);
  const hasBattery = data?.batteryPowerW !== null &&
    data?.batteryPowerW !== undefined;
  const solarToHomeW = Math.min(Math.max(0, solarW), homeW);
  const remainingHomeW = Math.max(0, homeW - solarToHomeW);
  const batteryToHomeW = Math.min(Math.max(0, batteryW), remainingHomeW);
  const gridToHomeW = Math.max(0, remainingHomeW - batteryToHomeW);
  const homeSource = dominantSource(solarToHomeW, batteryToHomeW, gridToHomeW);
  const busSource = dominantSource(
    solarW,
    Math.max(0, batteryW),
    Math.max(0, gridW),
  );

  return (
    <section
      className={styles.shell}
      data-testid="energy-flow"
      aria-label="Live energy flow"
    >
      {chargingVehicles.length > 0 && (
        <div className={styles.vehicleFlows}>
          {chargingVehicles.map((vehicle) => (
            <VehicleNode key={vehicle.id} v={vehicle} />
          ))}
        </div>
      )}
      <div
        className={styles.energyBus}
        data-testid="energy-bus"
        data-source={busSource}
        style={{ "--bus-color": sourceColor(busSource) } as CSSProperties}
        aria-hidden="true"
      />
      <EnergyEndpoints
        loading={loading}
        hasBattery={hasBattery}
        solarW={solarW}
        batteryW={batteryW}
        batterySoc={data?.batterySoc ?? null}
        homeW={homeW}
        gridW={gridW}
        homeSource={homeSource}
        busSource={busSource}
      />
    </section>
  );
}
