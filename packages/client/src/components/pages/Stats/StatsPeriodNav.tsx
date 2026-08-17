import { ChevronLeft, ChevronRight } from "lucide-react";
import { SegmentedControl, Text } from "@radix-ui/themes";
import type { StatsViewPeriod } from "../../../hooks/useStats.ts";
import styles from "./Stats.module.css";

interface StatsPeriodNavProps {
  period: StatsViewPeriod;
  setPeriod: (p: StatsViewPeriod) => void;
  cursorLabel: string;
  isAtPresent: boolean;
  goBack: () => void;
  goForward: () => void;
  goToToday: () => void;
}

export function StatsPeriodNav({
  period,
  setPeriod,
  cursorLabel,
  isAtPresent,
  goBack,
  goForward,
  goToToday,
}: StatsPeriodNavProps) {
  const isTotal = period === "total";
  return (
    <>
      <div className={styles.periodToggle}>
        <SegmentedControl.Root
          value={period}
          onValueChange={(value) => setPeriod(value as StatsViewPeriod)}
          size="2"
        >
          <SegmentedControl.Item value="day">Day</SegmentedControl.Item>
          <SegmentedControl.Item value="month">Month</SegmentedControl.Item>
          <SegmentedControl.Item value="year">Year</SegmentedControl.Item>
          <SegmentedControl.Item value="total">Total</SegmentedControl.Item>
        </SegmentedControl.Root>
      </div>

      <div className={styles.dateNav}>
        {isTotal
          ? <span aria-hidden="true" />
          : (
            <button
              type="button"
              onClick={goBack}
              aria-label="Previous period"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
                color: "var(--gray-11)",
              }}
            >
              <ChevronLeft size={20} />
            </button>
          )}
        <Text
          size="3"
          weight="medium"
          className={styles.dateLabel}
          onClick={isTotal ? undefined : goToToday}
          style={isTotal ? { cursor: "default" } : undefined}
        >
          {cursorLabel}
        </Text>
        {isTotal
          ? <span aria-hidden="true" />
          : (
            <button
              type="button"
              onClick={goForward}
              disabled={isAtPresent}
              aria-label="Next period"
              style={{
                background: "none",
                border: "none",
                cursor: isAtPresent ? "default" : "pointer",
                padding: 4,
                color: isAtPresent ? "var(--gray-6)" : "var(--gray-11)",
              }}
            >
              <ChevronRight size={20} />
            </button>
          )}
      </div>
    </>
  );
}
