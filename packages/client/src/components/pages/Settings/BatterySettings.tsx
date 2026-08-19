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

type BatteryFields = NonNullable<ReturnType<typeof useBatteryConfig>["data"]>;
type SetBatteryField = <K extends keyof BatteryFields>(
  key: K,
  value: BatteryFields[K],
) => void;

function BatteryReserveRows({
  fields,
  setField,
}: {
  fields: BatteryFields;
  setField: SetBatteryField;
}) {
  return (
    <>
      <SettingsRow
        label="Protect home battery"
        help="Keep some battery energy for the house instead of giving it to the car."
      >
        <Switch
          size="2"
          checked={fields.batteryPriorityEnabled}
          onCheckedChange={(value) => setField("batteryPriorityEnabled", value)}
        />
      </SettingsRow>

      <SettingsRow
        label="Keep at least"
        help="Solar car charging pauses if the home battery falls below this level."
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
            onValueChange={([value]) => setField("batteryPriorityLimit", value)}
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
    </>
  );
}

function BatteryAdvancedRows({
  fields,
  setField,
}: {
  fields: BatteryFields;
  setField: SetBatteryField;
}) {
  return (
    <>
      <ProtectionSlider
        label="Allowed battery discharge"
        help="How much brief battery discharge is allowed while the car is charging. Use 0 W for the strictest protection."
        enabled={fields.batteryPriorityEnabled}
        value={fields.batteryDischargeToleranceW}
        min={0}
        max={5000}
        step={100}
        unit="W"
        onChange={(value) => setField("batteryDischargeToleranceW", value)}
      />
      <ProtectionSlider
        label="Discharge delay"
        help="How long excessive battery discharge may continue before car charging stops."
        enabled={fields.batteryPriorityEnabled}
        value={fields.batteryDischargeGraceMinutes}
        min={0}
        max={30}
        step={1}
        unit="min"
        onChange={(value) => setField("batteryDischargeGraceMinutes", value)}
      />
    </>
  );
}

function BatteryStatusBadge() {
  const { data: energyData } = useEnergyData();
  const soc = energyData?.realtime?.batterySoc;
  if (soc == null) {
    return <Badge color="gray" variant="soft" size="1">Not detected</Badge>;
  }
  return (
    <Badge color="green" variant="soft" size="1">
      <CheckCircle size={12} /> Detected — {Math.round(soc)}%
    </Badge>
  );
}

type BatterySettingsMode = "all" | "basic" | "advanced";

export function BatterySettings(
  { mode = "all" }: { mode?: BatterySettingsMode } = {},
) {
  const { data: config } = useBatteryConfig();
  const mutation = useBatteryConfigMutation();
  const { fields, setField, isDirty, save, saveStatus } = useDraftConfig(
    config,
    mutation,
  );

  if (!fields) return null;

  const basic = mode !== "advanced";
  const advanced = mode !== "basic";
  return (
    <SettingsSection
      icon={<Battery size={18} />}
      title={mode === "advanced" ? "Home battery — advanced" : "Home battery"}
      description={basic
        ? "Choose how much home battery E.V. Solar should keep for the house."
        : "Fine-tune how E.V. Solar reacts to short home-battery discharge."}
      saveStatus={saveStatus}
      isDirty={isDirty}
      onSave={save}
      action={<BatteryStatusBadge />}
    >
      {basic && <BatteryReserveRows fields={fields} setField={setField} />}
      {advanced && <BatteryAdvancedRows fields={fields} setField={setField} />}
    </SettingsSection>
  );
}
