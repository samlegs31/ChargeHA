import { Moon } from "lucide-react";
import { Skeleton } from "@radix-ui/themes";
import { trpc } from "../../../trpc.ts";
import styles from "./OffPeakStatus.module.css";

function isOffPeakLabel(label: string | undefined): boolean {
  return /off[\s-]?peak/i.test(label ?? "");
}

function formatClock(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function OffPeakStatus() {
  const { data, isLoading } = trpc.tariff.currentRate.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className={styles.card} aria-label="Off-Peak loading">
        <Skeleton width="100%" height="54px" />
      </div>
    );
  }

  if (!data) {
    return (
      <section
        className={styles.card}
        data-active="false"
        aria-label="Off-Peak not configured"
      >
        <span className={styles.icon} aria-hidden="true">
          <Moon size={20} />
        </span>
        <span className={styles.copy}>
          <strong>Off-Peak</strong>
          <span>Not configured</span>
        </span>
        <span className={styles.state}>Inactive</span>
      </section>
    );
  }

  const active = isOffPeakLabel(data.label);
  const nextIsOffPeak = isOffPeakLabel(data.nextRate?.label);
  const timing = active && data.nextRate
    ? `Until ${formatClock(data.nextRate.startsAt)}`
    : !active && nextIsOffPeak && data.nextRate
    ? `Starts ${formatClock(data.nextRate.startsAt)}`
    : data.label;

  return (
    <section
      className={styles.card}
      data-active={active}
      aria-label={`Off-Peak ${active ? "active" : "inactive"}`}
      data-testid="off-peak-status"
    >
      <span className={styles.icon} aria-hidden="true">
        <Moon size={20} />
      </span>
      <span className={styles.copy}>
        <strong>Off-Peak</strong>
        <span>{timing}</span>
      </span>
      <span className={styles.state}>{active ? "Active" : "Inactive"}</span>
    </section>
  );
}
