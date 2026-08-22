import { useCallback, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { Battery, Clock3, Gauge, Plus, SunMedium, Trash2 } from "lucide-react";
import { Button, Select, Switch, Text, TextField } from "@radix-ui/themes";
import { useMutation } from "@tanstack/react-query";
import type { SolarForecastConfig } from "@chargeha/shared/configSections";
import type { SolarArrayConfig } from "@chargeha/shared/forecast";
import {
  useSolarForecastConfig,
  useSolarForecastConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import {
  type PhotonResult,
  useAddressAutocomplete,
} from "../../../hooks/useAddressAutocomplete.ts";
import { trpc } from "../../../trpc.ts";
import { AddressSearchInput } from "./AddressSearchInput.tsx";
import {
  NumberInput,
  SettingsRow,
  SettingsSection,
} from "./SettingsLayout.tsx";

const HOME_EQUIPMENT_PROFILE = {
  inverterModel: "Primo GEN24 6.0 Plus",
  inverterAcMaxKw: 6,
  batteryModel: "Battery-Box Premium HVS 7.7",
  batteryCapacityKwh: 7.68,
  batteryMaxChargeKw: 6,
  batteryMaxDischargeKw: 6,
  batteryRoundTripEfficiencyPct: 96,
} as const;

type EquipmentValues = Pick<
  SolarForecastConfig,
  | "solarForecastInverterModel"
  | "solarForecastInverterAcMaxKw"
  | "solarForecastBatteryModel"
  | "solarForecastBatteryCapacityKwh"
  | "solarForecastBatteryMaxChargeKw"
  | "solarForecastBatteryMaxDischargeKw"
  | "solarForecastBatteryRoundTripEfficiencyPct"
>;

type EquipmentChange = <K extends keyof EquipmentValues>(
  key: K,
  value: EquipmentValues[K],
) => void;

function nullableNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseEditorArrays(raw: string): SolarArrayConfig[] {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value as SolarArrayConfig[] : [];
  } catch {
    return [];
  }
}

function serializeArrays(arrays: SolarArrayConfig[]): string {
  return JSON.stringify(arrays);
}

function formatCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): string | null {
  if (latitude == null || longitude == null) return null;
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function ArrayEditor({
  array,
  index,
  onChange,
  onRemove,
}: {
  array: SolarArrayConfig;
  index: number;
  onChange: (next: SolarArrayConfig) => void;
  onRemove: () => void;
}) {
  const numericChange = (
    key: "capacityKwp" | "azimuthDeg" | "tiltDeg",
    raw: string,
  ) => {
    if (raw.trim() === "") return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    onChange({ ...array, [key]: value });
  };

  return (
    <div
      style={{
        border: "1px solid var(--gray-a5)",
        borderRadius: 8,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <TextField.Root
          size="2"
          value={array.name}
          aria-label={`Solar array ${index + 1} name`}
          onChange={(event) => onChange({ ...array, name: event.target.value })}
          style={{ flex: 1 }}
        />
        <Button size="1" variant="ghost" color="red" onClick={onRemove}>
          <Trash2 size={13} />
          Remove
        </Button>
      </div>
      <SettingsRow label="Installed capacity">
        <NumberInput
          value={String(array.capacityKwp)}
          onChange={(value) => numericChange("capacityKwp", value)}
          suffix="kWp"
          min={0.1}
          max={1000}
          step={0.05}
        />
      </SettingsRow>
      <SettingsRow
        label="Azimuth"
        help="180° = South, 90° = East, 270° = West"
      >
        <NumberInput
          value={String(array.azimuthDeg)}
          onChange={(value) => numericChange("azimuthDeg", value)}
          suffix="°"
          min={0}
          max={360}
          step={1}
        />
      </SettingsRow>
      <SettingsRow label="Panel tilt">
        <NumberInput
          value={String(array.tiltDeg)}
          onChange={(value) => numericChange("tiltDeg", value)}
          suffix="°"
          min={0}
          max={90}
          step={1}
        />
      </SettingsRow>
    </div>
  );
}

function SolarLocationEditor({
  ac,
  geocodePending,
  geocodeError,
  onSelect,
  onLookup,
  address,
  coords,
}: {
  ac: ReturnType<typeof useAddressAutocomplete>;
  geocodePending: boolean;
  geocodeError: boolean;
  onSelect: (suggestion: PhotonResult) => void;
  onLookup: () => void;
  address: string | null | undefined;
  coords: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Text size="2">Solar installation location</Text>
      <AddressSearchInput
        ac={ac}
        disabled={geocodePending}
        onSelect={onSelect}
        onLookup={onLookup}
      />
      {geocodeError && (
        <Text size="1" color="red">Unable to find this address.</Text>
      )}
      {coords && (
        <Text size="1" color="gray">
          {address || "Forecast location"} — {coords}
        </Text>
      )}
    </div>
  );
}

function SolarArraysEditor({
  arrays,
  totalKwp,
  onAdd,
  onUpdate,
}: {
  arrays: SolarArrayConfig[];
  totalKwp: number;
  onAdd: () => void;
  onUpdate: (next: SolarArrayConfig[]) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <Text size="2" weight="medium">Solar arrays</Text>
          <Text size="1" color="gray" style={{ display: "block" }}>
            Total installed capacity: {totalKwp.toFixed(2)} kWp
          </Text>
        </div>
        <Button size="1" variant="soft" onClick={onAdd}>
          <Plus size={13} />
          Add array
        </Button>
      </div>

      {arrays.map((array, index) => (
        <ArrayEditor
          key={`${index}-${array.name}`}
          array={array}
          index={index}
          onChange={(next) =>
            onUpdate(arrays.map((item, i) => i === index ? next : item))}
          onRemove={() => onUpdate(arrays.filter((_, i) => i !== index))}
        />
      ))}

      {arrays.length === 0 && (
        <Text size="1" color="orange">
          Add at least one solar array before enabling the forecast.
        </Text>
      )}
    </div>
  );
}

function ForecastBasics({
  enabled,
  installationDate,
  onEnabledChange,
  onInstallationDateChange,
}: {
  enabled: boolean;
  installationDate: string;
  onEnabledChange: (value: boolean) => void;
  onInstallationDateChange: (value: string) => void;
}) {
  return (
    <>
      <SettingsRow label="Forecast enabled">
        <Switch size="2" checked={enabled} onCheckedChange={onEnabledChange} />
      </SettingsRow>
      <SettingsRow
        label="Installation date"
        help="Used to apply the average 0.5% annual panel degradation automatically."
      >
        <TextField.Root
          size="2"
          type="date"
          value={installationDate}
          onChange={(event) => onInstallationDateChange(event.target.value)}
        />
      </SettingsRow>
    </>
  );
}

function HomeGridSettings({
  subscribedPowerKva,
  onSubscribedPowerChange,
}: {
  subscribedPowerKva: number | null;
  onSubscribedPowerChange: (value: number | null) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--gray-a5)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <SettingsRow
        label="Subscribed grid power"
        help="Used to keep predicted grid charging within your electricity contract."
      >
        <NumberInput
          value={String(subscribedPowerKva ?? "")}
          onChange={(value) => onSubscribedPowerChange(nullableNumber(value))}
          suffix="kVA"
          min={1}
          max={250}
          step={1}
        />
      </SettingsRow>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "32px minmax(0, 1fr)",
          gap: 8,
          alignItems: "center",
          padding: "10px 12px",
          color: "var(--gray-11)",
          background: "var(--gray-a2)",
        }}
      >
        <Clock3 size={19} aria-hidden="true" />
        <Text size="1">
          Off-peak hours are read automatically from Electricity tariff.
        </Text>
      </div>
    </div>
  );
}

function EquipmentSummary({
  icon,
  title,
  model,
  detail,
}: {
  icon: ReactNode;
  title: string;
  model: string;
  detail: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "40px minmax(0, 1fr)",
        gap: 10,
        alignItems: "center",
        padding: 12,
        border: "1px solid var(--gray-a5)",
        borderRadius: 12,
        background: "var(--gray-a2)",
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 40,
          height: 40,
          color: "var(--accent-11)",
          background: "var(--accent-a3)",
          borderRadius: 12,
        }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <Text size="1" color="gray" weight="bold">{title}</Text>
        <Text size="2" weight="bold" style={{ display: "block" }}>
          {model || "Not configured"}
        </Text>
        <Text size="1" color="gray">{detail}</Text>
      </div>
    </div>
  );
}

function selectedEquipmentProfile(values: EquipmentValues): string {
  const matchesInverter = values.solarForecastInverterModel ===
    HOME_EQUIPMENT_PROFILE.inverterModel;
  const matchesBattery = values.solarForecastBatteryModel ===
    HOME_EQUIPMENT_PROFILE.batteryModel;
  return matchesInverter && matchesBattery ? "home-profile" : "custom";
}

function EquipmentSettings({
  values,
  onChange,
}: {
  values: EquipmentValues;
  onChange: EquipmentChange;
}) {
  const applyProfile = (profile: string) => {
    if (profile !== "home-profile") return;
    onChange(
      "solarForecastInverterModel",
      HOME_EQUIPMENT_PROFILE.inverterModel,
    );
    onChange(
      "solarForecastInverterAcMaxKw",
      HOME_EQUIPMENT_PROFILE.inverterAcMaxKw,
    );
    onChange("solarForecastBatteryModel", HOME_EQUIPMENT_PROFILE.batteryModel);
    onChange(
      "solarForecastBatteryCapacityKwh",
      HOME_EQUIPMENT_PROFILE.batteryCapacityKwh,
    );
    onChange(
      "solarForecastBatteryMaxChargeKw",
      HOME_EQUIPMENT_PROFILE.batteryMaxChargeKw,
    );
    onChange(
      "solarForecastBatteryMaxDischargeKw",
      HOME_EQUIPMENT_PROFILE.batteryMaxDischargeKw,
    );
    onChange(
      "solarForecastBatteryRoundTripEfficiencyPct",
      HOME_EQUIPMENT_PROFILE.batteryRoundTripEfficiencyPct,
    );
  };

  return (
    <>
      <SettingsRow
        label="Energy equipment"
        help="Choose a known combination to fill in its verified limits automatically."
      >
        <Select.Root
          value={selectedEquipmentProfile(values)}
          onValueChange={applyProfile}
        >
          <Select.Trigger aria-label="Energy equipment profile" />
          <Select.Content>
            <Select.Item value="custom">Custom equipment</Select.Item>
            <Select.Item value="home-profile">
              GEN24 6.0 + HVS 7.7
            </Select.Item>
          </Select.Content>
        </Select.Root>
      </SettingsRow>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 10,
        }}
      >
        <EquipmentSummary
          icon={<Gauge size={21} />}
          title="INVERTER"
          model={values.solarForecastInverterModel}
          detail={values.solarForecastInverterAcMaxKw == null
            ? "Maximum power not set"
            : `${values.solarForecastInverterAcMaxKw} kW AC maximum`}
        />
        <EquipmentSummary
          icon={<Battery size={21} />}
          title="HOME BATTERY"
          model={values.solarForecastBatteryModel}
          detail={values.solarForecastBatteryCapacityKwh == null
            ? "Usable capacity not set"
            : `${values.solarForecastBatteryCapacityKwh} kWh usable`}
        />
      </div>
      <EquipmentDetails values={values} onChange={onChange} />
    </>
  );
}

function EquipmentDetails({
  values,
  onChange,
}: {
  values: EquipmentValues;
  onChange: EquipmentChange;
}) {
  return (
    <details style={{ marginTop: 2 }}>
      <summary style={{ cursor: "pointer", color: "var(--gray-11)" }}>
        Adjust equipment specifications
      </summary>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
        <SettingsRow label="Inverter model">
          <TextField.Root
            size="2"
            value={values.solarForecastInverterModel}
            onChange={(event) =>
              onChange("solarForecastInverterModel", event.target.value)}
          />
        </SettingsRow>
        <SettingsRow label="Maximum inverter output">
          <NumberInput
            value={String(values.solarForecastInverterAcMaxKw ?? "")}
            onChange={(value) =>
              onChange("solarForecastInverterAcMaxKw", nullableNumber(value))}
            suffix="kW"
            min={0.1}
            max={100}
            step={0.1}
          />
        </SettingsRow>
        <SettingsRow label="Home battery model">
          <TextField.Root
            size="2"
            value={values.solarForecastBatteryModel}
            onChange={(event) =>
              onChange("solarForecastBatteryModel", event.target.value)}
          />
        </SettingsRow>
        <EquipmentNumberRows values={values} onChange={onChange} />
      </div>
    </details>
  );
}

function EquipmentNumberRows({
  values,
  onChange,
}: {
  values: EquipmentValues;
  onChange: EquipmentChange;
}) {
  return (
    <>
      <SettingsRow label="Usable battery capacity">
        <NumberInput
          value={String(values.solarForecastBatteryCapacityKwh ?? "")}
          onChange={(value) =>
            onChange("solarForecastBatteryCapacityKwh", nullableNumber(value))}
          suffix="kWh"
          min={0.1}
          max={500}
          step={0.01}
        />
      </SettingsRow>
      <SettingsRow label="Maximum battery charge">
        <NumberInput
          value={String(values.solarForecastBatteryMaxChargeKw ?? "")}
          onChange={(value) =>
            onChange("solarForecastBatteryMaxChargeKw", nullableNumber(value))}
          suffix="kW"
          min={0.1}
          max={100}
          step={0.1}
        />
      </SettingsRow>
      <SettingsRow label="Maximum battery discharge">
        <NumberInput
          value={String(values.solarForecastBatteryMaxDischargeKw ?? "")}
          onChange={(value) =>
            onChange(
              "solarForecastBatteryMaxDischargeKw",
              nullableNumber(value),
            )}
          suffix="kW"
          min={0.1}
          max={100}
          step={0.1}
        />
      </SettingsRow>
      <SettingsRow label="Battery round-trip efficiency">
        <NumberInput
          value={String(
            values.solarForecastBatteryRoundTripEfficiencyPct ?? "",
          )}
          onChange={(value) =>
            onChange(
              "solarForecastBatteryRoundTripEfficiencyPct",
              nullableNumber(value),
            )}
          suffix="%"
          min={50}
          max={100}
          step={0.1}
        />
      </SettingsRow>
    </>
  );
}

function equipmentValues(
  fields: Partial<EquipmentValues> | null | undefined,
): EquipmentValues {
  return {
    solarForecastInverterModel: fields?.solarForecastInverterModel ?? "",
    solarForecastInverterAcMaxKw: fields?.solarForecastInverterAcMaxKw ?? null,
    solarForecastBatteryModel: fields?.solarForecastBatteryModel ?? "",
    solarForecastBatteryCapacityKwh: fields?.solarForecastBatteryCapacityKwh ??
      null,
    solarForecastBatteryMaxChargeKw: fields?.solarForecastBatteryMaxChargeKw ??
      null,
    solarForecastBatteryMaxDischargeKw:
      fields?.solarForecastBatteryMaxDischargeKw ?? null,
    solarForecastBatteryRoundTripEfficiencyPct:
      fields?.solarForecastBatteryRoundTripEfficiencyPct ?? null,
  };
}

export function SolarForecastSettings() {
  const { data } = useSolarForecastConfig();
  const mutation = useSolarForecastConfigMutation();
  const { fields, setField, isDirty, save, saveStatus } = useDraftConfig(
    data,
    mutation,
  );
  const arrays = useMemo(
    () => parseEditorArrays(fields?.solarForecastArraysJson ?? "[]"),
    [fields?.solarForecastArraysJson],
  );
  const totalKwp = arrays.reduce((sum, array) => sum + array.capacityKwp, 0);
  const ac = useAddressAutocomplete();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (data?.solarForecastAddress && !ac.query) {
      ac.setQuery(data.solarForecastAddress);
    }
  }, [data?.solarForecastAddress, ac.query, ac.setQuery]);

  const applyLocation = useCallback(
    (displayName: string, latitude: number, longitude: number) => {
      setField("solarForecastAddress", displayName);
      setField("solarForecastLatitude", Number(latitude.toFixed(6)));
      setField("solarForecastLongitude", Number(longitude.toFixed(6)));
      ac.setQuery(displayName);
      ac.clear();
    },
    [ac, setField],
  );

  const geocodeMutation = useMutation({
    mutationFn: (query: string) =>
      utils.client.config.geocode.query({ q: query }),
    onSuccess: (result) => {
      applyLocation(result.displayName, result.latitude, result.longitude);
    },
  });

  const selectSuggestion = (suggestion: PhotonResult) => {
    applyLocation(
      suggestion.display_name,
      Number(suggestion.lat),
      Number(suggestion.lon),
    );
  };
  const updateArrays = (next: SolarArrayConfig[]) => {
    setField("solarForecastArraysJson", serializeArrays(next));
  };
  const addArray = () => {
    updateArrays([
      ...arrays,
      {
        name: `Array ${arrays.length + 1}`,
        capacityKwp: 1,
        azimuthDeg: 180,
        tiltDeg: 30,
      },
    ]);
  };
  const coords = formatCoordinates(
    fields?.solarForecastLatitude,
    fields?.solarForecastLongitude,
  );
  const equipment = equipmentValues(fields);
  const setEquipmentField = setField as EquipmentChange;

  return (
    <SettingsSection
      icon={<SunMedium size={18} />}
      title="Solar Prediction"
      description="Tell E.V. Solar about your installation so it can predict available solar, home-battery energy and vehicle charging more accurately."
      saveStatus={saveStatus}
      isDirty={isDirty}
      onSave={save}
    >
      <ForecastBasics
        enabled={fields?.solarForecastEnabled ?? false}
        installationDate={fields?.solarForecastInstallationDate ?? ""}
        onEnabledChange={(value) => setField("solarForecastEnabled", value)}
        onInstallationDateChange={(value) =>
          setField("solarForecastInstallationDate", value)}
      />
      <HomeGridSettings
        subscribedPowerKva={fields?.solarForecastSubscribedPowerKva ?? null}
        onSubscribedPowerChange={(value) =>
          setField("solarForecastSubscribedPowerKva", value)}
      />
      <EquipmentSettings values={equipment} onChange={setEquipmentField} />
      <SolarLocationEditor
        ac={ac}
        geocodePending={geocodeMutation.isPending}
        geocodeError={geocodeMutation.isError}
        onSelect={selectSuggestion}
        onLookup={() => {
          if (ac.query.trim()) geocodeMutation.mutate(ac.query.trim());
        }}
        address={fields?.solarForecastAddress}
        coords={coords}
      />
      <SolarArraysEditor
        arrays={arrays}
        totalKwp={totalKwp}
        onAdd={addArray}
        onUpdate={updateArrays}
      />
    </SettingsSection>
  );
}
