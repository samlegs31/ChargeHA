import { Battery, Car, Home, Sun, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { EnergyData } from "@chargeha/shared";
import { kwValue } from "../../utils/Format.ts";
import styles from "./EnergyFlowDiagram.module.css";

export interface ChargingVehicleFlow {
  id: string;
  name: string;
  chargePowerW: number;
  solarW: number;
  gridW: number;
}

interface EnergyFlowDiagramProps {
  data: EnergyData | null;
  loading?: boolean;
  chargingVehicles?: ChargingVehicleFlow[];
}

const DOT_COUNT = 2;

function flowDurationS(powerW: number): number {
  const kw = Math.abs(powerW) / 1000;
  return Math.min(3, Math.max(1.35, 3.1 - kw * 0.2));
}

function BusConnector({
  active,
  color,
  direction = "right",
  powerW,
}: {
  active: boolean;
  color: string;
  direction?: "right" | "left";
  powerW: number;
}) {
  const durationS = flowDurationS(powerW);
  return (
    <div
      className={`${styles.connector} ${active ? styles.connectorActive : ""}`}
      style={{ color }}
      aria-hidden="true"
    >
      <div className={styles.track} />
      {active && Array.from({ length: DOT_COUNT }, (_, i) => (
        <div
          key={i}
          className={styles.dot}
          style={{
            animationDuration: `${durationS}s`,
            animationDelay: `${(-durationS / DOT_COUNT) * i}s`,
            animationDirection: direction === "left" ? "reverse" : "normal",
          }}
        />
      ))}
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
    <div className={`${styles.node} ${className ?? ""} ${active ? styles.active : styles.idle}`}>
      <div className={styles.iconBadge}>{icon}</div>
      <div className={styles.nodeLabel}>{label}</div>
      <div className={styles.nodeValue}>{value}</div>
      {children}
    </div>
  );
}

function VehicleNode({ v }: { v: ChargingVehicleFlow }) {
  const solarPct = v.chargePowerW > 0
    ? Math.min(100, Math.round((v.solarW / v.chargePowerW) * 100))
    : 0;
  return (
    <div className={`${styles.node} ${styles.vehicle} ${styles.active}`} data-testid={`vehicle-node-${v.id}`}>
      <div className={styles.iconBadge}><Car size={22} /></div>
      <div className={styles.vehicleName}>{v.name}</div>
      <div className={styles.nodeValue}>{kwValue(v.chargePowerW)}</div>
      <div className={styles.splitBar}>
        <div className={styles.splitSolar} style={{ width: `${solarPct}%` }} />
      </div>
      <div className={styles.splitLegend}>
        <span className={styles.legendSolar}>{kwValue(v.solarW)} solar</span>
        <span className={styles.legendGrid}>{kwValue(v.gridW)} grid</span>
      </div>
    </div>
  );
}

export function EnergyFlowDiagram({
  data,
  loading = false,
  chargingVehicles = [],
}: EnergyFlowDiagramProps) {
  const solarW = data?.solarProductionW ?? 0;
  const homeW = data?.homeConsumptionW ?? 0;
  const gridW = data?.gridPowerW ?? 0;
  const batteryW = data?.batteryPowerW ?? 0;
  const hasBattery = data?.batteryPowerW !== null && data?.batteryPowerW !== undefined;
  const isExporting = gridW < 0;
  const batteryCharging = batteryW < -10;
  const batteryActive = Math.abs(batteryW) > 10;
  const batteryStatus = batteryW > 10 ? "Discharging" : batteryCharging ? "Charging" : "Idle";
  const gridColor = isExporting ? "var(--color-grid-export)" : "var(--color-grid-import)";

  return (
    <section className={styles.shell} data-testid="energy-flow" aria-label="Live energy flow">
      <div className={`${styles.bus} ${hasBattery ? styles.busWithBattery : styles.busWithoutBattery}`}>
        <FlowNode icon={<Sun size={24} />} label="Solar" value={loading ? "---" : kwValue(solarW)} className={styles.solar} active={solarW > 10} />

        <BusConnector active={solarW > 10} color="var(--color-solar)" powerW={solarW} />

        {hasBattery && (
          <>
            <FlowNode icon={<Battery size={24} />} label="Battery" value={loading ? "---" : kwValue(Math.abs(batteryW))} className={styles.battery} active={batteryActive}>
              {!loading && data?.batterySoc != null && <div className={styles.socText}>{Math.round(data.batterySoc)}%</div>}
              {!loading && <div className={styles.batteryStatus}>{batteryStatus}</div>}
            </FlowNode>
            <BusConnector active={batteryActive} color="var(--color-battery)" direction={batteryCharging ? "left" : "right"} powerW={batteryW} />
          </>
        )}

        <FlowNode icon={<Home size={24} />} label="Home" value={loading ? "---" : kwValue(homeW)} className={styles.home} active={homeW > 10} />

        <BusConnector active={Math.abs(gridW) > 10} color={gridColor} direction={isExporting ? "right" : "left"} powerW={gridW} />

        <FlowNode icon={<Zap size={24} />} label="Grid" value={loading ? "---" : kwValue(Math.abs(gridW))} className={isExporting ? styles.gridExport : styles.gridImport} active={Math.abs(gridW) > 10}>
          {!loading && Math.abs(gridW) > 10 && <div className={styles.pill}>{isExporting ? "Export" : "Import"}</div>}
        </FlowNode>
      </div>

      {chargingVehicles.length > 0 && (
        <div className={styles.vehicleArea}>
          <div className={styles.vehicleStem} aria-hidden="true" />
          <div className={styles.vehicleRow}>
            {chargingVehicles.map((v) => <VehicleNode key={v.id} v={v} />)}
          </div>
        </div>
      )}
    </section>
  );
}
