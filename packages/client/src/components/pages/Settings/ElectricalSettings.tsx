import { Shield } from "lucide-react";
import { Text } from "@radix-ui/themes";
import {
  useChargingConfig,
  useChargingConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";
import { NumberInput } from "./SettingsLayout.tsx";

export function ElectricalSettings(
  { vehicles }: { vehicles: Array<{ id: string; name: string }> },
) {
  const query = useChargingConfig();
  const mutation = useChargingConfigMutation();
  const { fields, setField, save, saveStatus, isDirty } = useDraftConfig(
    query.data,
    mutation,
  );
  if (!fields) return null;
  const limits = fields.vehicleCurrentLimits ?? {};
  return (
    <SettingsSection
      icon={<Shield size={18} />}
      title="Electrical limits"
      description="Maximum current per car and maximum grid power for the home. These are power limits, not battery charge targets (%)."
      onSave={save}
      saveStatus={saveStatus}
      isDirty={isDirty}
    >
      {vehicles.map((vehicle) => (
        <SettingsRow
          key={vehicle.id}
          label={`${vehicle.name} maximum current`}
          help="Set the permitted current for this charging circuit. Leave empty to use the vehicle-reported maximum."
        >
          <NumberInput
            value={limits[vehicle.id] == null ? "" : String(limits[vehicle.id])}
            aria-label={`${vehicle.name} maximum current`}
            min={1}
            max={80}
            step={1}
            suffix="A"
            placeholder="Vehicle maximum"
            onChange={(value) =>
              setField(
                "vehicleCurrentLimits",
                updateLimit(limits, vehicle.id, value),
              )}
          />
        </SettingsRow>
      ))}
      <SettingsRow
        label="Maximum grid import"
        help="Limit measured active grid power for the whole home. Charging is reduced or paused when headroom is unavailable. Leave empty to disable; 0 allows no intentional import."
      >
        <NumberInput
          value={fields.maxGridImportKw == null
            ? ""
            : String(fields.maxGridImportKw)}
          aria-label="Maximum grid import"
          min={0}
          max={100}
          step={0.1}
          suffix="kW"
          placeholder="Disabled"
          onChange={(value) =>
            setField("maxGridImportKw", value === "" ? null : Number(value))}
        />
      </SettingsRow>
      <Text size="1" color="gray">
        The grid limit requires fresh home energy readings. It is a software
        control limit, not a replacement for circuit protection or a per-phase
        breaker rating.
      </Text>
    </SettingsSection>
  );
}

function updateLimit(
  limits: Record<string, number>,
  id: string,
  value: string,
) {
  if (value === "") {
    return Object.fromEntries(
      Object.entries(limits).filter(([key]) => key !== id),
    );
  }
  return { ...limits, [id]: Number(value) };
}
