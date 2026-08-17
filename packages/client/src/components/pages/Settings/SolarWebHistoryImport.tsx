import { useState } from "react";
import { Badge, Button, Card, Text, TextField } from "@radix-ui/themes";
import { CloudDownload } from "lucide-react";
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

function formatKwh(wh: number): string {
  return `${(wh / 1000).toFixed(1)} kWh`;
}

function shiftedIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
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

interface ImportSummary {
  insertedRows: number;
  chargedWh: number;
  solarWh: number;
  batteryWh: number;
  gridWh: number;
}

const EMPTY_SUMMARY: ImportSummary = {
  insertedRows: 0,
  chargedWh: 0,
  solarWh: 0,
  batteryWh: 0,
  gridWh: 0,
};

function addImportResult(
  summary: ImportSummary,
  result: ImportSummary,
): ImportSummary {
  return {
    insertedRows: summary.insertedRows + result.insertedRows,
    chargedWh: summary.chargedWh + result.chargedWh,
    solarWh: summary.solarWh + result.solarWh,
    batteryWh: summary.batteryWh + result.batteryWh,
    gridWh: summary.gridWh + result.gridWh,
  };
}

interface FieldsProps {
  email: string;
  password: string;
  pvSystemId: string;
  from: string;
  to: string;
  disabled: boolean;
  hasSavedPassword: boolean;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setPvSystemId: (value: string) => void;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
}

function SolarWebFields(props: FieldsProps) {
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
      <SettingsRow
        label="Solar.web password"
        help={props.hasSavedPassword
          ? "Saved encrypted password will be used if this field is left blank."
          : undefined}
      >
        <TextField.Root
          size="2" type="password"
          placeholder={props.hasSavedPassword ? "Saved password" : "Password"}
          value={props.password} disabled={props.disabled}
          onChange={(event) => props.setPassword(event.currentTarget.value)}
          style={{ width: 260 }}
        />
      </SettingsRow>
      <SettingsRow
        label="PV System ID"
        help="Use the pvSystemId value from your logged-in Solar.web system URL."
      >
        <TextField.Root
          size="2" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={props.pvSystemId} disabled={props.disabled}
          onChange={(event) => props.setPvSystemId(event.currentTarget.value)}
          style={{ width: 320 }}
        />
      </SettingsRow>
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

function ImportResult(props: ImportSummary) {
  return (
    <Card style={{ borderLeft: "3px solid var(--green-9)" }}>
      <Badge color="green" variant="soft">
        {props.insertedRows} intervals imported
      </Badge>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 6 }}>
        {formatKwh(props.chargedWh)} charged at home · {formatKwh(props.solarWh)} solar ·{" "}
        {formatKwh(props.batteryWh)} home battery · {formatKwh(props.gridWh)} grid
      </Text>
    </Card>
  );
}

function ImportDescription() {
  return (
    <Text size="1" color="gray">
      Solar.web email, PV System ID and password are saved on this E.V. Solar
      installation for future archive imports. The password is encrypted at rest and is
      never returned to the browser. These credentials are not used as your realtime
      energy source. Only home Wattpilot charging is imported, for all vehicles combined.
    </Text>
  );
}

function ImportHelpText() {
  return (
    <Text size="1" color="gray">
      Large archives are automatically imported in 7-day batches. Re-importing the same
      period is safe.
    </Text>
  );
}

export function SolarWebHistoryImport() {
  const [emailOverride, setEmailOverride] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [pvSystemIdOverride, setPvSystemIdOverride] = useState<string | null>(null);
  const [from, setFrom] = useState(oneYearAgoIsoDate);
  const [to, setTo] = useState(todayIsoDate);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState("");

  if (!trpc.history?.importSolarWeb) return null;

  const savedCredentials = trpc.history.getSolarWebImportCredentials.useQuery();
  const mutation = trpc.history.importSolarWeb.useMutation();
  const savedEmail = savedCredentials.data?.email ?? "";
  const email = emailOverride ?? savedEmail;
  const pvSystemId = pvSystemIdOverride ?? savedCredentials.data?.pvSystemId ?? "";
  const hasSavedPassword = savedCredentials.data?.hasPassword === true &&
    savedEmail !== "" && email === savedEmail;
  const ready = email !== "" && (password !== "" || hasSavedPassword) &&
    pvSystemId !== "" && from !== "" && to !== "" && from <= to && !isImporting;

  async function importBatchSequence(
    batches: readonly DateBatch[],
    index: number,
    summary: ImportSummary,
  ): Promise<ImportSummary> {
    const batch = batches[index];
    if (batch === undefined) return summary;

    setProgress(
      `Importing batch ${index + 1} / ${batches.length} · ${batch.from} → ${batch.to}`,
    );
    const batchResult = await mutation.mutateAsync({
      email,
      password,
      pvSystemId,
      from: batch.from,
      to: batch.to,
    });
    return await importBatchSequence(
      batches,
      index + 1,
      addImportResult(summary, batchResult),
    );
  }

  const importHistory = async () => {
    if (!ready) return;
    const batches = buildDateBatches(from, to);
    setIsImporting(true);
    setImportError("");
    setResult(null);
    try {
      const completed = await importBatchSequence(batches, 0, EMPTY_SUMMARY);
      setResult(completed);
      setProgress(`Import complete · ${batches.length} batches`);
      await savedCredentials.refetch();
      setEmailOverride(null);
      setPvSystemIdOverride(null);
      setPassword("");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
      setProgress("Import stopped. Re-importing the same period is safe.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <SettingsSection
      icon={<CloudDownload size={18} />}
      title="Solar.web home EV history"
      description="One-time Wattpilot archive import. Your active realtime energy source is not changed."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <ImportDescription />
        <SolarWebFields
          email={email} password={password} pvSystemId={pvSystemId}
          from={from} to={to} disabled={isImporting}
          hasSavedPassword={hasSavedPassword}
          setEmail={setEmailOverride} setPassword={setPassword}
          setPvSystemId={setPvSystemIdOverride} setFrom={setFrom} setTo={setTo}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Button size="2" disabled={!ready} onClick={importHistory}>
            <CloudDownload size={15} />
            {isImporting ? "Importing Solar.web history..." : "Import Solar.web home EV history"}
          </Button>
          <ImportHelpText />
        </div>
        {progress !== "" && <Text size="1" color="gray">{progress}</Text>}
        {result !== null && <ImportResult {...result} />}
        {importError !== "" && <Text size="2" color="red">{importError}</Text>}
      </div>
    </SettingsSection>
  );
}
