import type { ReactNode } from "react";
import { Battery, DollarSign, MapPin, Sun, Zap } from "lucide-react";
import { Badge, Card, Text } from "@radix-ui/themes";
import type {
  DayResolution,
  StatsViewPeriod,
  StatsViewResponse,
} from "../../../hooks/useStats.ts";
import {
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
        {exteriorColor && (
          <Text size="1" color="gray">{palette.label}</Text>
        )}
      </div>
      <Badge variant="soft" size="1">
        {homeSourceLabel(homeChargingSource)}
      </Badge>
    </div>
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
  const pct = sourcePercentages(solarWh, batteryWh, gridWh, awayWh);
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
      <EnergyBreakdownRow
        label="Home Solar"
        valueWh={solarWh}
        pct={pct.solar}
        color={palette.light}
        icon={<Sun size={16} style={{ color: palette.dark }} />}
      />
      <EnergyBreakdownRow
        label="Home Battery"
        valueWh={batteryWh}
        pct={pct.battery}
        color={palette.base}
        icon={<Battery size={16} style={{ color: palette.base }} />}
      />
      <EnergyBreakdownRow
        label="Home Grid"
        valueWh={gridWh}
        pct={pct.grid}
        color={palette.dark}
        icon={<Zap size={16} style={{ color: palette.dark }} />}
      />
      <EnergyBreakdownRow
        label="External"
        valueWh={awayWh}
        pct={pct.away}
        color={palette.strong}
        icon={<MapPin size={16} style={{ color: palette.strong }} />}
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
  data: StatsViewResponse | null;
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
      hasConfiguredVehicles={breakdown.hasConfiguredVehicles}
      loading={breakdown.vehicleBreakdownsLoading}
      currencySymbol={breakdown.currencySymbol}
    />
  );
}
