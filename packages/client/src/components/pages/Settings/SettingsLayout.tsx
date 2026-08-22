import { useState } from "react";
import type { ReactNode } from "react";
import { Text, TextField } from "@radix-ui/themes";
import { Section } from "../../ui/Section.tsx";
import type { SectionProps } from "../../ui/Section.tsx";
import styles from "./SettingsLayout.module.css";

// Re-export Section as SettingsSection for backwards compatibility
export { Section as SettingsSection };
export type { SectionProps };

export interface SettingsRowProps {
  label: string;
  help?: string;
  children: ReactNode;
}

export function SettingsRow({
  label,
  help,
  children,
}: SettingsRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.copy}>
        <Text weight="medium" className={styles.label}>{label}</Text>
        {help && (
          <Text
            color="gray"
            className={styles.help}
          >
            {help}
          </Text>
        )}
      </div>
      <div className={styles.control}>
        {children}
      </div>
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  suffix,
  step = 1,
  min,
  max,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  suffix: string;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  const [localValue, setLocalValue] = useState(value);
  const [editing, setEditing] = useState(false);

  // Sync from parent when not editing (e.g. after save response)
  const displayValue = editing ? localValue : value;

  return (
    <div className={styles.numberInput}>
      <TextField.Root
        size="3"
        type="number"
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        value={displayValue}
        onFocus={() => {
          setLocalValue(value);
          setEditing(true);
        }}
        onChange={(e: { target: { value: string } }) => {
          setLocalValue(e.target.value);
          onChange(e.target.value);
        }}
        onBlur={() => {
          setEditing(false);
        }}
        className={styles.numberField}
      />
      <Text color="gray" className={styles.suffix}>{suffix}</Text>
    </div>
  );
}
