import { useState } from "react";
import { ChevronDown, ChevronRight, Sun } from "lucide-react";
import { Button, Select, Slider, Switch, Text } from "@radix-ui/themes";
import {
  useSolarConfig,
  useSolarConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import {
  NumberInput,
  SettingsRow,
  SettingsSection,
} from "./SettingsLayout.tsx";

const AMP_THRESHOLD_HELP =
  "Changes at or below this threshold wait for the settle time. Larger changes apply immediately. A lower threshold increases vehicle API calls.";

const AMP_SETTLE_HELP =
  "How long a small current change must stay stable before applying. Shorter times increase vehicle API calls.";

type SolarFields = NonNullable<ReturnType<typeof useSolarConfig>["data"]>;
type SetSolarField = <K extends keyof SolarFields>(
  k: K,
  v: SolarFields[K],
) => void;

function SolarMainRows(
  { fields, setField, kwToAmps }: {
    fields: SolarFields;
    setField: SetSolarField;
    kwToAmps: (kw: number) => number;
  },
) {
  return (
    <>
      <SettingsRow
        label="Solar margin"
        help="Positive values reserve solar for the house. Negative values allow some grid import."
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 200,
          }}
        >
          <Slider
            min={-2}
            max={5}
            step={0.1}
            value={[fields.solarMarginKw]}
            onValueChange={([v]) =>
              setField("solarMarginKw", parseFloat(v.toFixed(1)))}
            style={{ flex: 1 }}
          />
          <Text
            size="2"
            weight="medium"
            style={{ minWidth: 55, textAlign: "right" }}
          >
            {fields.solarMarginKw.toFixed(1)} kW
            <Text size="1" color="gray">
              ({kwToAmps(fields.solarMarginKw)}A)
            </Text>
          </Text>
        </div>
      </SettingsRow>
    </>
  );
}

function SolarThresholdRows(
  { fields, setField, kwToAmps }: {
    fields: SolarFields;
    setField: SetSolarField;
    kwToAmps: (kw: number) => number;
  },
) {
  return (
    <>
      <SettingsRow
        label="Minimum solar production"
        help="Production needed to start charging. Below this, charging reduces to minimum current during the grace period, then stops. Zero production stops charging immediately."
      >
        <NumberInput
          value={String(fields.minSolarGenerationKw)}
          onChange={(v) =>
            setField("minSolarGenerationKw", parseFloat(v) || 0.2)}
          suffix="kW"
          step={0.1}
          min={0}
          max={10}
        />
        <Text size="1" color="gray">
          ({kwToAmps(fields.minSolarGenerationKw)}A)
        </Text>
      </SettingsRow>
      <SettingsRow
        label="Minimum solar surplus"
        help="Surplus needed to start after home use. Once charging, the grace period handles solar drops. Leave empty to disable."
      >
        <NumberInput
          value={fields.minExcessSolarKw != null
            ? String(fields.minExcessSolarKw)
            : ""}
          onChange={(v) =>
            setField(
              "minExcessSolarKw",
              v === "" ? null : (parseFloat(v) || 0),
            )}
          suffix="kW"
          step={0.1}
          min={0}
          max={20}
          placeholder="Disabled"
        />
        {fields.minExcessSolarKw != null && (
          <Text size="1" color="gray">
            ({kwToAmps(fields.minExcessSolarKw)}A)
          </Text>
        )}
      </SettingsRow>
      <SettingsRow
        label="Grace period"
        help="Time allowed for solar to recover before charging stops. Charging may drop to minimum current while waiting."
      >
        <NumberInput
          value={String(fields.gracePeriodMinutes)}
          onChange={(v) => setField("gracePeriodMinutes", parseInt(v) || 6)}
          suffix="min"
          step={1}
          min={0}
          max={30}
        />
      </SettingsRow>
      <SettingsRow
        label="Cooldown period"
        help="Wait before restarting after a solar shortage, to avoid repeated starts and stops."
      >
        <NumberInput
          value={String(fields.cooldownPeriodMinutes)}
          onChange={(v) => setField("cooldownPeriodMinutes", parseInt(v) || 15)}
          suffix="min"
          step={1}
          min={0}
          max={60}
        />
      </SettingsRow>
    </>
  );
}

function SolarHardwareRows(
  { fields, setField }: {
    fields: SolarFields;
    setField: SetSolarField;
  },
) {
  return (
    <>
      <SettingsRow
        label="Grid voltage"
        help="Your region's nominal mains voltage. Used to convert available solar watts to charging amps."
      >
        <Select.Root
          size="2"
          value={String(fields.gridVoltage)}
          onValueChange={(v) => setField("gridVoltage", Number(v))}
        >
          <Select.Trigger />
          <Select.Content>
            <Select.Item value="230">230V</Select.Item>
            <Select.Item value="240">240V</Select.Item>
            <Select.Item value="120">120V</Select.Item>
          </Select.Content>
        </Select.Root>
      </SettingsRow>
      <SettingsRow
        label="Three-phase charger"
        help="Enable for a three-phase charger so available solar is converted to the correct charging current."
      >
        <Switch
          size="2"
          checked={fields.threePhaseCharger}
          onCheckedChange={(v) => setField("threePhaseCharger", v)}
        />
      </SettingsRow>
      <SettingsRow
        label="Consumption excludes charging"
        help="Enable if your EV charger is wired outside the energy meter's monitoring loop."
      >
        <Switch
          size="2"
          checked={fields.consumptionExcludesCharging}
          onCheckedChange={(v) => setField("consumptionExcludesCharging", v)}
        />
      </SettingsRow>
    </>
  );
}

function AdvancedRows(
  { fields, setField }: {
    fields: SolarFields;
    setField: SetSolarField;
  },
) {
  return (
    <>
      <SettingsRow label="Amp change threshold" help={AMP_THRESHOLD_HELP}>
        <NumberInput
          value={String(fields.ampDebounceThreshold)}
          onChange={(v) => setField("ampDebounceThreshold", parseInt(v) || 2)}
          suffix="A"
          step={1}
          min={1}
          max={5}
        />
      </SettingsRow>
      <SettingsRow label="Amp settle time" help={AMP_SETTLE_HELP}>
        <NumberInput
          value={String(fields.ampDebounceSettleMinutes)}
          onChange={(v) =>
            setField("ampDebounceSettleMinutes", parseInt(v) || 3)}
          suffix="min"
          step={1}
          min={1}
          max={10}
        />
      </SettingsRow>
    </>
  );
}

export function SolarTrackingSettings() {
  const { data: config } = useSolarConfig();
  const mutation = useSolarConfigMutation();
  const { fields, setField, isDirty, save, saveStatus } = useDraftConfig(
    config,
    mutation,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const voltage = fields?.gridVoltage ?? 230;
  const kwToAmps = (kw: number) =>
    Math.round(((kw * 1000) / voltage) * 10) / 10;

  if (!fields) return null;

  return (
    <>
      <SettingsSection
        icon={<Sun size={18} />}
        title="Solar charging"
        description="Set solar thresholds and charging response times."
        saveStatus={saveStatus}
        isDirty={isDirty}
        onSave={save}
      >
        <SolarMainRows
          fields={fields}
          setField={setField}
          kwToAmps={kwToAmps}
        />
        <SolarThresholdRows
          fields={fields}
          setField={setField}
          kwToAmps={kwToAmps}
        />
        <SolarHardwareRows fields={fields} setField={setField} />

        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--gray-a4)",
          }}
        >
          <Button
            size="1"
            variant="ghost"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced
              ? <ChevronDown size={14} />
              : <ChevronRight size={14} />}
            Advanced
          </Button>
        </div>

        {showAdvanced && <AdvancedRows fields={fields} setField={setField} />}
      </SettingsSection>
    </>
  );
}
