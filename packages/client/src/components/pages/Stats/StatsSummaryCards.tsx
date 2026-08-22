import type { ReactNode } from "react";
import { BatteryMedium, Home, MapPin, Sun, Zap } from "lucide-react";
import { Card, Text } from "@radix-ui/themes";
import type { StatsViewResponse } from "../../../hooks/useStats.ts";
import { formatCost, kwhValue } from "../../../utils/Format.ts";
import styles from "./Stats.module.css";

interface StatsSummaryCardsProps {
  data: StatsViewResponse | null;
  loading: boolean;
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: "solar" | "battery" | "grid";
}) {
  return (
    <Card
      className={styles.summaryCard}
      data-tone={tone}
    >
      <span className={styles.summaryLabel}>
        {icon}
        <Text size="3" color="gray">{label}</Text>
      </span>
      <span className={styles.summaryValue}>{value}</span>
    </Card>
  );
}

function homeChargedWh(data: StatsViewResponse | null): number {
  return (data?.totalSolarWh ?? 0) +
    (data?.totalBatteryWh ?? 0) +
    (data?.totalGridWh ?? 0);
}

function solarShare(data: StatsViewResponse | null): number {
  const totalWh = homeChargedWh(data);
  if (totalWh <= 0) return 0;
  return Math.round(((data?.totalSolarWh ?? 0) / totalWh) * 100);
}

function solarShareDescription(
  data: StatsViewResponse | null,
  loading: boolean,
  share: number,
): string {
  if (loading) return "Calculating your solar share…";
  if (share <= 0) {
    return "No direct solar charging recorded for this period.";
  }
  return `${
    kwhValue(data?.totalSolarWh ?? 0)
  } of your home charging came directly from solar.`;
}

export function StatsSummaryCards({ data, loading }: StatsSummaryCardsProps) {
  const currencySymbol = data?.currencySymbol ?? "$";
  const gridCostCents = data?.totalCostCents ?? 0;
  const solarSavingsCents = data?.evSolarSavingsCents ?? 0;
  const hasFinancialData = gridCostCents > 0 || solarSavingsCents > 0;
  const homeWh = homeChargedWh(data);
  const share = solarShare(data);

  return (
    <>
      <div className={styles.summaryHero}>
        <Card className={styles.solarShareCard}>
          <span className={styles.heroIcon} aria-hidden="true">
            <Sun size={30} />
          </span>
          <div className={styles.heroCopy}>
            <Text size="3" weight="bold">Solar-powered charging</Text>
            <span className={styles.heroValue}>
              {loading ? "—" : `${share}%`}
            </span>
            <Text size="3" color="gray">
              {solarShareDescription(data, loading, share)}
            </Text>
          </div>
        </Card>
        <SummaryCard
          label="Total Charged"
          value={loading ? "—" : kwhValue(data?.totalChargedWh ?? 0)}
        />
      </div>

      <div
        className={styles.sourceSummary}
        aria-label="Charging energy sources"
      >
        <SummaryCard
          label="From Solar"
          value={loading ? "—" : kwhValue(data?.totalSolarWh ?? 0)}
          icon={<Sun size={22} aria-hidden="true" />}
          tone="solar"
        />
        <SummaryCard
          label="From Battery"
          value={loading ? "—" : kwhValue(data?.totalBatteryWh ?? 0)}
          icon={<BatteryMedium size={22} aria-hidden="true" />}
          tone="battery"
        />
        <SummaryCard
          label="From Grid"
          value={loading ? "—" : kwhValue(data?.totalGridWh ?? 0)}
          icon={<Zap size={22} aria-hidden="true" />}
          tone="grid"
        />
      </div>

      <div className={styles.secondarySummary}>
        <SummaryCard
          label="Charged at Home"
          value={loading ? "—" : kwhValue(homeWh)}
          icon={<Home size={22} aria-hidden="true" />}
        />
        <SummaryCard
          label="Away"
          value={loading ? "—" : kwhValue(data?.totalAwayWh ?? 0)}
          icon={<MapPin size={22} aria-hidden="true" />}
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
