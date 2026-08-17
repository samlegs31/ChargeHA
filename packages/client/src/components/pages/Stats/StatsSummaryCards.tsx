import { Card, Text } from "@radix-ui/themes";
import type { StatsViewResponse } from "../../../hooks/useStats.ts";
import { formatCost, kwhValue } from "../../../utils/Format.ts";
import styles from "./Stats.module.css";

interface StatsSummaryCardsProps {
  data: StatsViewResponse | null;
  loading: boolean;
}

function SummaryCard(
  { label, value }: { label: string; value: React.ReactNode },
) {
  return (
    <Card className={styles.summaryCard}>
      <Text size="2" color="gray">{label}</Text>
      <span className={styles.summaryValue}>{value}</span>
    </Card>
  );
}

function solarShare(data: StatsViewResponse | null): number {
  const totalWh = data?.totalChargedWh ?? 0;
  if (totalWh <= 0) return 0;
  return Math.round(((data?.totalSolarWh ?? 0) / totalWh) * 100);
}

export function StatsSummaryCards({ data, loading }: StatsSummaryCardsProps) {
  const currencySymbol = data?.currencySymbol ?? "$";
  const gridCostCents = data?.totalCostCents ?? 0;
  const solarSavingsCents = data?.evSolarSavingsCents ?? 0;
  const hasFinancialData = gridCostCents > 0 || solarSavingsCents > 0;

  return (
    <>
      <div className={styles.summary}>
        <SummaryCard
          label="Charged at Home"
          value={loading ? "—" : kwhValue(data?.totalChargedWh ?? 0)}
        />
        <SummaryCard
          label="From Solar"
          value={loading ? "—" : kwhValue(data?.totalSolarWh ?? 0)}
        />
        <SummaryCard
          label="From Battery"
          value={loading ? "—" : kwhValue(data?.totalBatteryWh ?? 0)}
        />
        <SummaryCard
          label="From Grid"
          value={loading ? "—" : kwhValue(data?.totalGridWh ?? 0)}
        />
        <SummaryCard
          label="Solar Share"
          value={loading ? "—" : `${solarShare(data)}%`}
        />
      </div>

      {hasFinancialData && (
        <div className={styles.costSummary}>
          <SummaryCard
            label="Grid Cost"
            value={formatCost(gridCostCents, currencySymbol)}
          />
          <SummaryCard
            label="Solar Savings"
            value={formatCost(solarSavingsCents, currencySymbol)}
          />
        </div>
      )}
    </>
  );
}
