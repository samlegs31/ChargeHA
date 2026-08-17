import { useCallback, useMemo } from "react";
import { Card, SegmentedControl, Text } from "@radix-ui/themes";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  StatsPeriod,
  StatsResponse,
  VehicleSocSnapshot,
} from "@chargeha/shared";
import type { DayResolution } from "../../../hooks/useStats.ts";
import { formatCost } from "../../../utils/Format.ts";
import styles from "./Stats.module.css";

const MONTH_ABBRS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const FLOW_KEYS = ["solarToCar", "batteryToCar", "gridToCar"] as const;

const FLOW_COLORS: Record<(typeof FLOW_KEYS)[number], string> = {
  solarToCar: "var(--color-solar-car)",
  batteryToCar: "var(--color-battery-car)",
  gridToCar: "var(--color-grid-car)",
};

const FLOW_NAMES: Record<(typeof FLOW_KEYS)[number], string> = {
  solarToCar: "Solar → Car",
  batteryToCar: "Battery → Car",
  gridToCar: "Grid → Car",
};

interface ChartDatum {
  label: string;
  solarToCar: number;
  batteryToCar: number;
  gridToCar: number;
  costCents: number;
  vehicleSoc: VehicleSocSnapshot[];
}

interface StatsChartProps {
  data: StatsResponse | null;
  loading: boolean;
  period: StatsPeriod;
  resolution: DayResolution;
  setResolution: (r: DayResolution) => void;
  dateCursor: Date;
  onDrillDown: (period: StatsPeriod, date: Date) => void;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
  label?: string;
  period: StatsPeriod;
  resolution: DayResolution;
  dateCursor: Date;
  currencySymbol: string;
}

function roundKwh(wh: number): number {
  return Math.round((wh / 1000) * 100) / 100;
}

function bucketLabel(
  label: string,
  period: StatsPeriod,
  resolution: DayResolution,
): string {
  if (period !== "day" || resolution === "15m") return label;
  return `${label}:00`;
}

function buildBucketDatum(
  bucket: NonNullable<StatsChartProps["data"]>["buckets"][number],
  period: StatsPeriod,
  resolution: DayResolution,
  vehicleSoc: VehicleSocSnapshot[] | undefined,
): ChartDatum {
  return {
    label: bucketLabel(bucket.label, period, resolution),
    solarToCar: roundKwh(bucket.solarWh ?? 0),
    batteryToCar: roundKwh(bucket.batteryWh ?? 0),
    gridToCar: roundKwh(bucket.gridWh ?? 0),
    costCents: bucket.costCents ?? 0,
    vehicleSoc: vehicleSoc ?? [],
  };
}

function buildHeaderLabel(
  label: string,
  period: StatsPeriod,
  resolution: DayResolution,
  cursor: Date,
): string {
  if (period === "month") {
    const day = parseInt(label, 10);
    const date = new Date(cursor.getFullYear(), cursor.getMonth(), day);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  if (period === "year") return label;
  if (!label) return "";
  if (resolution !== "15m") {
    const hour = parseInt(label, 10);
    return `${String(hour).padStart(2, "0")}:00 – ${
      String(hour + 1).padStart(2, "0")
    }:00`;
  }
  const [hh, mm] = label.split(":");
  const endMinutes = parseInt(mm, 10) + 15;
  const endHour = parseInt(hh, 10) + Math.floor(endMinutes / 60);
  return `${hh}:${mm} – ${String(endHour).padStart(2, "0")}:${
    String(endMinutes % 60).padStart(2, "0")
  }`;
}

function CustomTooltip(props: CustomTooltipProps) {
  if (!props.active || !props.payload?.length) return null;
  const datum = props.payload[0]?.payload;
  if (!datum) return null;
  const header = buildHeaderLabel(
    props.label ?? "",
    props.period,
    props.resolution,
    props.dateCursor,
  );

  return (
    <div className={styles.customTooltip}>
      <div className={styles.tooltipHeader}>{header}</div>
      {FLOW_KEYS.map((key) => {
        const value = datum[key];
        if (value <= 0) return null;
        return (
          <div key={key} className={styles.tooltipRow}>
            <span
              className={styles.tooltipSwatch}
              style={{ backgroundColor: FLOW_COLORS[key] }}
            />
            <span className={styles.tooltipLabel}>{FLOW_NAMES[key]}</span>
            <span className={styles.tooltipValue}>{value.toFixed(2)} kWh</span>
          </div>
        );
      })}
      {datum.costCents > 0 && (
        <div className={styles.tooltipCostRow}>
          Grid cost {formatCost(datum.costCents, props.currencySymbol)}
        </div>
      )}
      {datum.vehicleSoc.length > 0 && (
        <>
          <div className={styles.tooltipDivider} />
          {datum.vehicleSoc.map((vehicle) => (
            <div key={vehicle.vehicleId} className={styles.tooltipRow}>
              <span className={styles.tooltipSocIcon}>🔋</span>
              <span className={styles.tooltipLabel}>{vehicle.vehicleName}</span>
              <span className={styles.tooltipValue}>{vehicle.batteryLevel}%</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function computeTickInterval(
  period: StatsPeriod,
  resolution: DayResolution,
): number {
  if (period === "day") return resolution === "15m" ? 11 : 2;
  if (period === "month") return 4;
  return 0;
}

function useChartClickHandler(
  period: StatsPeriod,
  dateCursor: Date,
  onDrillDown: (period: StatsPeriod, date: Date) => void,
) {
  return useCallback((event: { activeLabel?: string }) => {
    if (!event.activeLabel) return;
    if (period === "month") {
      const day = parseInt(event.activeLabel, 10);
      if (!isNaN(day)) {
        onDrillDown(
          "day",
          new Date(dateCursor.getFullYear(), dateCursor.getMonth(), day),
        );
      }
      return;
    }
    if (period !== "year") return;
    const monthIndex = MONTH_ABBRS.indexOf(event.activeLabel);
    if (monthIndex < 0) return;
    onDrillDown("month", new Date(dateCursor.getFullYear(), monthIndex, 1));
  }, [period, dateCursor, onDrillDown]);
}

function ChartLegend() {
  return (
    <div className={styles.legend}>
      {FLOW_KEYS.map((key) => (
        <span key={key} className={styles.legendItem}>
          <span
            className={styles.legendSwatch}
            style={{ backgroundColor: FLOW_COLORS[key] }}
          />
          {FLOW_NAMES[key]}
        </span>
      ))}
    </div>
  );
}

function chartBars() {
  return (
    <>
      <Bar
        dataKey="solarToCar"
        stackId="charging"
        fill="var(--color-solar-car)"
        name="solarToCar"
      />
      <Bar
        dataKey="batteryToCar"
        stackId="charging"
        fill="var(--color-battery-car)"
        name="batteryToCar"
      />
      <Bar
        dataKey="gridToCar"
        stackId="charging"
        fill="var(--color-grid-car)"
        name="gridToCar"
        radius={[2, 2, 0, 0]}
      />
    </>
  );
}

export function StatsChart({
  data,
  loading,
  period,
  resolution,
  setResolution,
  dateCursor,
  onDrillDown,
}: StatsChartProps) {
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.buckets.map((bucket, index) =>
      buildBucketDatum(
        bucket,
        period,
        resolution,
        data.vehicleSoc?.[index],
      )
    );
  }, [data, period, resolution]);
  const canDrillDown = period === "month" || period === "year";
  const handleChartClick = useChartClickHandler(
    period,
    dateCursor,
    onDrillDown,
  );

  return (
    <Card className={styles.chartCard}>
      {period === "day" && (
        <div className={styles.resolutionToggle}>
          <SegmentedControl.Root
            value={resolution}
            onValueChange={(value) => setResolution(value as DayResolution)}
            size="1"
          >
            <SegmentedControl.Item value="1h">1h</SegmentedControl.Item>
            <SegmentedControl.Item value="15m">15m</SegmentedControl.Item>
          </SegmentedControl.Root>
        </div>
      )}
      <div className={styles.chartWrapper}>
        {loading && (
          <div className={styles.chartPlaceholder}>
            <Text color="gray">Loading…</Text>
          </div>
        )}
        {!loading && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              onClick={canDrillDown ? handleChartClick : undefined}
              style={canDrillDown ? { cursor: "pointer" } : undefined}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12 }}
                interval={computeTickInterval(period, resolution)}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(value: number) => `${value} kWh`}
                width={70}
              />
              <Tooltip
                content={
                  <CustomTooltip
                    period={period}
                    resolution={resolution}
                    dateCursor={dateCursor}
                    currencySymbol={data?.currencySymbol ?? "$"}
                  />
                }
              />
              {chartBars()}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <ChartLegend />
    </Card>
  );
}
