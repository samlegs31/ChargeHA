import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Badge, Button, Card, Text, TextField } from "@radix-ui/themes";
import { CloudDownload } from "lucide-react";
import { trpc } from "../../../trpc.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";

const BATCH_DAYS = 31;

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

interface HistoryVehicle {
  id: string;
  name: string;
  homeChargingSource?: string | null;
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
  reportProgress(`Reading Wattpilot period ${index + 1} of ${batches.length}...`);
  const result = await importBatch(batch);
  return await importBatchSequence(
    batches,
    index + 1,
    addWattpilotResult(summary, result),
    importBatch,
    reportProgress,
  );
}

function vehicleOptions(vehicles: readonly HistoryVehicle[]) {
  return vehicles.map(({ id, name }) => ({ id, name }));
}

function usePreferredHistoryVehicle(
  vehicles: readonly HistoryVehicle[],
  vehicleId: string,
  setVehicleId: (value: string) => void,
) {
  useEffect(() => {
    if (vehicleId !== "") return;
    const preferred = vehicles.find((vehicle) =>
      vehicle.homeChargingSource === "solarweb"
    );
    if (preferred) setVehicleId(preferred.id);
    else if (vehicles.length === 1) setVehicleId(vehicles[0].id);
  }, [vehicles, vehicleId, setVehicleId]);
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
          <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>
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
        help="Solar.web Wattpilot history is imported as daily energy totals."
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
  hasSavedPassword: boolean;
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
          autoComplete="username"
          placeholder="name@email.com"
          value={props.email}
          disabled={props.disabled}
          onChange={(event) => props.setEmail(event.currentTarget.value)}
          style={{ width: 260 }}
        />
      </SettingsRow>
      <SettingsRow label="Solar.web password">
        <div>
          <TextField.Root
            size="2"
            type="password"
            autoComplete="current-password"
            placeholder={props.hasSavedPassword ? "Saved password" : "Password"}
            value={props.password}
            disabled={props.disabled}
            onChange={(event) => props.setPassword(event.currentTarget.value)}
            style={{ width: 260 }}
          />
          {props.hasSavedPassword && props.password === "" && (
            <Text size="1" color="green" style={{ display: "block", marginTop: 3 }}>
              Saved securely
            </Text>
          )}
        </div>
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

function WattpilotResult(props: WattpilotSummary) {
  if (props.samplesRead === 0) {
    return (
      <Card style={{ borderLeft: "3px solid var(--orange-9)" }}>
        <Text size="2" weight="bold" color="orange">
          No Solar.web aggregate data found for these dates
        </Text>
        <Text size="2" style={{ display: "block", marginTop: 4 }}>
          Check the date range and make sure this is the correct Solar.web system.
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
          The selected period contains no positive Wattpilot energy total.
        </Text>
        <TechnicalDetails>
          {props.samplesRead} daily Solar.web records read.
        </TechnicalDetails>
      </Card>
    );
  }
  return (
    <Card style={{ borderLeft: "3px solid var(--green-9)" }}>
      <Text size="2" weight="bold">Wattpilot home history imported</Text>
      <Text size="2" style={{ display: "block", marginTop: 4 }}>
        {formatKwh(props.chargedWh)} at home · {formatKwh(props.solarWh)} solar · {formatKwh(props.batteryWh)} battery · {formatKwh(props.gridWh)} grid
      </Text>
      <TechnicalDetails>
        {props.samplesRead} daily records · {props.chargingIntervals} Wattpilot days · {props.duplicateRows} duplicates · {props.overlapRows} overlaps
      </TechnicalDetails>
    </Card>
  );
}

function StepHeader(props: { number: number; title: string; help: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <Badge size="2" variant="solid" radius="full">{props.number}</Badge>
      <div>
        <Text size="2" weight="bold">{props.title}</Text>
        <Text size="1" color="gray" style={{ display: "block", marginTop: 2 }}>
          {props.help}
        </Text>
      </div>
    </div>
  );
}

function WattpilotCard(props: {
  email: string;
  password: string;
  pvSystemId: string;
  hasSavedPassword: boolean;
  canSavePassword: boolean;
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
  const securityText = props.canSavePassword
    ? "E.V. Solar remembers these details. Your password is encrypted and stays on this server."
    : "E.V. Solar remembers your email and system ID. Enter the password again next time.";
  return (
    <Card>
      <StepHeader
        number={1}
        title="Import Wattpilot home history"
        help="Solar.web provides daily Wattpilot energy totals. E.V. Solar assigns them directly to the car selected above."
      />
      <Text size="1" color="gray" style={{ display: "block", margin: "10px 0" }}>
        {securityText}
      </Text>
      <SolarWebFields
        email={props.email}
        password={props.password}
        pvSystemId={props.pvSystemId}
        hasSavedPassword={props.hasSavedPassword}
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
        <div style={{ marginTop: 10 }}><WattpilotResult {...props.result} /></div>
      )}
    </Card>
  );
}

function useSolarWebCredentialForm() {
  const savedQuery = trpc.history.getSolarWebCredentials.useQuery();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pvSystemId, setPvSystemId] = useState("");

  useEffect(() => {
    const saved = savedQuery.data;
    if (saved === undefined) return;
    setEmail((current) => current === "" ? saved.email : current);
    setPvSystemId((current) => current === "" ? saved.pvSystemId : current);
  }, [savedQuery.data]);

  return {
    email,
    password,
    pvSystemId,
    hasSavedPassword: savedQuery.data?.hasPassword ?? false,
    canSavePassword: savedQuery.data?.canSavePassword ?? false,
    setEmail,
    setPassword,
    setPvSystemId,
  };
}

function useWattpilotImport(props: {
  vehicleId: string;
  from: string;
  to: string;
  email: string;
  password: string;
  pvSystemId: string;
  ready: boolean;
  clearPassword: () => void;
}) {
  const utils = trpc.useUtils();
  const mutation = trpc.history.importSolarWeb.useMutation();
  const homeSourceMutation = trpc.history.setHomeChargingSource.useMutation();
  const [result, setResult] = useState<WattpilotSummary | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const busy = mutation.isPending || homeSourceMutation.isPending;

  const refreshSavedCredentials = async () => {
    props.clearPassword();
    await utils.history.getSolarWebCredentials.invalidate();
  };

  const importHistory = async () => {
    if (!props.ready || busy) return;
    setError("");
    setResult(null);
    setProgress("");
    try {
      const result = await importBatchSequence(
        buildDateBatches(props.from, props.to),
        0,
        emptyWattpilotSummary(),
        (batch) => mutation.mutateAsync({
          vehicleId: props.vehicleId,
          email: props.email,
          password: props.password === "" ? undefined : props.password,
          pvSystemId: props.pvSystemId,
          from: batch.from,
          to: batch.to,
        }),
        setProgress,
      );
      setResult(result);
      await refreshSavedCredentials();
      if (result.chargingIntervals > 0) {
        await homeSourceMutation.mutateAsync({
          vehicleId: props.vehicleId,
          source: "solarweb",
        });
        await Promise.all([utils.vehicle.list.invalidate(), utils.stats.invalidate()]);
        setProgress("Done. Wattpilot is now this car's home-history source.");
      } else {
        setProgress("Import finished, but no Wattpilot home energy was found.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setProgress("Stopped. It is safe to try the same dates again.");
      await utils.history.getSolarWebCredentials.invalidate();
    }
  };

  return {
    result,
    progress,
    error,
    pending: mutation.isPending,
    busy,
    importHistory,
  };
}

function useHistoryImportModel() {
  const [vehicleId, setVehicleId] = useState("");
  const [from, setFrom] = useState(sevenDaysAgoIsoDate);
  const [to, setTo] = useState(todayIsoDate);
  const credentials = useSolarWebCredentialForm();
  const vehiclesQuery = trpc.vehicle.list.useQuery();
  const rawVehicles = (vehiclesQuery.data?.vehicles ?? []) as HistoryVehicle[];
  const vehicles = vehicleOptions(rawVehicles);
  const rangeReady = vehicleId !== "" && from !== "" && to !== "" && from <= to;
  const credentialsReady = credentials.email !== "" && credentials.pvSystemId !== "";
  const passwordReady = credentials.password !== "" || credentials.hasSavedPassword;
  const wattpilotReady = rangeReady && credentialsReady && passwordReady;
  const wattpilotImport = useWattpilotImport({
    vehicleId,
    from,
    to,
    email: credentials.email,
    password: credentials.password,
    pvSystemId: credentials.pvSystemId,
    ready: wattpilotReady,
    clearPassword: () => credentials.setPassword(""),
  });
  usePreferredHistoryVehicle(rawVehicles, vehicleId, setVehicleId);

  return {
    vehicles,
    vehicleId,
    from,
    to,
    wattpilotReady,
    busy: wattpilotImport.busy,
    wattpilotImport,
    credentials,
    setVehicleId,
    setFrom,
    setTo,
  };
}

function HistoryImportContent({ model }: { model: ReturnType<typeof useHistoryImportModel> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Text size="2">
        Select the car connected to this Wattpilot. Its Solar.web Wattpilot totals are assigned directly to that car; a separate vehicle-service charging-session import is not required.
      </Text>
      <VehicleSelector
        vehicles={model.vehicles}
        vehicleId={model.vehicleId}
        disabled={model.busy}
        setVehicleId={model.setVehicleId}
      />
      <DateRangeFields
        from={model.from}
        to={model.to}
        disabled={model.busy}
        setFrom={model.setFrom}
        setTo={model.setTo}
      />
      <WattpilotCard
        email={model.credentials.email}
        password={model.credentials.password}
        pvSystemId={model.credentials.pvSystemId}
        hasSavedPassword={model.credentials.hasSavedPassword}
        canSavePassword={model.credentials.canSavePassword}
        ready={model.wattpilotReady}
        busy={model.busy}
        pending={model.wattpilotImport.pending}
        progress={model.wattpilotImport.progress}
        result={model.wattpilotImport.result}
        setEmail={model.credentials.setEmail}
        setPassword={model.credentials.setPassword}
        setPvSystemId={model.credentials.setPvSystemId}
        onImport={() => void model.wattpilotImport.importHistory()}
      />
      {model.wattpilotImport.error !== "" && (
        <Card style={{ borderLeft: "3px solid var(--red-9)" }}>
          <Text size="2" color="red" weight="bold">Import failed</Text>
          <Text size="2" style={{ display: "block", marginTop: 4 }}>
            {model.wattpilotImport.error}
          </Text>
        </Card>
      )}
    </div>
  );
}

export function SolarWebHistoryImport() {
  const model = useHistoryImportModel();
  return (
    <SettingsSection
      icon={<CloudDownload size={18} />}
      title="Import Wattpilot history"
      description="Use this for a car that charges at home with a Wattpilot."
    >
      <HistoryImportContent model={model} />
    </SettingsSection>
  );
}
