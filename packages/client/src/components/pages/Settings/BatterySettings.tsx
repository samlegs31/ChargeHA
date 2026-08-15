import { Battery, CheckCircle } from "lucide-react";
import { Badge, Slider, Switch, Text } from "@radix-ui/themes";
import {
  useBatteryConfig,
  useBatteryConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import { useEnergyData } from "../../../hooks/useEnergyData.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";

interface ProtectionSliderProps {
  label: string;
  help: string;
  enabled: boolean;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}

function ProtectionSlider({
  label,
  help,
  enabled,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: ProtectionSliderProps) {
  return (
    <SettingsRow label={label} help={help}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 200,
          opacity: enabled ? 1 : 0.4,
          pointerEvents: enabled ? "auto" : "none",
        }}
      >
        <Slider
          min={min}
          max={max}
          step={step}
          disabled={!enabled}
          value={[value]}
          onValueChange={([nextValue]) => onChange(nextValue)}
          style={{ flex: 1 }}
        />
        <Text
          size="2"
          weight="medium"
          style={{ minWidth: 58, textAlign: "right" }}
        >
          {value} {unit}
        </Text>
      </div>
    </SettingsRow>
  );
}

export function BatterySettings() {
  const { data: config } = useBatteryConfig();
  const mutation = useBatteryConfigMutation();
  const { fields, setField, isDirty, save, saveStatus } = useDraftConfig(
    config,
    mutation,
  );
  const { data: energyData } = useEnergyData();
  const currentEnergy = energyData?.realtime ?? null;

  if (!fields) return null;

  const batteryActionBadge = (() => {
    if (currentEnergy?.batterySoc != null) {
      return (
        <Badge color="green" variant="soft" size="1">
          <CheckCircle size={12} /> Detected —{" "}
          {Math.round(currentEnergy.batterySoc)}%
        </Badge>
      );
    }
    return <Badge color="gray" variant="soft" size="1">Not detected</Badge>;
  })();

  return (
    <SettingsSection
      icon={<Battery size={18} />}
      title="Battery"
      badge="Beta"
      description="Protect your home-battery reserve during unscheduled solar EV charging. E.V Solar only decides whether the EV may charge; it never controls the home battery itself."
      saveStatus={saveStatus}
      isDirty={isDirty}
      onSave={save}
      action={batteryActionBadge}
    >
      <SettingsRow
        label="Home battery protection"
        help="Applies only to solar charging outside an active schedule. Scheduled charging continues at its programmed current."
      >
        <Switch
          size="2"
          checked={fields.batteryPriorityEnabled}
          onCheckedChange={(v) => setField("batteryPriorityEnabled", v)}
        />
      </SettingsRow>

      <SettingsRow
        label="Minimum home battery SOC"
        help="Below this reserve, unscheduled solar EV charging will not start or continue."
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 200,
            opacity: fields.batteryPriorityEnabled ? 1 : 0.4,
            pointerEvents: fields.batteryPriorityEnabled ? "auto" : "none",
          }}
        >
          <Slider
            min={20}
            max={100}
            step={5}
            disabled={!fields.batteryPriorityEnabled}
            value={[fields.batteryPriorityLimit]}
            onValueChange={([v]) => setField("batteryPriorityLimit", v)}
            style={{ flex: 1 }}
          />
          <Text
            size="2"
            weight="medium"
            style={{ minWidth: 40, textAlign: "right" }}
          >
            {fields.batteryPriorityLimit}%
          </Text>
        </div>
      </SettingsRow>

      <ProtectionSlider
        label="Tolerated battery discharge"
        help="EV charging may continue while home-battery discharge stays at or below this power. Set 0 W for the strictest protection."
        enabled={fields.batteryPriorityEnabled}
        value={fields.batteryDischargeToleranceW}
        min={0}
        max={5000}
        step={100}
        unit="W"
        onChange={(value) => setField("batteryDischargeToleranceW", value)}
      />

      <ProtectionSlider
        label="Battery discharge grace period"
        help="If the EV is already charging, discharge must remain above the tolerance for this long before charging stops. New solar charging is blocked immediately."
        enabled={fields.batteryPriorityEnabled}
        value={fields.batteryDischargeGraceMinutes}
        min={0}
        max={30}
        step={1}
        unit="min"
        onChange={(value) => setField("batteryDischargeGraceMinutes", value)}
      />
    </SettingsSection>
  );
}
