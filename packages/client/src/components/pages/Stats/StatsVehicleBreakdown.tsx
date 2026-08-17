import type { ReactNode } from "react";
import { Battery, DollarSign, Sun, Zap } from "lucide-react";
import { Card, Text } from "@radix-ui/themes";
import type { StatsPeriod, StatsResponse } from "@chargeha/shared";
import type { DayResolution } from "../../../hooks/useStats.ts";
import {
  useVehicleBreakdowns,
  type VehicleBreakdown,
} from "../../../hooks/useVehicleBreakdowns.ts";
import { formatCost, kwhValue } from "../../../utils/Format.ts";
import styles from "./Stats.module.css";

interface StatsVehicleBreakdownProps {
  data: StatsResponse | null;
  loading: boolean;
  period: StatsPeriod;
  cursor: Date;
  resolution: DayResolution;
}

function sourcePercentages(
  solarWh: number,
  batteryWh: number,
  gridWh: number,
) {
  const totalWh = solarWh + batteryWh + gridWh;
  if (totalWh <= 0) return { solar: 0, battery: 0, grid: 0 };
  return {
    solar: Math.round((solarWh / totalWh) * 100),
    battery: Math.round((batteryWh / totalWh) * 100),
    grid: Math.round((gridWh / totalWh) * 100),
  };
}

function EnergyBreakdownRow({
  label,
  valueWh,
  pct,
  color,
  icon,
}: {
  label: string;
  valueWh: number;
  pct: number;
  color: string;
  icon: ReactNode;
}) {
  return (
    <div className={styles.breakdownRow}>
      <div
        className={styles.breakdownIcon}
        style={{ backgroundColor: color }}
      />
      {icon}
      <Text size="2" className={styles.breakdownLabel}>{label}</Text>
      <Text size="2" className={styles.breakdownValue}>
        {kwhValue(valueWh)}
      </Text>
      <Text size="2" color="gray" className={styles.breakdownPct}>
        {pct}%
      </Text>
    </div>
  );
}

function ChargingCostRows({
  costCents,
  solarSavingsCents,
  currencySymbol,
}: {
  costCents: number;
  solarSavingsCents: number;
  currencySymbol: string;
}) {
  if (costCents <= 0 && solarSavingsCents <= 0) return null;
  return (
    <>
      {costCents > 0 && (
        <div className={styles.breakdownRow}>
          <DollarSign size={16} style={{ color: "var(--gray-11)" }} />
          <Text size="2" className={styles.breakdownLabel}>Grid Cost</Text>
          <Text size="2" className={styles.breakdownValue}>
            {formatCost(costCents, currencySymbol)}
          </Text>
          <Text size="2" className={styles.breakdownPct} />
        </div>
      )}
      {solarSavingsCents > 0 && (
        <div className={styles.breakdownRow}>
          <Sun size={16} style={{ color: "var(--color-solar-car)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            Solar Savings
          </Text>
          <Text size="2" color="green" className={styles.breakdownValue}>
            {formatCost(solarSavingsCents, currencySymbol)}
          </Text>
          <Text size="2" className={styles.breakdownPct} />
        </div>
      )}
    </>
  );
}

function VehicleChargingCard({
  title,
  solarWh,
  batteryWh,
  gridWh,
  costCents,
  solarSavingsCents,
  currencySymbol,
}: {
  title: string;
  solarWh: number;
  batteryWh: number;
  gridWh: number;
  costCents: number;
  solarSavingsCents: number;
  currencySymbol: string;
}) {
  const totalWh = solarWh + batteryWh + gridWh;
  const pct = sourcePercentages(solarWh, batteryWh, gridWh);
  return (
    <Card className={styles.breakdownCard}>
      <Text size="2" weight="bold">{title}</Text>
      <div className={styles.breakdownRow}>
        <Text size="2" color="gray" className={styles.breakdownLabel}>
          Total Charged
        </Text>
        <Text size="2" className={styles.breakdownValue}>
          {kwhValue(totalWh)}
        </Text>
        <Text size="2" className={styles.breakdownPct} />
      </div>
      <EnergyBreakdownRow
        label="From Solar"
        valueWh={solarWh}
        pct={pct.solar}
        color="var(--color-solar-car)"
        icon={<Sun size={16} style={{ color: "var(--color-solar-car)" }} />}
      />
      <EnergyBreakdownRow
        label="From Battery"
        valueWh={batteryWh}
        pct={pct.battery}
        color="var(--color-battery-car)"
        icon={<Battery size={16} style={{ color: "var(--color-battery-car)" }} />}
      />
      <EnergyBreakdownRow
        label="From Grid"
        valueWh={gridWh}
        pct={pct.grid}
        color="var(--color-grid-car)"
        icon={<Zap size={16} style={{ color: "var(--color-grid-car)" }} />}
      />
      <ChargingCostRows
        costCents={costCents}
        solarSavingsCents={solarSavingsCents}
        currencySymbol={currencySymbol}
      />
    </Card>
  );
}

function VehicleCards({
  data,
  breakdowns,
  hasConfiguredVehicles,
  loading,
  currencySymbol,
}: {
  data: StatsResponse | null;
  breakdowns: VehicleBreakdown[];
  hasConfiguredVehicles: boolean;
  loading: boolean;
  currencySymbol: string;
}) {
  if (loading) return null;
  if (breakdowns.length > 0) {
    return (
      <>
        {breakdowns.map((vehicle) => (
          <VehicleChargingCard
            key={vehicle.vehicleId}
            title={vehicle.vehicleName}
            solarWh={vehicle.totalSolarWh}
            batteryWh={vehicle.totalBatteryWh}
            gridWh={vehicle.totalGridWh}
            costCents={vehicle.totalCostCents}
            solarSavingsCents={vehicle.evSolarSavingsCents}
            currencySymbol={currencySymbol}
          />
        ))}
      </>
    );
  }
  if (hasConfiguredVehicles || !data || data.totalChargedWh <= 0) return null;
  return (
    <VehicleChargingCard
      title="Vehicle Charging"
      solarWh={data.totalSolarWh}
      batteryWh={data.totalBatteryWh}
      gridWh={data.totalGridWh}
      costCents={data.totalCostCents ?? 0}
      solarSavingsCents={data.evSolarSavingsCents ?? 0}
      currencySymbol={currencySymbol}
    />
  );
}

export function StatsVehicleBreakdown(
  { data, loading, period, cursor, resolution }: StatsVehicleBreakdownProps,
) {
  const breakdown = useVehicleBreakdowns({
    data,
    loading,
    period,
    cursor,
    resolution,
  });
  return (
    <VehicleCards
      data={data}
      breakdowns={breakdown.activeVehicleBreakdowns}
      hasConfiguredVehicles={breakdown.hasConfiguredVehicles}
      loading={breakdown.vehicleBreakdownsLoading}
      currencySymbol={breakdown.currencySymbol}
    />
  );
}
