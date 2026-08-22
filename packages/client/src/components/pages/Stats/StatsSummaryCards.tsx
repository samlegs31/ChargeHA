import { BatteryMedium, Home, MapPin, Sun, Zap } from "lucide-react";
import { Card, Text } from "@radix-ui/themes";
import type { StatsViewResponse } from "../../../hooks/useStats.ts";
import { formatCost, kwhValue } from "../../../utils/Format.ts";
import styles from "./Stats.module.css";

interface StatsSummaryCardsProps {
  data: StatsViewResponse | null;
  loading: boolean;
}

function SourceMetric({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof Sun;
  tone: "solar" | "battery" | "grid";
}) {
  const Icon = icon;
  return (
    <div className={styles.sourceMetric} data-tone={tone}>
      <span className={styles.sourceIcon} aria-hidden="true">
        <Icon size={20} />
      </span>
      <span className={styles.sourceCopy}>
        <Text color="gray" className={styles.sourceLabel}>{label}</Text>
        <span className={styles.sourceValue}>{value}</span>
      </span>
    </div>
  );
}

function CompactMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Home;
}) {
  return (
    <div className={styles.compactMetric}>
      <span className={styles.compactLabel}>
        {Icon && <Icon size={18} aria-hidden="true" />}
        <Text color="gray">{label}</Text>
      </span>
      <span className={styles.compactValue}>{value}</span>
    </div>
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
      <Card className={styles.chargingOverview}>
        <div className={styles.solarShareOverview}>
          <span className={styles.heroIcon} aria-hidden="true">
            <Sun size={26} />
          </span>
          <div className={styles.heroCopy}>
            <Text weight="bold">Solar-powered charging</Text>
            <span className={styles.heroValue}>
              {loading ? "—" : `${share}%`}
            </span>
            <Text color="gray" className={styles.heroDescription}>
              {solarShareDescription(data, loading, share)}
            </Text>
          </div>
        </div>
        <div className={styles.overviewDivider} aria-hidden="true" />
        <div className={styles.totalOverview}>
          <Text color="gray" className={styles.totalLabel}>Total Charged</Text>
          <span className={styles.totalValue}>
            {loading ? "—" : kwhValue(data?.totalChargedWh ?? 0)}
          </span>
        </div>
      </Card>

      <Card
        className={styles.sourceSummary}
        aria-label="Charging energy sources"
      >
        <SourceMetric
          label="From Solar"
          value={loading ? "—" : kwhValue(data?.totalSolarWh ?? 0)}
          icon={Sun}
          tone="solar"
        />
        <SourceMetric
          label="From Battery"
          value={loading ? "—" : kwhValue(data?.totalBatteryWh ?? 0)}
          icon={BatteryMedium}
          tone="battery"
        />
        <SourceMetric
          label="From Grid"
          value={loading ? "—" : kwhValue(data?.totalGridWh ?? 0)}
          icon={Zap}
          tone="grid"
        />
      </Card>

      <Card className={styles.secondarySummary}>
        <CompactMetric
          label="Charged at Home"
          value={loading ? "—" : kwhValue(homeWh)}
          icon={Home}
        />
        <CompactMetric
          label="Away"
          value={loading ? "—" : kwhValue(data?.totalAwayWh ?? 0)}
          icon={MapPin}
        />
      </Card>

      {hasFinancialData && (
        <Card className={styles.costSummary}>
          <CompactMetric
            label="Grid Cost"
            value={formatCost(gridCostCents, currencySymbol)}
          />
          <CompactMetric
            label="Solar Savings"
            value={formatCost(solarSavingsCents, currencySymbol)}
          />
        </Card>
      )}
    </>
  );
}
