import { useState } from "react";
import { Badge, Button, Text, TextField } from "@radix-ui/themes";
import { SettingsRow } from "../../../hostUi.ts";
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
  from: string,
  to: string,
  configured: boolean,
  pending: boolean,
): boolean {
  const hasDates = from !== "" && to !== "" && from <= to;
  return hasDates && configured && !pending;
}

interface HistoryFieldsProps {
  from: string;
  to: string;
  pending: boolean;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
}

function HistoryFields(props: HistoryFieldsProps): JSX.Element {
  return (
    <>
      <SettingsRow label="Scope">
        <Badge size="2" color="green">All EVs — Wattpilot energy</Badge>
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
  const [from, setFrom] = useState(oneYearAgoIsoDate);
  const [to, setTo] = useState(todayIsoDate);

  if (!config) return null;
  const configured = [
    config.froniusCloudEmail,
    config.froniusCloudPassword,
    config.froniusCloudPvSystemId,
  ].every(Boolean);
  const canImport = isImportReady(from, to, configured, mutation.isPending);

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--gray-a5)" }}>
      <Text size="2" weight="bold">Import Solar.web EV history</Text>
      <Text as="p" size="1" color="gray" mt="1">
        Import the energy delivered by the Wattpilot to EVs, regardless of which vehicle was charging.
        Solar.web keeps the solar, home-battery and grid split for global Stats.
      </Text>
      <HistoryFields from={from} to={to} pending={mutation.isPending} setFrom={setFrom} setTo={setTo} />
      <Text as="p" size="1" color="gray">
        This history is not assigned to a vehicle. Re-importing a period is safe and native E.V Solar
        data keeps priority. For large archives, import year by year.
      </Text>
      <Button
        size="2" variant="soft" disabled={!canImport}
        onClick={() => mutation.mutate({ from, to })}
      >
        {mutation.isPending ? "Importing Solar.web history..." : "Import Solar.web EV history"}
      </Button>
      {mutation.isSuccess && (
        <Text as="p" size="1" color="gray" mt="2">
          <Badge color="green" size="2">{mutation.data.insertedRows} intervals imported</Badge>{" "}
          {formatKwh(mutation.data.chargedWh)} delivered to EVs — {formatKwh(mutation.data.solarWh)} solar,
          {" "}{formatKwh(mutation.data.batteryWh)} battery, {formatKwh(mutation.data.gridWh)} grid.
        </Text>
      )}
      {mutation.isError && <Text as="p" size="2" color="red">{mutation.error.message}</Text>}
    </div>
  );
}
