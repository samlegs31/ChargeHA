import { type KeyboardEvent, useEffect, useState } from "react";
import { Text } from "@radix-ui/themes";
import styles from "./VehicleCard.module.css";

const MIN_CHARGE_LIMIT = 50;
const MAX_CHARGE_LIMIT = 100;
const COMMIT_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

interface VehicleBatterySectionProps {
  batteryPercent: number;
  chargeLimitPercent: number;
  isCharging: boolean;
  isPluggedIn: boolean;
  disabled: boolean;
  onSetChargeLimit?: (percent: number) => Promise<void>;
}

function normalizeChargeLimit(percent: number): number {
  return Math.max(
    MIN_CHARGE_LIMIT,
    Math.min(MAX_CHARGE_LIMIT, Math.round(percent)),
  );
}

export function VehicleBatterySection({
  batteryPercent,
  chargeLimitPercent,
  isCharging,
  isPluggedIn,
  disabled,
  onSetChargeLimit,
}: VehicleBatterySectionProps) {
  const normalizedLimit = normalizeChargeLimit(chargeLimitPercent);
  const [draftLimit, setDraftLimit] = useState(normalizedLimit);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    setDraftLimit(normalizedLimit);
    setDirty(false);
  }, [normalizedLimit]);

  const interactive = isPluggedIn && onSetChargeLimit !== undefined;
  const displayedLimit = interactive ? draftLimit : normalizedLimit;

  const commitLimit = async () => {
    if (!interactive || disabled || saving || !dirty) return;
    if (draftLimit === normalizedLimit) {
      setDirty(false);
      return;
    }

    setSaving(true);
    setSaveError(false);
    try {
      await onSetChargeLimit(draftLimit);
      setDirty(false);
    } catch {
      setDraftLimit(normalizedLimit);
      setDirty(false);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    if (COMMIT_KEYS.has(event.key)) void commitLimit();
  };

  return (
    <div className={styles.batterySection}>
      <div className={styles.batteryTop}>
        <div>
          <div className={styles.batteryPercent}>{batteryPercent}%</div>
          <Text size="1" color="gray">Battery</Text>
        </div>
        <Text size="2" color="gray">
          Limit {displayedLimit}%{saving ? " · Saving…" : ""}
        </Text>
      </div>
      <div className={styles.batteryBar}>
        <div
          className={styles.batteryFill}
          style={{
            width: `${batteryPercent}%`,
            backgroundColor: isCharging
              ? "var(--color-charging)"
              : "var(--color-vehicle)",
          }}
        />
        {interactive
          ? (
            <input
              className={styles.chargeLimitSlider}
              type="range"
              min={MIN_CHARGE_LIMIT}
              max={MAX_CHARGE_LIMIT}
              step={1}
              value={draftLimit}
              disabled={disabled || saving}
              aria-label="Charge limit"
              aria-valuetext={`${draftLimit}%`}
              onChange={(event) => {
                setDraftLimit(Number(event.currentTarget.value));
                setDirty(true);
                setSaveError(false);
              }}
              onPointerUp={() => void commitLimit()}
              onKeyUp={handleKeyUp}
            />
          )
          : (
            <div
              className={styles.chargeLimitMarker}
              style={{ left: `${normalizedLimit}%` }}
            />
          )}
      </div>
      {saveError && (
        <Text size="1" color="red" className={styles.chargeLimitError}>
          Charge limit not changed
        </Text>
      )}
    </div>
  );
}
