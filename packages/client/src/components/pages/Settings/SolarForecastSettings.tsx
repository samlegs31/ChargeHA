import { useCallback, useEffect, useMemo } from "react";
import { Plus, SunMedium, Trash2 } from "lucide-react";
import { Button, Switch, Text, TextField } from "@radix-ui/themes";
import { useMutation } from "@tanstack/react-query";
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

  return (
    <SettingsSection
      icon={<SunMedium size={18} />}
      title="Solar Forecast"
      description="Predict today's solar EV charging and, in Solar + clock, the final SOC after the next charge schedule. Forecasting is informational only and never controls charging."
      saveStatus={saveStatus}
      isDirty={isDirty}
      onSave={save}
    >
      <SettingsRow label="Forecast enabled">
        <Switch
          size="2"
          checked={fields?.solarForecastEnabled ?? false}
          onCheckedChange={(value) => setField("solarForecastEnabled", value)}
        />
      </SettingsRow>
      <SettingsRow
        label="Installation date"
        help="Used to apply the average 0.5% annual panel degradation automatically."
      >
        <TextField.Root
          size="2"
          type="date"
          value={fields?.solarForecastInstallationDate ?? ""}
          onChange={(event) =>
            setField("solarForecastInstallationDate", event.target.value)}
        />
      </SettingsRow>
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
