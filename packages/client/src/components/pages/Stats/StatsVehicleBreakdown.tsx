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
  const pct = raw.map(Math.floor);
  let remaining = 100 - pct.reduce((sum, value) => sum + value, 0);

  const order = raw
    .map((value, index) => ({
      index,
      fraction: value - pct[index],
    }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; i < remaining; i++) {
    pct[order[i].index]++;
  }

  return {
    solarPct: pct[0],
    batteryPct: pct[1],
    gridPct: pct[2],
  };
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
  const hasCost = (costCents ?? 0) > 0 || (evSolarSavingsCents ?? 0) > 0;

  return (
    <Card className={styles.breakdownCard}>
      <Text size="2" weight="bold">
        {title}
      </Text>
      <div className={styles.breakdownRow}>
        <Text size="2" color="gray" className={styles.breakdownLabel}>
          Total Charged
        </Text>
        <Text size="2" className={styles.breakdownValue}>
          {kwhValue(totalChargedWh)}
        </Text>
        <Text size="2" className={styles.breakdownPct} />
      </div>
      <div className={styles.breakdownRow}>
        <div
          className={styles.breakdownIcon}
          style={{ backgroundColor: "var(--color-solar-car)" }}
        />
        <Sun size={16} style={{ color: "var(--color-solar-car)" }} />
        <Text size="2" className={styles.breakdownLabel}>
          From Solar
        </Text>
        <Text size="2" className={styles.breakdownValue}>
          {kwhValue(solarWh)}
        </Text>
        <Text size="2" color="gray" className={styles.breakdownPct}>
          {solarPct}%
        </Text>
      </div>
      <div className={styles.breakdownRow}>
        <div
          className={styles.breakdownIcon}
          style={{ backgroundColor: "var(--color-battery)" }}
        />
        <Battery size={16} style={{ color: "var(--color-battery)" }} />
        <Text size="2" className={styles.breakdownLabel}>
          From Battery
        </Text>
        <Text size="2" className={styles.breakdownValue}>
          {kwhValue(batteryWh)}
        </Text>
        <Text size="2" color="gray" className={styles.breakdownPct}>
          {batteryPct}%
        </Text>
      </div>
      <div className={styles.breakdownRow}>
        <div
          className={styles.breakdownIcon}
          style={{ backgroundColor: "var(--color-grid-car)" }}
        />
        <Zap size={16} style={{ color: "var(--color-grid-car)" }} />
        <Text size="2" className={styles.breakdownLabel}>
          From Grid
        </Text>
        <Text size="2" className={styles.breakdownValue}>
          {kwhValue(gridWh)}
        </Text>
        <Text size="2" color="gray" className={styles.breakdownPct}>
          {gridPct}%
        </Text>
      </div>
      {awayWh != null && awayWh > 0 && (
        <div className={styles.breakdownRow}>
          <div
            className={styles.breakdownIcon}
            style={{ backgroundColor: "var(--color-away)" }}
          />
          <MapPin size={16} style={{ color: "var(--color-away)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            Away
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(awayWh)}
          </Text>
          <Text size="2" color="gray" className={styles.breakdownPct}>
            {totalChargedWh > 0
              ? `${Math.round((awayWh / totalChargedWh) * 100)}%`
              : "0%"}
          </Text>
        </div>
      )}
      {hasCost && (
        <>
          <div className={styles.breakdownRow}>
            <div
              className={styles.breakdownIcon}
              style={{ backgroundColor: "transparent" }}
            />
            <DollarSign size={16} style={{ color: "var(--gray-11)" }} />
            <Text size="2" className={styles.breakdownLabel}>
              Cost
            </Text>
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
      )}
    </Card>
  );
}

export function StatsVehicleBreakdown(
  { data, loading, period, cursor, resolution }: StatsVehicleBreakdownProps,
) {
  const {
    hasChargeData,
    hasConfiguredVehicles,
    vehicleBreakdownsLoading,
    currencySymbol,
    activeVehicleBreakdowns,
  } = useVehicleBreakdowns({ data, loading, period, cursor, resolution });

  const { solarPct, batteryPct, gridPct } = energySourcePercentages(
    data?.homeSolarWh ?? 0,
    data?.homeBatteryDischargeWh ?? 0,
    data?.homeGridWh ?? 0,
  );

  return (
    <>
      {/* Energy source breakdown */}
      <Card className={styles.breakdownCard}>
        <Text size="2" weight="bold">
          Energy Sources
        </Text>
        <div className={styles.breakdownRow}>
          <div
            className={styles.breakdownIcon}
            style={{ backgroundColor: "var(--color-solar)" }}
          />
          <Sun size={16} style={{ color: "var(--color-solar)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            From Solar
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(data?.homeSolarWh ?? 0)}
          </Text>
          <Text size="2" color="gray" className={styles.breakdownPct}>
            {solarPct}%
          </Text>
        </div>
        <div className={styles.breakdownRow}>
          <div
            className={styles.breakdownIcon}
            style={{ backgroundColor: "var(--color-battery)" }}
          />
          <Battery size={16} style={{ color: "var(--color-battery)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            From Battery
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(data?.homeBatteryDischargeWh ?? 0)}
          </Text>
          <Text size="2" color="gray" className={styles.breakdownPct}>
            {batteryPct}%
          </Text>
        </div>
        <div className={styles.breakdownRow}>
          <div
            className={styles.breakdownIcon}
            style={{ backgroundColor: "var(--color-grid-import)" }}
          />
          <Zap size={16} style={{ color: "var(--color-grid-import)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            From Grid
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(data?.homeGridWh ?? 0)}
          </Text>
          <Text size="2" color="gray" className={styles.breakdownPct}>
            {gridPct}%
          </Text>
        </div>
      </Card>

      {/* Home battery energy breakdown */}
      <Card className={styles.breakdownCard}>
        <Text size="2" weight="bold">
          Home Battery
        </Text>

        <div className={styles.breakdownRow}>
          <Battery size={16} style={{ color: "var(--color-battery)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            Energy Charged
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(data?.homeBatteryChargeWh ?? 0)}
          </Text>
          <Text size="2" className={styles.breakdownPct} />
        </div>

        <div className={styles.breakdownRow}>
          <Sun size={16} style={{ color: "var(--color-solar)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            Solar → Battery
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(data?.homeSolarToBatteryWh ?? 0)}
          </Text>
          <Text size="2" className={styles.breakdownPct} />
        </div>

        <div className={styles.breakdownRow}>
          <Zap size={16} style={{ color: "var(--color-grid-battery)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            Grid → Battery
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(data?.homeGridToBatteryWh ?? 0)}
          </Text>
          <Text size="2" className={styles.breakdownPct} />
        </div>

        <div className={styles.breakdownRow}>
          <Battery size={16} style={{ color: "var(--color-battery)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            Energy Discharged
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(data?.homeBatteryDischargeWh ?? 0)}
          </Text>
          <Text size="2" className={styles.breakdownPct} />
        </div>

        <div className={styles.breakdownRow}>
          <Battery size={16} style={{ color: "var(--color-battery)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            Battery → Home
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(
              Math.max(
                0,
                (data?.homeBatteryDischargeWh ?? 0) -
                  (data?.totalBatteryWh ?? 0),
              ),
            )}
          </Text>
          <Text size="2" className={styles.breakdownPct} />
        </div>

        <div className={styles.breakdownRow}>
          <Battery size={16} style={{ color: "var(--color-battery)" }} />
          <Text size="2" className={styles.breakdownLabel}>
            Battery → Car
          </Text>
          <Text size="2" className={styles.breakdownValue}>
            {kwhValue(data?.totalBatteryWh ?? 0)}
          </Text>
          <Text size="2" className={styles.breakdownPct} />
        </div>
      </Card>

      {/* Per-vehicle charging cards — one card per vehicle */}
      {hasChargeData && activeVehicleBreakdowns.length > 0 &&
        activeVehicleBreakdowns.map((vb: VehicleBreakdown) => (
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
      {hasChargeData &&
        !vehicleBreakdownsLoading &&
        !hasConfiguredVehicles &&
        activeVehicleBreakdowns.length === 0 && (
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
