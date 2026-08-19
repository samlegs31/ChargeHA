import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Badge, Button, Card, Text, TextField } from "@radix-ui/themes";
import { Car, CloudDownload } from "lucide-react";
import { trpc } from "../../../trpc.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";

const BATCH_DAYS = 7;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function sevenDaysAgoIsoDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 7);
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
  reportProgress(`Reading Wattpilot ${index + 1} of ${batches.length}...`);
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
      label="Which car uses this Wattpilot?"
      help="Pick the car that is plugged into this Wattpilot at home."
    >
      <select
        value={props.vehicleId}
        disabled={props.disabled || props.vehicles.length === 0}
        onChange={(event) => props.setVehicleId(event.currentTarget.value)}
        style={{
          width: 300,
          maxWidth: "100%",
          height: 34,
          borderRadius: 6,
          border: "1px solid var(--gray-a7)",
          background: "var(--color-panel-solid)",
          color: "var(--gray-12)",
          padding: "0 8px",
        }}
      >
        <option value="">Choose a car...</option>
        {props.vehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>
            {vehicle.name}
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
      <SettingsRow
        label="Start date"
        help="Start with a few older days for the first test."
      >
        <TextField.Root
          size="2"
          type="date"
          value={props.from}
          max={props.to}
          disabled={props.disabled}
          onChange={(event) => props.setFrom(event.currentTarget.value)}
          style={{ width: 180 }}
        />
      </SettingsRow>
      <SettingsRow label="End date">
        <TextField.Root
          size="2"
          type="date"
          value={props.to}
          min={props.from}
          max={todayIsoDate()}
          disabled={props.disabled}
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
          size="2"
          type="email"
          placeholder="name@email.com"
          value={props.email}
          disabled={props.disabled}
          onChange={(event) => props.setEmail(event.currentTarget.value)}
          style={{ width: 260 }}
        />
      </SettingsRow>
      <SettingsRow label="Solar.web password">
        <TextField.Root
          size="2"
          type="password"
          placeholder="Password"
          value={props.password}
          disabled={props.disabled}
          onChange={(event) => props.setPassword(event.currentTarget.value)}
          style={{ width: 260 }}
        />
      </SettingsRow>
      <SettingsRow
        label="PV System ID"
        help="The long ID at the end of your Solar.web system URL."
      >
        <TextField.Root
          size="2"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={props.pvSystemId}
          disabled={props.disabled}
          onChange={(event) => props.setPvSystemId(event.currentTarget.value)}
          style={{ width: 320 }}
        />
      </SettingsRow>
    </>
  );
}

function TechnicalDetails({ children }: { children: ReactNode }) {
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: "pointer" }}>Technical details</summary>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
        {children}
      </Text>
    </details>
  );
}

function VehicleArchiveResult(props: VehicleArchiveSummary) {
  const empty = props.sessionsMatched === 0 || props.intervalsBuilt === 0;
  return (
    <Card
      style={{
        borderLeft: `3px solid var(--${empty ? "orange" : "blue"}-9)`,
      }}
    >
      <Text size="2" weight="bold" color={empty ? "orange" : undefined}>
        {empty ? "No charging sessions imported" : "Car history imported"}
      </Text>
      <Text size="2" style={{ display: "block", marginTop: 4 }}>
        {empty
          ? "E.V. Solar could not find usable charging sessions for this car and date range."
          : `${formatKwh(props.chargedWh)} found for this car.`}
      </Text>
      {props.truncated && (
        <Text
          size="1"
          color="orange"
          style={{ display: "block", marginTop: 5 }}
        >
          The vehicle service returned only part of the archive. Try a smaller date range.
        </Text>
      )}
      <TechnicalDetails>
        {props.sessionsRead} sessions read · {props.sessionsMatched} matched ·{" "}
        {props.intervalsBuilt} intervals · {props.duplicateRows} duplicates ·{" "}
        {props.overlapRows} overlaps
      </TechnicalDetails>
    </Card>
  );
}

function WattpilotResult(props: WattpilotSummary) {
  if (props.samplesRead === 0) {
    return (
      <Card style={{ borderLeft: "3px solid var(--orange-9)" }}>
        <Text size="2" weight="bold" color="orange">
          No Solar.web data found for these dates
        </Text>
        <Text size="2" style={{ display: "block", marginTop: 4 }}>
          Try an older date range. Recent Solar.web history can arrive later.
        </Text>
      </Card>
    );
  }

  if (props.chargingIntervals === 0) {
    return (
      <Card style={{ borderLeft: "3px solid var(--orange-9)" }}>
        <Text size="2" weight="bold" color="orange">
          Solar.web has data, but no Wattpilot charge was found
        </Text>
        <Text size="2" style={{ display: "block", marginTop: 4 }}>
          Check the dates and make sure this is the correct Solar.web system.
        </Text>
        <TechnicalDetails>
          {props.samplesRead} Solar.web samples read.
        </TechnicalDetails>
      </Card>
    );
  }

  return (
    <Card style={{ borderLeft: "3px solid var(--green-9)" }}>
      <Text size="2" weight="bold">Wattpilot home history imported</Text>
      <Text size="2" style={{ display: "block", marginTop: 4 }}>
        {formatKwh(props.chargedWh)} at home · {formatKwh(props.solarWh)} solar ·{" "}
        {formatKwh(props.batteryWh)} battery · {formatKwh(props.gridWh)} grid
      </Text>
      <TechnicalDetails>
        {props.samplesRead} samples · {props.chargingIntervals} charging intervals ·{" "}
        {props.duplicateRows} duplicates · {props.overlapRows} overlaps
      </TechnicalDetails>
    </Card>
  );
}

function StepHeader(
  { number, title, help }: { number: number; title: string; help: string },
) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <Badge size="2" variant="solid" radius="full">{number}</Badge>
      <div>
        <Text size="2" weight="bold">{title}</Text>
        <Text size="1" color="gray" style={{ display: "block", marginTop: 2 }}>
          {help}
        </Text>
      </div>
    </div>
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
      <StepHeader
        number={1}
        title="Get the car's charging sessions"
        help="E.V. Solar asks the car service for charging sessions in the dates above."
      />
      <Button
        size="2"
        disabled={!props.ready || props.busy}
        onClick={props.onImport}
        style={{ marginTop: 12 }}
      >
        <Car size={15} />
        {props.pending ? "Reading car history..." : "Import car history"}
      </Button>
      {props.result !== null && (
        <div style={{ marginTop: 10 }}>
          <VehicleArchiveResult {...props.result} />
        </div>
      )}
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
      <StepHeader
        number={2}
        title="Find the charges that happened at home"
        help="E.V. Solar reads Wattpilot energy from Solar.web and links it to this car."
      />
      <Text
        size="1"
        color="gray"
        style={{ display: "block", margin: "10px 0" }}
      >
        Your Solar.web login is used only for this import and is not saved here.
      </Text>
      <SolarWebFields
        email={props.email}
        password={props.password}
        pvSystemId={props.pvSystemId}
        disabled={props.busy}
        setEmail={props.setEmail}
        setPassword={props.setPassword}
        setPvSystemId={props.setPvSystemId}
      />
      <Button
        size="2"
        disabled={!props.ready || props.busy}
        onClick={props.onImport}
        style={{ marginTop: 8 }}
      >
        <CloudDownload size={15} />
        {props.pending ? "Reading Wattpilot..." : "Import Wattpilot home history"}
      </Button>
      {props.progress !== "" && (
        <Text size="1" color="gray" style={{ display: "block", marginTop: 8 }}>
          {props.progress}
        </Text>
      )}
      {props.result !== null && (
        <div style={{ marginTop: 10 }}>
          <WattpilotResult {...props.result} />
        </div>
      )}
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
      <Text size="2">
        For a car that charges at home with a Wattpilot, do Step 1 and then Step 2.
      </Text>
      <VehicleSelector
        vehicles={props.vehicles}
        vehicleId={props.vehicleId}
        disabled={props.busy}
        setVehicleId={props.setVehicleId}
      />
      <DateRangeFields
        from={props.from}
        to={props.to}
        disabled={props.busy}
        setFrom={props.setFrom}
        setTo={props.setTo}
      />
      <VehicleArchiveCard
        ready={props.rangeReady}
        busy={props.busy}
        pending={props.vehiclePending}
        onImport={props.importVehicleHistory}
        result={props.vehicleResult}
      />
      <WattpilotCard
        email={props.email}
        password={props.password}
        pvSystemId={props.pvSystemId}
        ready={props.wattpilotReady}
        busy={props.busy}
        pending={props.wattpilotPending}
        progress={props.progress}
        result={props.wattpilotResult}
        setEmail={props.setEmail}
        setPassword={props.setPassword}
        setPvSystemId={props.setPvSystemId}
        onImport={props.importWattpilotHistory}
      />
      {props.error !== "" && (
        <Card style={{ borderLeft: "3px solid var(--red-9)" }}>
          <Text size="2" color="red" weight="bold">Import failed</Text>
          <Text size="2" style={{ display: "block", marginTop: 4 }}>
            {props.error}
          </Text>
        </Card>
      )}
    </div>
  );
}

function useHistoryImportModel(): HistoryImportContentProps {
  const [vehicleId, setVehicleId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pvSystemId, setPvSystemId] = useState("");
  const [from, setFrom] = useState(sevenDaysAgoIsoDate);
  const [to, setTo] = useState(todayIsoDate);
  const [progress, setProgress] = useState("");
  const [wattpilotResult, setWattpilotResult] =
    useState<WattpilotSummary | null>(null);
  const [vehicleResult, setVehicleResult] =
    useState<VehicleArchiveSummary | null>(null);
  const [error, setError] = useState("");
  const utils = trpc.useUtils();
  const vehiclesQuery = trpc.vehicle.list.useQuery();
  const vehicleMutation = trpc.history.importVehicleChargingHistory.useMutation();
  const wattpilotMutation = trpc.history.importSolarWeb.useMutation();
  const homeSourceMutation = trpc.history.setHomeChargingSource.useMutation();
  const rawVehicles = vehiclesQuery.data?.vehicles ?? [];
  const vehicles = rawVehicles.map((vehicle) => ({
    id: vehicle.id,
    name: vehicle.name,
  }));
  const busy = vehicleMutation.isPending || wattpilotMutation.isPending ||
    homeSourceMutation.isPending;
  const rangeReady = vehicleId !== "" && from !== "" && to !== "" && from <= to;
  const wattpilotReady = rangeReady && email !== "" && password !== "" &&
    pvSystemId !== "";

  useEffect(() => {
    if (vehicleId !== "") return;
    const preferred = rawVehicles.find((vehicle) =>
      vehicle.homeChargingSource === "solarweb"
    );
    if (preferred) setVehicleId(preferred.id);
    else if (rawVehicles.length === 1) setVehicleId(rawVehicles[0].id);
  }, [rawVehicles, vehicleId]);

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
        (batch) =>
          wattpilotMutation.mutateAsync({
            vehicleId,
            email,
            password,
            pvSystemId,
            from: batch.from,
            to: batch.to,
          }),
        setProgress,
      );
      setWattpilotResult(result);
      if (result.samplesRead > 0 && result.chargingIntervals > 0) {
        await homeSourceMutation.mutateAsync({ vehicleId, source: "solarweb" });
        await Promise.all([
          utils.vehicle.list.invalidate(),
          utils.stats.invalidate(),
        ]);
        setProgress("Done. Wattpilot is now this car's home-history source.");
      } else {
        setProgress("Import finished, but no home charge was found.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setProgress("Stopped. It is safe to try the same dates again.");
    }
  };

  return {
    vehicles,
    vehicleId,
    from,
    to,
    busy,
    rangeReady,
    wattpilotReady,
    vehiclePending: vehicleMutation.isPending,
    wattpilotPending: wattpilotMutation.isPending,
    vehicleResult,
    wattpilotResult,
    progress,
    error,
    email,
    password,
    pvSystemId,
    setVehicleId,
    setFrom,
    setTo,
    setEmail,
    setPassword,
    setPvSystemId,
    importVehicleHistory,
    importWattpilotHistory,
  };
}

export function SolarWebHistoryImport() {
  const model = useHistoryImportModel();
  return (
    <SettingsSection
      icon={<CloudDownload size={18} />}
      title="Import Wattpilot history"
      description="Use this for a car that charges at home with a Wattpilot."
    >
      <HistoryImportContent {...model} />
    </SettingsSection>
  );
}
