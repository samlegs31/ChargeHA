import { useState } from "react";
import type { ReactNode } from "react";
import { Text, TextField } from "@radix-ui/themes";
import { Section } from "../../ui/Section.tsx";
import type { SectionProps } from "../../ui/Section.tsx";

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
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "8px 16px",
        minHeight: 36,
      }}
    >
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <Text size="2" weight="medium">{label}</Text>
        {help && (
          <Text
            size="1"
            color="gray"
            style={{
              display: "block",
              marginTop: 2,
              lineHeight: 1.4,
              maxWidth: 680,
            }}
          >
            {help}
          </Text>
        )}
      </div>
      <div
        style={{
          flex: "0 1 auto",
          flexShrink: 0,
          marginLeft: "auto",
          maxWidth: "100%",
        }}
      >
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
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <TextField.Root
        size="2"
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
        style={{ width: 88 }}
      />
      <Text size="2" color="gray">{suffix}</Text>
    </div>
  );
}
