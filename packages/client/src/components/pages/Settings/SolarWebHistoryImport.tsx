import { useState } from "react";
import { Badge, Button, Card, Text, TextField } from "@radix-ui/themes";
import { Car, CloudDownload } from "lucide-react";
import { trpc } from "../../../trpc.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";

const BATCH_DAYS = 7;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearAgoIsoDate(): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function shiftedIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatKwh(wh: number): string {
  return `${(wh / 1000).toFixed(1)} kWh`;
}

interface DateBatch {
  from: string;
  to: string;
}

function buildDateBatches(from: string, to: string): DateBatch[] {
  if (from > to) return [];
  const candidateTo = shiftedIsoDate(from, BATCH_DAYS - 1);
  const batchTo = candidateTo < to ? candidateTo : to;
  return [
    { from, to: batchTo },
    ...buildDateBatches(shiftedIsoDate(batchTo, 1), to),
  ];
}

interface WattpilotSummary {
  insertedRows: number;
  duplicateRows: number;
  overlapRows: number;
  skippedRows: number;
  samplesRead: number;
  chargingIntervals: number;
  chargedWh: number;
  solarWh: number;
  batteryWh: number;
  gridWh: number;
}

interface VehicleArchiveSummary {
  insertedRows: number;
  duplicateRows: number;
  overlapRows: number;
  skippedRows: number;
  sessionsRead: number;
  sessionsMatched: number;
  sessionsSkipped: number;
  intervalsBuilt: number;
  chargedWh: number;
  truncated: boolean;
}

function emptyWattpilotSummary(): WattpilotSummary {
  return {
    insertedRows: 0,
    duplicateRows: 0,
    overlapRows: 0,
    skippedRows: 0,
    samplesRead: 0,
    chargingIntervals: 0,
    chargedWh: 0,
    solarWh: 0,
    batteryWh: 0,
    gridWh: 0,
  };
}

function addWattpilotResult(
  summary: WattpilotSummary,
  result: WattpilotSummary,
): WattpilotSummary {
  return {
    insertedRows: summary.insertedRows + result.insertedRows,
    duplicateRows: summary.duplicateRows + result.duplicateRows,
    overlapRows: summary.overlapRows + result.overlapRows,
    skippedRows: summary.skippedRows + result.skippedRows,
    samplesRead: summary.samplesRead + result.samplesRead,
    chargingIntervals: summary.chargingIntervals + result.chargingIntervals,
    chargedWh: summary.chargedWh + result.chargedWh,
    solarWh: summary.solarWh + result.solarWh,
    batteryWh: summary.batteryWh + result.batteryWh,
    gridWh: summary.gridWh + result.gridWh,
  };
}

async function importBatchSequence(
  batches: readonly DateBatch[],
  index: number,
  summary: WattpilotSummary,
  importBatch: (batch: DateBatch) => Promise<WattpilotSummary>,
  reportProgress: (value: string) => void,
): Promise<WattpilotSummary> {
  const batch = batches[index];
  if (batch === undefined) return summary;
  reportProgress(
    `Importing Wattpilot batch ${index + 1} / ${batches.length} · ${batch.from} → ${batch.to}`,
  );
  const result = await importBatch(batch);
  return await importBatchSequence(
    batches,
    index + 1,
    addWattpilotResult(summary, result),
    importBatch,
    reportProgress,
  );
}

function VehicleSelector(props: {
  vehicles: Array<{ id: string; name: string }>;
  vehicleId: string;
  disabled: boolean;
  setVehicleId: (value: string) => void;
}) {
  return (
    <SettingsRow
      label="Destination vehicle"
      help="Choose the vehicle connected to this Wattpilot. Its stable vehicle ID is used for history attribution."
    >
      <select
        value={props.vehicleId}
        disabled={props.disabled || props.vehicles.length === 0}
        onChange={(event) => props.setVehicleId(event.currentTarget.value)}
        style={{
          width: 300,
          height: 32,
          borderRadius: 6,
          border: "1px solid var(--gray-a7)",
          background: "var(--color-panel-solid)",
          color: "var(--gray-12)",
          padding: "0 8px",
        }}
      >
        <option value="">Select vehicle...</option>
        {props.vehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>
            {vehicle.name} · {vehicle.id}
          </option>
        ))}
      </select>
    </SettingsRow>
  );
}

function DateRangeFields(props: {
  from: string;
  to: string;
  disabled: boolean;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
}) {
  return (
    <>
      <SettingsRow label="From">
        <TextField.Root
          size="2" type="date" value={props.from} max={props.to}
          disabled={props.disabled}
          onChange={(event) => props.setFrom(event.currentTarget.value)}
          style={{ width: 180 }}
        />
      </SettingsRow>
      <SettingsRow label="To">
        <TextField.Root
          size="2" type="date" value={props.to} min={props.from}
          max={todayIsoDate()} disabled={props.disabled}
          onChange={(event) => props.setTo(event.currentTarget.value)}
          style={{ width: 180 }}
        />
      </SettingsRow>
    </>
  );
}

function SolarWebFields(props: {
  email: string;
  password: string;
  pvSystemId: string;
  disabled: boolean;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setPvSystemId: (value: string) => void;
}) {
  return (
    <>
      <SettingsRow label="Solar.web email">
        <TextField.Root
          size="2" type="email" placeholder="name@email.com"
          value={props.email} disabled={props.disabled}
          onChange={(event) => props.setEmail(event.currentTarget.value)}
          style={{ width: 260 }}
        />
      </SettingsRow>
      <SettingsRow label="Solar.web password">
        <TextField.Root
          size="2" type="password" placeholder="Password"
          value={props.password} disabled={props.disabled}
          onChange={(event) => props.setPassword(event.currentTarget.value)}
          style={{ width: 260 }}
        />
      </SettingsRow>
      <SettingsRow label="PV System ID" help="Use the pvSystemId from your Solar.web system URL.">
        <TextField.Root
          size="2" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={props.pvSystemId} disabled={props.disabled}
          onChange={(event) => props.setPvSystemId(event.currentTarget.value)}
          style={{ width: 320 }}
        />
      </SettingsRow>
    </>
  );
}

function VehicleArchiveResult(props: VehicleArchiveSummary) {
  return (
    <Card style={{ borderLeft: "3px solid var(--blue-9)" }}>
      <Badge color="blue" variant="soft">
        {props.insertedRows} external-history intervals imported
      </Badge>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 6 }}>
        {props.sessionsRead} sessions read · {props.sessionsMatched} matched ·{" "}
        {props.intervalsBuilt} intervals · {props.duplicateRows} duplicates ·{" "}
        {props.overlapRows} native overlaps · {formatKwh(props.chargedWh)}
      </Text>
      {props.truncated && (
        <Text size="1" color="orange" style={{ display: "block", marginTop: 4 }}>
          The vehicle service returned a partial archive. Import a smaller date range if needed.
        </Text>
      )}
    </Card>
  );
}

function WattpilotResult(props: WattpilotSummary) {
  return (
    <Card style={{ borderLeft: "3px solid var(--green-9)" }}>
      <Badge color="green" variant="soft">
        {props.insertedRows} Wattpilot intervals imported
      </Badge>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 6 }}>
        {props.samplesRead} Solar.web samples · {props.chargingIntervals} charging intervals ·{" "}
        {props.duplicateRows} duplicates · {props.overlapRows} native overlaps
      </Text>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
        {formatKwh(props.chargedWh)} home · {formatKwh(props.solarWh)} solar ·{" "}
        {formatKwh(props.batteryWh)} home battery · {formatKwh(props.gridWh)} grid
      </Text>
    </Card>
  );
}

function VehicleArchiveCard(props: {
  ready: boolean;
  busy: boolean;
  pending: boolean;
  onImport: () => void;
  result: VehicleArchiveSummary | null;
}) {
  return (
    <Card>
      <Text size="2" weight="medium">Vehicle charging archive</Text>
      <Text size="1" color="gray" style={{ display: "block", margin: "6px 0 10px" }}>
        Imports charging sessions using the selected vehicle integration and stable vehicle ID.
      </Text>
      <Button size="2" disabled={!props.ready || props.busy} onClick={props.onImport}>
        <Car size={15} />
        {props.pending ? "Importing vehicle history..." : "Import vehicle charging history"}
      </Button>
      {props.result !== null && <div style={{ marginTop: 10 }}><VehicleArchiveResult {...props.result} /></div>}
    </Card>
  );
}

function WattpilotCard(props: {
  email: string;
  password: string;
  pvSystemId: string;
  ready: boolean;
  busy: boolean;
  pending: boolean;
  progress: string;
  result: WattpilotSummary | null;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setPvSystemId: (value: string) => void;
  onImport: () => void;
}) {
  return (
    <Card>
      <Text size="2" weight="medium">Solar.web Wattpilot · home charging</Text>
      <Text size="1" color="gray" style={{ display: "block", margin: "6px 0 10px" }}>
        Credentials are used only for this import. Large archives run in 7-day batches and re-importing is safe.
      </Text>
      <SolarWebFields
        email={props.email} password={props.password} pvSystemId={props.pvSystemId}
        disabled={props.busy} setEmail={props.setEmail} setPassword={props.setPassword}
        setPvSystemId={props.setPvSystemId}
      />
      <Button size="2" disabled={!props.ready || props.busy} onClick={props.onImport}>
        <CloudDownload size={15} />
        {props.pending ? "Importing Wattpilot history..." : "Import Wattpilot home history"}
      </Button>
      {props.progress !== "" && (
        <Text size="1" color="gray" style={{ display: "block", marginTop: 8 }}>
          {props.progress}
        </Text>
      )}
      {props.result !== null && <div style={{ marginTop: 10 }}><WattpilotResult {...props.result} /></div>}
    </Card>
  );
}

interface HistoryImportContentProps {
  vehicles: Array<{ id: string; name: string }>;
  vehicleId: string;
  from: string;
  to: string;
  busy: boolean;
  rangeReady: boolean;
  wattpilotReady: boolean;
  vehiclePending: boolean;
  wattpilotPending: boolean;
  vehicleResult: VehicleArchiveSummary | null;
  wattpilotResult: WattpilotSummary | null;
  progress: string;
  error: string;
  email: string;
  password: string;
  pvSystemId: string;
  setVehicleId: (value: string) => void;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setPvSystemId: (value: string) => void;
  importVehicleHistory: () => void;
  importWattpilotHistory: () => void;
}

function HistoryImportContent(props: HistoryImportContentProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Text size="1" color="gray">
        Select the vehicle connected to this Wattpilot. Wattpilot intervals define Home
        Solar / Home Battery / Grid. Non-overlapping vehicle archive intervals are External.
      </Text>
      <VehicleSelector
        vehicles={props.vehicles} vehicleId={props.vehicleId} disabled={props.busy}
        setVehicleId={props.setVehicleId}
      />
      <DateRangeFields
        from={props.from} to={props.to} disabled={props.busy}
        setFrom={props.setFrom} setTo={props.setTo}
      />
      <VehicleArchiveCard
        ready={props.rangeReady} busy={props.busy} pending={props.vehiclePending}
        onImport={props.importVehicleHistory} result={props.vehicleResult}
      />
      <WattpilotCard
        email={props.email} password={props.password} pvSystemId={props.pvSystemId}
        ready={props.wattpilotReady} busy={props.busy} pending={props.wattpilotPending}
        progress={props.progress} result={props.wattpilotResult} setEmail={props.setEmail}
        setPassword={props.setPassword} setPvSystemId={props.setPvSystemId}
        onImport={props.importWattpilotHistory}
      />
      {props.error !== "" && <Text size="2" color="red">{props.error}</Text>}
    </div>
  );
}

export function SolarWebHistoryImport() {
  const [vehicleId, setVehicleId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pvSystemId, setPvSystemId] = useState("");
  const [from, setFrom] = useState(oneYearAgoIsoDate);
  const [to, setTo] = useState(todayIsoDate);
  const [progress, setProgress] = useState("");
  const [wattpilotResult, setWattpilotResult] = useState<WattpilotSummary | null>(null);
  const [vehicleResult, setVehicleResult] = useState<VehicleArchiveSummary | null>(null);
  const [error, setError] = useState("");
  const vehiclesQuery = trpc.vehicle.list.useQuery();
  const vehicleMutation = trpc.history.importVehicleChargingHistory.useMutation();
  const wattpilotMutation = trpc.history.importSolarWeb.useMutation();
  const vehicles = (vehiclesQuery.data?.vehicles ?? []).map((vehicle) => ({
    id: vehicle.id,
    name: vehicle.name,
  }));
  const busy = vehicleMutation.isPending || wattpilotMutation.isPending;
  const rangeReady = vehicleId !== "" && from !== "" && to !== "" && from <= to;
  const wattpilotReady = rangeReady && email !== "" && password !== "" && pvSystemId !== "";

  const importVehicleHistory = async () => {
    if (!rangeReady || busy) return;
    setError("");
    setVehicleResult(null);
    try {
      setVehicleResult(await vehicleMutation.mutateAsync({ vehicleId, from, to }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const importWattpilotHistory = async () => {
    if (!wattpilotReady || busy) return;
    const batches = buildDateBatches(from, to);
    setError("");
    setWattpilotResult(null);
    try {
      const result = await importBatchSequence(
        batches,
        0,
        emptyWattpilotSummary(),
        (batch) => wattpilotMutation.mutateAsync({
          vehicleId, email, password, pvSystemId, from: batch.from, to: batch.to,
        }),
        setProgress,
      );
      setWattpilotResult(result);
      setProgress(`Wattpilot import complete · ${batches.length} batches`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setProgress("Import stopped. Re-importing the same period is safe.");
    }
  };

  return (
    <SettingsSection
      icon={<CloudDownload size={18} />}
      title="Vehicle + Wattpilot charging history"
      description="Merge vehicle charging sessions with Solar.web Wattpilot home energy."
    >
      <HistoryImportContent
        vehicles={vehicles} vehicleId={vehicleId} from={from} to={to} busy={busy}
        rangeReady={rangeReady} wattpilotReady={wattpilotReady}
        vehiclePending={vehicleMutation.isPending} wattpilotPending={wattpilotMutation.isPending}
        vehicleResult={vehicleResult} wattpilotResult={wattpilotResult}
        progress={progress} error={error} email={email} password={password}
        pvSystemId={pvSystemId} setVehicleId={setVehicleId} setFrom={setFrom}
        setTo={setTo} setEmail={setEmail} setPassword={setPassword}
        setPvSystemId={setPvSystemId} importVehicleHistory={importVehicleHistory}
        importWattpilotHistory={importWattpilotHistory}
      />
    </SettingsSection>
  );
}
