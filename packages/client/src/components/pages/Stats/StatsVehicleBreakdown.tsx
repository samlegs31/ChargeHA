import type { ReactNode } from "react";
import { Battery, DollarSign, History, MapPin, Sun, Zap } from "lucide-react";
import { Badge, Card, Text } from "@radix-ui/themes";
import type {
  DayResolution,
  StatsViewPeriod,
  StatsViewResponse,
} from "../../../hooks/useStats.ts";
import {
  type UnassignedBreakdown,
  useVehicleBreakdowns,
  type VehicleBreakdown,
  type VehicleHomeChargingSource,
} from "../../../hooks/useVehicleBreakdowns.ts";
import { formatCost, kwhValue } from "../../../utils/Format.ts";
import { vehicleColorPalette } from "../../../utils/vehicleColor.ts";
import styles from "./Stats.module.css";

interface StatsVehicleBreakdownProps {
  data: StatsViewResponse | null;
  loading: boolean;
  period: StatsViewPeriod;
  cursor: Date;
  resolution: DayResolution;
}

const SOURCE_COLORS = {
  solar: "var(--color-solar-car)",
  battery: "var(--color-battery-car)",
  grid: "var(--color-grid-car)",
  away: "var(--color-away)",
} as const;

function sourcePercentages(
  solarWh: number,
  batteryWh: number,
  gridWh: number,
  awayWh: number,
) {
  const totalWh = solarWh + batteryWh + gridWh + awayWh;
  if (totalWh <= 0) return { solar: 0, battery: 0, grid: 0, away: 0 };
  return {
    solar: Math.round((solarWh / totalWh) * 100),
    battery: Math.round((batteryWh / totalWh) * 100),
    grid: Math.round((gridWh / totalWh) * 100),
    away: Math.round((awayWh / totalWh) * 100),
  };
}

function homeSourceLabel(source: VehicleHomeChargingSource): string {
  if (source === "chargehq") return "Home · ChargeHQ";
  if (source === "solarweb") return "Home · Wattpilot";
  return "Home source not set";
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
          <Sun size={16} style={{ color: SOURCE_COLORS.solar }} />
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

function VehicleCardHeader({
  title,
  exteriorColor,
  homeChargingSource,
}: {
  title: string;
  exteriorColor: string | null;
  homeChargingSource: VehicleHomeChargingSource;
}) {
  const palette = vehicleColorPalette(exteriorColor);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: palette.base,
            boxShadow: `0 0 0 2px ${palette.light}`,
          }}
        />
        <Text size="2" weight="bold">{title}</Text>
        {exteriorColor && <Text size="1" color="gray">{palette.label}</Text>}
      </div>
      <Badge variant="soft" size="1">
        {homeSourceLabel(homeChargingSource)}
      </Badge>
    </div>
  );
}

function SourceRows({
  solarWh,
  batteryWh,
  gridWh,
  awayWh,
}: {
  solarWh: number;
  batteryWh: number;
  gridWh: number;
  awayWh: number;
}) {
  const pct = sourcePercentages(solarWh, batteryWh, gridWh, awayWh);
  return (
    <>
      <EnergyBreakdownRow
        label="Home Solar"
        valueWh={solarWh}
        pct={pct.solar}
        color={SOURCE_COLORS.solar}
        icon={<Sun size={16} style={{ color: SOURCE_COLORS.solar }} />}
      />
      <EnergyBreakdownRow
        label="Home Battery"
        valueWh={batteryWh}
        pct={pct.battery}
        color={SOURCE_COLORS.battery}
        icon={<Battery size={16} style={{ color: SOURCE_COLORS.battery }} />}
      />
      <EnergyBreakdownRow
        label="Home Grid"
        valueWh={gridWh}
        pct={pct.grid}
        color={SOURCE_COLORS.grid}
        icon={<Zap size={16} style={{ color: SOURCE_COLORS.grid }} />}
      />
      <EnergyBreakdownRow
        label="External"
        valueWh={awayWh}
        pct={pct.away}
        color={SOURCE_COLORS.away}
        icon={<MapPin size={16} style={{ color: SOURCE_COLORS.away }} />}
      />
    </>
  );
}

function VehicleChargingCard({
  title,
  exteriorColor,
  homeChargingSource,
  solarWh,
  batteryWh,
  gridWh,
  awayWh,
  costCents,
  solarSavingsCents,
  currencySymbol,
}: {
  title: string;
  exteriorColor: string | null;
  homeChargingSource: VehicleHomeChargingSource;
  solarWh: number;
  batteryWh: number;
  gridWh: number;
  awayWh: number;
  costCents: number;
  solarSavingsCents: number;
  currencySymbol: string;
}) {
  const totalWh = solarWh + batteryWh + gridWh + awayWh;
  const palette = vehicleColorPalette(exteriorColor);
  return (
    <Card
      className={styles.breakdownCard}
      style={{ borderLeft: `4px solid ${palette.base}` }}
    >
      <VehicleCardHeader
        title={title}
        exteriorColor={exteriorColor}
        homeChargingSource={homeChargingSource}
      />
      <div className={styles.breakdownRow}>
        <Text size="2" color="gray" className={styles.breakdownLabel}>
          Total Charged
        </Text>
        <Text size="2" className={styles.breakdownValue}>
          {kwhValue(totalWh)}
        </Text>
        <Text size="2" className={styles.breakdownPct} />
      </div>
      <SourceRows
        solarWh={solarWh}
        batteryWh={batteryWh}
        gridWh={gridWh}
        awayWh={awayWh}
      />
      <ChargingCostRows
        costCents={costCents}
        solarSavingsCents={solarSavingsCents}
        currencySymbol={currencySymbol}
      />
    </Card>
  );
}

function UnassignedHistoryCard({ data }: { data: UnassignedBreakdown }) {
  return (
    <Card
      className={styles.breakdownCard}
      style={{ borderLeft: "4px solid var(--gray-8)" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <History size={16} style={{ color: "var(--gray-11)" }} />
          <Text size="2" weight="bold">Unassigned history</Text>
        </div>
        <Badge variant="soft" color="gray" size="1">
          Legacy / unattributed
        </Badge>
      </div>
      <Text size="1" color="gray">
        Included in the global totals but not linked to a configured vehicle.
      </Text>
      <div className={styles.breakdownRow}>
        <Text size="2" color="gray" className={styles.breakdownLabel}>
          Total Charged
        </Text>
        <Text size="2" className={styles.breakdownValue}>
          {kwhValue(data.totalChargedWh)}
        </Text>
        <Text size="2" className={styles.breakdownPct} />
      </div>
      <SourceRows
        solarWh={data.totalSolarWh}
        batteryWh={data.totalBatteryWh}
        gridWh={data.totalGridWh}
        awayWh={data.totalAwayWh}
      />
    </Card>
  );
}

function VehicleCards({
  data,
  breakdowns,
  unassignedBreakdown,
  hasConfiguredVehicles,
  loading,
  currencySymbol,
}: {
  data: StatsViewResponse | null;
  breakdowns: VehicleBreakdown[];
  unassignedBreakdown: UnassignedBreakdown | null;
  hasConfiguredVehicles: boolean;
  loading: boolean;
  currencySymbol: string;
}) {
  if (loading) return null;
  if (breakdowns.length > 0 || unassignedBreakdown) {
    return (
      <>
        {breakdowns.map((vehicle) => (
          <VehicleChargingCard
            key={vehicle.vehicleId}
            title={vehicle.vehicleName}
            exteriorColor={vehicle.exteriorColor}
            homeChargingSource={vehicle.homeChargingSource}
            solarWh={vehicle.totalSolarWh}
            batteryWh={vehicle.totalBatteryWh}
            gridWh={vehicle.totalGridWh}
            awayWh={vehicle.totalAwayWh}
            costCents={vehicle.totalCostCents}
            solarSavingsCents={vehicle.evSolarSavingsCents}
            currencySymbol={currencySymbol}
          />
        ))}
        {unassignedBreakdown && (
          <UnassignedHistoryCard data={unassignedBreakdown} />
        )}
      </>
    );
  }
  if (hasConfiguredVehicles || !data || data.totalChargedWh <= 0) return null;
  return (
    <VehicleChargingCard
      title="Vehicle Charging"
      exteriorColor={null}
      homeChargingSource={null}
      solarWh={data.totalSolarWh}
      batteryWh={data.totalBatteryWh}
      gridWh={data.totalGridWh}
      awayWh={data.totalAwayWh}
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
      unassignedBreakdown={breakdown.unassignedBreakdown}
      hasConfiguredVehicles={breakdown.hasConfiguredVehicles}
      loading={breakdown.vehicleBreakdownsLoading}
      currencySymbol={breakdown.currencySymbol}
    />
  );
}
