import type { ReactNode } from "react";
import { Battery, DollarSign, MapPin, Sun, Zap } from "lucide-react";
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

function energySourcePercentages(
  solarWh: number,
  batteryWh: number,
  gridWh: number,
) {
  const values = [
    Math.max(0, solarWh),
    Math.max(0, batteryWh),
    Math.max(0, gridWh),
  ];
  const total = values.reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    return { solarPct: 0, batteryPct: 0, gridPct: 0 };
  }

  const raw = values.map((value) => (value / total) * 100);
  const floored = raw.map(Math.floor);
  const remaining = 100 - floored.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({
      index,
      fraction: value - floored[index],
    }))
    .sort((a, b) => b.fraction - a.fraction);
  const bonusIndexes = new Set(
    order.slice(0, remaining).map(({ index }) => index),
  );
  const pct = floored.map((value, index) =>
    value + (bonusIndexes.has(index) ? 1 : 0)
  );

  return {
    solarPct: pct[0],
    batteryPct: pct[1],
    gridPct: pct[2],
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

function EnergyMetricRow({
  label,
  valueWh,
  icon,
}: {
  label: string;
  valueWh: number;
  icon: ReactNode;
}) {
  return (
    <div className={styles.breakdownRow}>
      {icon}
      <Text size="2" className={styles.breakdownLabel}>{label}</Text>
      <Text size="2" className={styles.breakdownValue}>
        {kwhValue(valueWh)}
      </Text>
      <Text size="2" className={styles.breakdownPct} />
    </div>
  );
}

function ChargingCostRows({
  costCents,
  evSolarSavingsCents,
  currencySymbol,
}: {
  costCents?: number;
  evSolarSavingsCents?: number;
  currencySymbol: string;
}) {
  const hasCost = (costCents ?? 0) > 0 || (evSolarSavingsCents ?? 0) > 0;
  if (!hasCost) return null;

  return (
    <>
      <div className={styles.breakdownRow}>
        <div
          className={styles.breakdownIcon}
          style={{ backgroundColor: "transparent" }}
        />
        <DollarSign size={16} style={{ color: "var(--gray-11)" }} />
        <Text size="2" className={styles.breakdownLabel}>Cost</Text>
        <Text size="2" className={styles.breakdownValue}>
          {formatCost(costCents ?? 0, currencySymbol)}
        </Text>
        <Text size="2" className={styles.breakdownPct} />
      </div>
      {(evSolarSavingsCents ?? 0) > 0 && (
        <div className={styles.breakdownRow}>
          <div
            className={styles.breakdownIcon}
            style={{ backgroundColor: "transparent" }}
          />
          <Sun size={16} style={{ color: "var(--color-solar-car)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            Solar Savings
          </Text>
          <Text size="2" color="green" className={styles.breakdownValue}>
            {formatCost(evSolarSavingsCents ?? 0, currencySymbol)}
          </Text>
          <Text size="2" className={styles.breakdownPct} />
        </div>
      )}
    </>
  );
}

/** Renders a single vehicle charging card matching the "Vehicle Charging" layout. */
function VehicleChargingCard({
  title,
  totalChargedWh,
  solarWh,
  batteryWh,
  gridWh,
  awayWh,
  costCents,
  evSolarSavingsCents,
  currencySymbol,
}: {
  title: string;
  totalChargedWh: number;
  solarWh: number;
  batteryWh: number;
  gridWh: number;
  awayWh?: number;
  costCents?: number;
  evSolarSavingsCents?: number;
  currencySymbol: string;
}) {
  const homeTotal = solarWh + batteryWh + gridWh;
  const solarPct = homeTotal > 0 ? Math.round((solarWh / homeTotal) * 100) : 0;
  const batteryPct = homeTotal > 0
    ? Math.round((batteryWh / homeTotal) * 100)
    : 0;
  const gridPct = homeTotal > 0 ? Math.round((gridWh / homeTotal) * 100) : 0;
  const awayPct = totalChargedWh > 0 && awayWh != null
    ? Math.round((awayWh / totalChargedWh) * 100)
    : 0;

  return (
    <Card className={styles.breakdownCard}>
      <Text size="2" weight="bold">{title}</Text>
      <div className={styles.breakdownRow}>
        <Text size="2" color="gray" className={styles.breakdownLabel}>
          Total Charged
        </Text>
        <Text size="2" className={styles.breakdownValue}>
          {kwhValue(totalChargedWh)}
        </Text>
        <Text size="2" className={styles.breakdownPct} />
      </div>
      <EnergyBreakdownRow
        label="From Solar"
        valueWh={solarWh}
        pct={solarPct}
        color="var(--color-solar-car)"
        icon={<Sun size={16} style={{ color: "var(--color-solar-car)" }} />}
      />
      <EnergyBreakdownRow
        label="From Battery"
        valueWh={batteryWh}
        pct={batteryPct}
        color="var(--color-battery)"
        icon={<Battery size={16} style={{ color: "var(--color-battery)" }} />}
      />
      <EnergyBreakdownRow
        label="From Grid"
        valueWh={gridWh}
        pct={gridPct}
        color="var(--color-grid-car)"
        icon={<Zap size={16} style={{ color: "var(--color-grid-car)" }} />}
      />
      {awayWh != null && awayWh > 0 && (
        <EnergyBreakdownRow
          label="Away"
          valueWh={awayWh}
          pct={awayPct}
          color="var(--color-away)"
          icon={<MapPin size={16} style={{ color: "var(--color-away)" }} />}
        />
      )}
      <ChargingCostRows
        costCents={costCents}
        evSolarSavingsCents={evSolarSavingsCents}
        currencySymbol={currencySymbol}
      />
    </Card>
  );
}

function EnergySourcesCard({ data }: { data: StatsResponse | null }) {
  const { solarPct, batteryPct, gridPct } = energySourcePercentages(
    data?.homeSolarWh ?? 0,
    data?.homeBatteryDischargeWh ?? 0,
    data?.homeGridWh ?? 0,
  );
  return (
    <Card className={styles.breakdownCard}>
      <Text size="2" weight="bold">Energy Sources</Text>
      <EnergyBreakdownRow
        label="From Solar"
        valueWh={data?.homeSolarWh ?? 0}
        pct={solarPct}
        color="var(--color-solar)"
        icon={<Sun size={16} style={{ color: "var(--color-solar)" }} />}
      />
      <EnergyBreakdownRow
        label="From Battery"
        valueWh={data?.homeBatteryDischargeWh ?? 0}
        pct={batteryPct}
        color="var(--color-battery)"
        icon={<Battery size={16} style={{ color: "var(--color-battery)" }} />}
      />
      <EnergyBreakdownRow
        label="From Grid"
        valueWh={data?.homeGridWh ?? 0}
        pct={gridPct}
        color="var(--color-grid-import)"
        icon={<Zap size={16} style={{ color: "var(--color-grid-import)" }} />}
      />
    </Card>
  );
}

function HomeBatteryCard({ data }: { data: StatsResponse | null }) {
  const batteryToHomeWh = Math.max(
    0,
    (data?.homeBatteryDischargeWh ?? 0) - (data?.totalBatteryWh ?? 0),
  );
  return (
    <Card className={styles.breakdownCard}>
      <Text size="2" weight="bold">Home Battery</Text>
      <EnergyMetricRow
        label="Energy Charged"
        valueWh={data?.homeBatteryChargeWh ?? 0}
        icon={<Battery size={16} style={{ color: "var(--color-battery)" }} />}
      />
      <EnergyMetricRow
        label="Solar → Battery"
        valueWh={data?.homeSolarToBatteryWh ?? 0}
        icon={<Sun size={16} style={{ color: "var(--color-solar)" }} />}
      />
      <EnergyMetricRow
        label="Grid → Battery"
        valueWh={data?.homeGridToBatteryWh ?? 0}
        icon={<Zap size={16} style={{ color: "var(--color-grid-battery)" }} />}
      />
      <EnergyMetricRow
        label="Energy Discharged"
        valueWh={data?.homeBatteryDischargeWh ?? 0}
        icon={<Battery size={16} style={{ color: "var(--color-battery)" }} />}
      />
      <EnergyMetricRow
        label="Battery → Home"
        valueWh={batteryToHomeWh}
        icon={<Battery size={16} style={{ color: "var(--color-battery)" }} />}
      />
      <EnergyMetricRow
        label="Battery → Car"
        valueWh={data?.totalBatteryWh ?? 0}
        icon={<Battery size={16} style={{ color: "var(--color-battery)" }} />}
      />
    </Card>
  );
}

function VehicleChargingCards({
  data,
  hasChargeData,
  hasConfiguredVehicles,
  vehicleBreakdownsLoading,
  activeVehicleBreakdowns,
  currencySymbol,
}: {
  data: StatsResponse | null;
  hasChargeData: boolean;
  hasConfiguredVehicles: boolean;
  vehicleBreakdownsLoading: boolean;
  activeVehicleBreakdowns: VehicleBreakdown[];
  currencySymbol: string;
}) {
  const showFallback = hasChargeData && !vehicleBreakdownsLoading &&
    !hasConfiguredVehicles && activeVehicleBreakdowns.length === 0;
  return (
    <>
      {hasChargeData && activeVehicleBreakdowns.map((vb) => (
        <VehicleChargingCard
          key={vb.vehicleId}
          title={vb.vehicleName}
          totalChargedWh={vb.totalChargedWh}
          solarWh={vb.totalSolarWh}
          batteryWh={vb.totalBatteryWh}
          gridWh={vb.totalGridWh}
          costCents={vb.totalCostCents}
          evSolarSavingsCents={vb.evSolarSavingsCents}
          currencySymbol={currencySymbol}
        />
      ))}
      {showFallback && (
        <VehicleChargingCard
          title="Vehicle Charging"
          totalChargedWh={data?.totalChargedWh ?? 0}
          solarWh={data?.totalSolarWh ?? 0}
          batteryWh={data?.totalBatteryWh ?? 0}
          gridWh={data?.totalGridWh ?? 0}
          awayWh={data?.totalAwayWh ?? 0}
          costCents={data?.totalCostCents ?? 0}
          evSolarSavingsCents={data?.evSolarSavingsCents ?? 0}
          currencySymbol={currencySymbol}
        />
      )}
    </>
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
    <>
      <EnergySourcesCard data={data} />
      <HomeBatteryCard data={data} />
      <VehicleChargingCards
        data={data}
        hasChargeData={breakdown.hasChargeData}
        hasConfiguredVehicles={breakdown.hasConfiguredVehicles}
        vehicleBreakdownsLoading={breakdown.vehicleBreakdownsLoading}
        activeVehicleBreakdowns={breakdown.activeVehicleBreakdowns}
        currencySymbol={breakdown.currencySymbol}
      />
    </>
  );
}
