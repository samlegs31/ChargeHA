import { Card, Text } from "@radix-ui/themes";
import { useStats } from "../../../hooks/useStats.ts";
import { StatsPeriodNav } from "./StatsPeriodNav.tsx";
import { StatsSummaryCards } from "./StatsSummaryCards.tsx";
import { StatsChart } from "./StatsChart.tsx";
import { StatsVehicleBreakdown } from "./StatsVehicleBreakdown.tsx";
import styles from "./Stats.module.css";

function StatsError({ message }: { message: string }) {
  return (
    <Card>
      <Text color="red" size="2">
        Stats could not be loaded: {message}
      </Text>
    </Card>
  );
}

export function Stats() {
  const {
    period,
    setPeriod,
    resolution,
    setResolution,
    cursor,
    cursorLabel,
    isAtPresent,
    data,
    loading,
    error,
    goBack,
    goForward,
    goToToday,
    drillDown,
  } = useStats();

  return (
    <div className={styles.stats}>
      <StatsPeriodNav
        period={period}
        setPeriod={setPeriod}
        cursorLabel={cursorLabel}
        isAtPresent={isAtPresent}
        goBack={goBack}
        goForward={goForward}
        goToToday={goToToday}
      />

      {error && <StatsError message={error} />}
      {!error && (
        <>
          <StatsSummaryCards data={data} loading={loading} />

          <StatsChart
            data={data}
            loading={loading}
            period={period}
            resolution={resolution}
            setResolution={setResolution}
            dateCursor={cursor}
            onDrillDown={drillDown}
          />

          <StatsVehicleBreakdown
            data={data}
            loading={loading}
            period={period}
            cursor={cursor}
            resolution={resolution}
          />
        </>
      )}
    </div>
  );
}
