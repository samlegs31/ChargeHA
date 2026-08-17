import { useEffect, useState } from "react";
import { Badge, Button, Text, TextField } from "@radix-ui/themes";
import {
  SettingsRow,
  type VehicleOption,
  useVehicleOptions,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearAgoIsoDate(): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function formatKwh(wh: number): string {
  return `${(wh / 1000).toFixed(1)} kWh`;
}

function isImportReady(
  vehicleId: string,
  from: string,
  to: string,
  configured: boolean,
  pending: boolean,
): boolean {
  const hasVehicle = vehicleId !== "";
  const hasDates = from !== "" && to !== "" && from <= to;
  return hasVehicle && hasDates && configured && !pending;
}

interface HistoryFieldsProps {
  vehicles: VehicleOption[];
  vehicleId: string;
  from: string;
  to: string;
  pending: boolean;
  setVehicleId: (value: string) => void;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
}

function HistoryFields(props: HistoryFieldsProps): JSX.Element {
  return (
    <>
      <SettingsRow label="Vehicle">
        <select
          value={props.vehicleId}
          onChange={(event) => props.setVehicleId(event.target.value)}
          disabled={props.vehicles.length === 0 || props.pending}
          style={{ minWidth: 220, height: 32, borderRadius: 6, padding: "0 8px" }}
        >
          {props.vehicles.length === 0 && <option value="">No vehicle configured</option>}
          {props.vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow label="From">
        <TextField.Root
          size="2" type="date" value={props.from} max={props.to} disabled={props.pending}
          onChange={(event: { target: { value: string } }) => props.setFrom(event.target.value)}
          style={{ width: 180 }}
        />
      </SettingsRow>
      <SettingsRow label="To">
        <TextField.Root
          size="2" type="date" value={props.to} min={props.from} max={todayIsoDate()}
          disabled={props.pending}
          onChange={(event: { target: { value: string } }) => props.setTo(event.target.value)}
          style={{ width: 180 }}
        />
      </SettingsRow>
    </>
  );
}

export function FroniusCloudHistoryImport(): JSX.Element | null {
  const { data: config } = trpc.plugin.energy.fronius_cloud.getConfig.useQuery();
  const mutation = trpc.plugin.energy.fronius_cloud.importEvHistory.useMutation();
  const vehicles = useVehicleOptions();
  const [vehicleId, setVehicleId] = useState("");
  const [from, setFrom] = useState(oneYearAgoIsoDate);
  const [to, setTo] = useState(todayIsoDate);

  useEffect(() => {
    if (vehicleId === "" && vehicles.length > 0) setVehicleId(vehicles[0].id);
  }, [vehicleId, vehicles]);

  if (!config) return null;
  const configured = [
    config.froniusCloudEmail,
    config.froniusCloudPassword,
    config.froniusCloudPvSystemId,
  ].every(Boolean);
  const canImport = isImportReady(vehicleId, from, to, configured, mutation.isPending);

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--gray-a5)" }}>
      <Text size="2" weight="bold">Import Solar.web EV history</Text>
      <Text as="p" size="1" color="gray" mt="1">
        Import Wattpilot charging into Stats with exact solar, home-battery and grid contributions.
        Re-importing a period is safe; native E.V Solar data keeps priority.
      </Text>
      <HistoryFields
        vehicles={vehicles} vehicleId={vehicleId} from={from} to={to}
        pending={mutation.isPending} setVehicleId={setVehicleId} setFrom={setFrom} setTo={setTo}
      />
      <Text as="p" size="1" color="gray">
        Defaults to 12 months. Move From back to your first Solar.web date; for large archives,
        import year by year.
      </Text>
      <Button
        size="2" variant="soft" disabled={!canImport}
        onClick={() => mutation.mutate({ vehicleId, from, to })}
      >
        {mutation.isPending ? "Importing Solar.web history..." : "Import Solar.web history"}
      </Button>
      {mutation.isSuccess && (
        <Text as="p" size="1" color="gray" mt="2">
          <Badge color="green" size="2">{mutation.data.insertedRows} intervals imported</Badge>{" "}
          {formatKwh(mutation.data.chargedWh)} charged — {formatKwh(mutation.data.solarWh)} solar,
          {" "}{formatKwh(mutation.data.batteryWh)} battery, {formatKwh(mutation.data.gridWh)} grid.
        </Text>
      )}
      {mutation.isError && <Text as="p" size="2" color="red">{mutation.error.message}</Text>}
    </div>
  );
}
