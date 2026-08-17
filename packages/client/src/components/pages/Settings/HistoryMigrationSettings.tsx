import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Text, TextField } from "@radix-ui/themes";
import { CloudDownload, DatabaseBackup, FileCheck2, Upload } from "lucide-react";
import { trpc } from "../../../trpc.ts";
import { useToast } from "../../../hooks/useToast.tsx";
import { SettingsSection } from "./SettingsLayout.tsx";

interface ChargeHqSummary {
  intervalCount: number;
  firstStartTimeLocal: string | null;
  lastStartTimeLocal: string | null;
  chargedKwh: number;
  solarKwh: number;
  batteryKwh: number;
  gridKwh: number;
  awayKwh: number;
  atHomeKwh: number;
}

interface FilePreview {
  name: string;
  summary: ChargeHqSummary;
}

interface ImportTotals {
  files: number;
  parsedIntervals: number;
  insertedRows: number;
  duplicateRows: number;
  overlapRows: number;
  skippedRows: number;
}

interface HistoryCoverage {
  rowCount: number;
  firstStartTimeLocal: string | null;
  lastStartTimeLocal: string | null;
  chargedWh: number;
}

interface VehicleOption {
  id: string;
  name: string;
}

interface PreviewResponse {
  summary: ChargeHqSummary;
  historyRowCount: number;
}

interface ImportResponse {
  parsedIntervals: number;
  insertedRows: number;
  duplicateRows: number;
  overlapRows: number;
  skippedRows: number;
}

type PreviewCall = (input: { csvText: string }) => Promise<PreviewResponse>;
type ImportCall = (
  input: { csvText: string; vehicleId: string },
) => Promise<ImportResponse>;

interface HistoryMigrationModel {
  vehicles: VehicleOption[];
  vehicleId: string;
  files: File[];
  previews: FilePreview[];
  previewTotals: ChargeHqSummary;
  coverage: HistoryCoverage | null;
  lastImport: ImportTotals | null;
  busy: boolean;
  isAnalyzing: boolean;
  isImporting: boolean;
  readyToImport: boolean;
  setVehicleId: (vehicleId: string) => void;
  selectFiles: (files: FileList | null) => void;
  analyze: () => Promise<void>;
  importHistory: () => Promise<void>;
}

const MAX_FILE_BYTES = 15_000_000;

function formatKwh(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3,
  }).format(value);
}

function formatWhAsKwh(value: number): string {
  return `${formatKwh(value / 1000)} kWh`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected import error";
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearAgoIsoDate(): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function emptyImportTotals(): ImportTotals {
  return {
    files: 0,
    parsedIntervals: 0,
    insertedRows: 0,
    duplicateRows: 0,
    overlapRows: 0,
    skippedRows: 0,
  };
}

function earliestLocal(
  current: string | null,
  candidate: string | null,
): string | null {
  if (candidate === null) return current;
  if (current === null || candidate < current) return candidate;
  return current;
}

function latestLocal(
  current: string | null,
  candidate: string | null,
): string | null {
  if (candidate === null) return current;
  if (current === null || candidate > current) return candidate;
  return current;
}

function summarizePreviews(previews: FilePreview[]): ChargeHqSummary {
  return previews.reduce<ChargeHqSummary>((total, preview) => ({
    intervalCount: total.intervalCount + preview.summary.intervalCount,
    firstStartTimeLocal: earliestLocal(
      total.firstStartTimeLocal,
      preview.summary.firstStartTimeLocal,
    ),
    lastStartTimeLocal: latestLocal(
      total.lastStartTimeLocal,
      preview.summary.lastStartTimeLocal,
    ),
    chargedKwh: total.chargedKwh + preview.summary.chargedKwh,
    solarKwh: total.solarKwh + preview.summary.solarKwh,
    batteryKwh: total.batteryKwh + preview.summary.batteryKwh,
    gridKwh: total.gridKwh + preview.summary.gridKwh,
    awayKwh: total.awayKwh + preview.summary.awayKwh,
    atHomeKwh: total.atHomeKwh + preview.summary.atHomeKwh,
  }), {
    intervalCount: 0,
    firstStartTimeLocal: null,
    lastStartTimeLocal: null,
    chargedKwh: 0,
    solarKwh: 0,
    batteryKwh: 0,
    gridKwh: 0,
    awayKwh: 0,
    atHomeKwh: 0,
  });
}

async function analyzeChargeHqFiles(
  files: File[],
  preview: PreviewCall,
): Promise<FilePreview[]> {
  return await Promise.all(files.map(async (file) => {
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`${file.name} exceeds the 15 MB import limit`);
    }
    const csvText = await file.text();
    const result = await preview({ csvText });
    return { name: file.name, summary: result.summary };
  }));
}

async function importChargeHqFiles(
  files: File[],
  vehicleId: string,
  importFile: ImportCall,
): Promise<ImportTotals> {
  return await files.reduce<Promise<ImportTotals>>(
    async (previousPromise, file) => {
      const previous = await previousPromise;
      const csvText = await file.text();
      const result = await importFile({ csvText, vehicleId });
      return {
        files: previous.files + 1,
        parsedIntervals: previous.parsedIntervals + result.parsedIntervals,
        insertedRows: previous.insertedRows + result.insertedRows,
        duplicateRows: previous.duplicateRows + result.duplicateRows,
        overlapRows: previous.overlapRows + result.overlapRows,
        skippedRows: previous.skippedRows + result.skippedRows,
      };
    },
    Promise.resolve(emptyImportTotals()),
  );
}

function useHistoryMigrationModel(): HistoryMigrationModel {
  const { addToast } = useToast();
  const vehiclesQuery = trpc.vehicle.list.useQuery();
  const vehicles = vehiclesQuery.data?.vehicles ?? [];
  const [vehicleId, setVehicleIdState] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [lastImport, setLastImport] = useState<ImportTotals | null>(null);
  const previewMutation = trpc.history.previewChargeHq.useMutation();
  const importMutation = trpc.history.importChargeHq.useMutation();
  const coverageQuery = trpc.history.getChargeHqCoverage.useQuery(
    { vehicleId },
    { enabled: vehicleId !== "" },
  );

  useEffect(() => {
    if (vehicleId === "" && vehicles.length > 0) {
      setVehicleIdState(vehicles[0].id);
    }
  }, [vehicleId, vehicles]);

  const resetImportState = () => {
    setPreviews([]);
    setLastImport(null);
  };
  const setVehicleId = (value: string) => {
    setVehicleIdState(value);
    setLastImport(null);
  };
  const selectFiles = (fileList: FileList | null) => {
    setFiles(Array.from(fileList ?? []));
    resetImportState();
  };
  const analyze = async () => {
    if (files.length === 0) return;
    setIsAnalyzing(true);
    resetImportState();
    try {
      const result = await analyzeChargeHqFiles(
        files,
        previewMutation.mutateAsync,
      );
      setPreviews(result);
      addToast(`${result.length} ChargeHQ CSV file(s) validated`, "success");
    } catch (error) {
      addToast(errorMessage(error), "error");
    } finally {
      setIsAnalyzing(false);
    }
  };
  const importHistory = async () => {
    if (previews.length !== files.length || vehicleId === "") return;
    setIsImporting(true);
    setLastImport(null);
    try {
      const result = await importChargeHqFiles(
        files,
        vehicleId,
        importMutation.mutateAsync,
      );
      setLastImport(result);
      await coverageQuery.refetch();
      addToast(
        `${result.insertedRows} ChargeHQ history rows imported`,
        "success",
      );
    } catch (error) {
      await coverageQuery.refetch();
      addToast(`${errorMessage(error)}. Safe to retry.`, "error");
    } finally {
      setIsImporting(false);
    }
  };

  return {
    vehicles,
    vehicleId,
    files,
    previews,
    previewTotals: useMemo(() => summarizePreviews(previews), [previews]),
    coverage: coverageQuery.data ?? null,
    lastImport,
    busy: isAnalyzing || isImporting,
    isAnalyzing,
    isImporting,
    readyToImport: files.length > 0 && previews.length === files.length,
    setVehicleId,
    selectFiles,
    analyze,
    importHistory,
  };
}

function DestinationVehicle(
  { vehicles, vehicleId, busy, onChange }: {
    vehicles: VehicleOption[];
    vehicleId: string;
    busy: boolean;
    onChange: (value: string) => void;
  },
) {
  return (
    <div>
      <Text size="2" weight="medium">Destination vehicle</Text>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 2 }}>
        ChargeHQ history is attached to this vehicle. Native E.V Solar readings
        always take priority where histories overlap.
      </Text>
      <select
        value={vehicleId}
        disabled={busy || vehicles.length === 0}
        onChange={(event) => onChange(event.currentTarget.value)}
        style={{
          marginTop: 8,
          minWidth: 240,
          maxWidth: "100%",
          minHeight: 34,
          borderRadius: 6,
          border: "1px solid var(--gray-a7)",
          background: "var(--color-panel-solid)",
          color: "var(--gray-12)",
          padding: "0 10px",
        }}
      >
        {vehicles.length === 0 && <option value="">No vehicle configured</option>}
        {vehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>
        ))}
      </select>
    </div>
  );
}

function ChargeHqFilePicker(
  { files, busy, isAnalyzing, onSelect, onAnalyze }: {
    files: File[];
    busy: boolean;
    isAnalyzing: boolean;
    onSelect: (files: FileList | null) => void;
    onAnalyze: () => Promise<void>;
  },
) {
  return (
    <div>
      <Text size="2" weight="medium">ChargeHQ Interval Data CSV files</Text>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 2 }}>
        Select one or several exports. Overlapping files and repeated imports
        are safe because imported rows are deduplicated.
      </Text>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          disabled={busy}
          onChange={(event) => onSelect(event.currentTarget.files)}
        />
        <Button
          size="2"
          variant="soft"
          disabled={busy || files.length === 0}
          onClick={onAnalyze}
        >
          <FileCheck2 size={15} />
          {isAnalyzing ? "Analyzing..." : "Analyze"}
        </Button>
      </div>
    </div>
  );
}

function ChargeHqFileList(
  { files, previews }: { files: File[]; previews: FilePreview[] },
) {
  if (files.length === 0) return null;
  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {files.map((file, index) => {
          const preview = previews[index];
          return (
            <div
              key={`${file.name}-${file.lastModified}-${index}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Text size="2" weight="medium">{file.name}</Text>
                {preview && (
                  <Text size="1" color="gray" style={{ display: "block" }}>
                    {preview.summary.firstStartTimeLocal ?? "?"} →{" "}
                    {preview.summary.lastStartTimeLocal ?? "?"} ·{" "}
                    {preview.summary.intervalCount} intervals ·{" "}
                    {formatKwh(preview.summary.chargedKwh)} kWh
                  </Text>
                )}
              </div>
              <Badge color={preview ? "green" : "gray"} variant="soft">
                {preview ? "Validated" : "Pending"}
              </Badge>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ChargeHqPreview({ summary }: { summary: ChargeHqSummary }) {
  return (
    <Card>
      <Text size="2" weight="bold">Import preview</Text>
      <Text size="2" style={{ display: "block", marginTop: 6 }}>
        {summary.intervalCount} intervals · {formatKwh(summary.chargedKwh)} kWh total
      </Text>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
        {summary.firstStartTimeLocal ?? "?"} → {summary.lastStartTimeLocal ?? "?"}
      </Text>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
        Home solar {formatKwh(summary.solarKwh)} kWh · Home battery{" "}
        {formatKwh(summary.batteryKwh)} kWh · Grid {formatKwh(summary.gridKwh)} kWh · Away{" "}
        {formatKwh(summary.awayKwh)} kWh
      </Text>
    </Card>
  );
}

function ExistingArchive({ coverage }: { coverage: HistoryCoverage | null }) {
  if (!coverage || coverage.rowCount === 0) return null;
  return (
    <Card>
      <Text size="2" weight="bold">Existing ChargeHQ archive</Text>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
        {coverage.firstStartTimeLocal ?? "?"} → {coverage.lastStartTimeLocal ?? "?"} ·{" "}
        {coverage.rowCount} rows · {formatWhAsKwh(coverage.chargedWh)}
      </Text>
    </Card>
  );
}

function importButtonLabel(isImporting: boolean, fileCount: number): string {
  if (isImporting) return "Importing...";
  return `Import ${fileCount || ""} file${fileCount === 1 ? "" : "s"}`;
}

function ImportControls({ model }: { model: HistoryMigrationModel }) {
  const hasVehicle = model.vehicleId !== "" && model.vehicles.length > 0;
  const disabled = model.busy || !model.readyToImport || !hasVehicle;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <Button size="2" disabled={disabled} onClick={model.importHistory}>
        <Upload size={15} />
        {importButtonLabel(model.isImporting, model.files.length)}
      </Button>
      <Text size="1" color="gray">
        Re-importing the same data does not create duplicates.
      </Text>
    </div>
  );
}

function ImportResultCard({ result }: { result: ImportTotals | null }) {
  if (!result) return null;
  return (
    <Card style={{ borderLeft: "3px solid var(--green-9)" }}>
      <Text size="2" weight="bold">Migration complete</Text>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
        {result.files} files · {result.parsedIntervals} intervals · {result.insertedRows}{" "}
        rows added · {result.duplicateRows} duplicates skipped · {result.overlapRows}{" "}
        native-overlap rows skipped
      </Text>
    </Card>
  );
}

function SolarWebHistoryImport() {
  const { addToast } = useToast();
  const mutation = trpc.history.importSolarWeb.useMutation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pvSystemId, setPvSystemId] = useState("");
  const [from, setFrom] = useState(oneYearAgoIsoDate);
  const [to, setTo] = useState(todayIsoDate);

  const canImport = email !== "" && password !== "" && pvSystemId !== "" &&
    from !== "" && to !== "" && from <= to && !mutation.isPending;

  const importHistory = async () => {
    if (!canImport) return;
    try {
      const result = await mutation.mutateAsync({
        email,
        password,
        pvSystemId,
        from,
        to,
      });
      addToast(`${result.insertedRows} Solar.web intervals imported`, "success");
    } catch (error) {
      addToast(errorMessage(error), "error");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <CloudDownload size={17} />
          <Text size="2" weight="bold">Solar.web history</Text>
          <Badge size="1" color="green" variant="soft">All vehicles</Badge>
        </div>
        <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
          Import historical Wattpilot energy into global Stats. This does not enable
          Fronius Cloud: your live energy source remains Fronius Local.
        </Text>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <div>
          <Text size="1" weight="medium">Solar.web email</Text>
          <TextField.Root
            mt="1"
            type="email"
            placeholder="name@example.com"
            value={email}
            disabled={mutation.isPending}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
        </div>
        <div>
          <Text size="1" weight="medium">Password</Text>
          <TextField.Root
            mt="1"
            type="password"
            placeholder="Solar.web password"
            value={password}
            disabled={mutation.isPending}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </div>
        <div>
          <Text size="1" weight="medium">PV System ID</Text>
          <TextField.Root
            mt="1"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={pvSystemId}
            disabled={mutation.isPending}
            onChange={(event) => setPvSystemId(event.currentTarget.value)}
          />
        </div>
        <div>
          <Text size="1" weight="medium">From</Text>
          <TextField.Root
            mt="1"
            type="date"
            value={from}
            max={to}
            disabled={mutation.isPending}
            onChange={(event) => setFrom(event.currentTarget.value)}
          />
        </div>
        <div>
          <Text size="1" weight="medium">To</Text>
          <TextField.Root
            mt="1"
            type="date"
            value={to}
            min={from}
            max={todayIsoDate()}
            disabled={mutation.isPending}
            onChange={(event) => setTo(event.currentTarget.value)}
          />
        </div>
      </div>

      <Text size="1" color="gray">
        The login is used only for this import request and is not saved in E.V Solar.
        Solar.web history is not assigned to a specific car. Re-importing is safe;
        native E.V Solar data keeps priority.
      </Text>

      <div>
        <Button size="2" variant="soft" disabled={!canImport} onClick={importHistory}>
          <CloudDownload size={15} />
          {mutation.isPending ? "Importing Solar.web..." : "Import Solar.web history"}
        </Button>
      </div>

      {mutation.isSuccess && (
        <Card style={{ borderLeft: "3px solid var(--green-9)" }}>
          <Text size="2" weight="bold">Solar.web import complete</Text>
          <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
            {mutation.data.insertedRows} intervals added · {formatWhAsKwh(mutation.data.chargedWh)}{" "}
            delivered to EVs — {formatWhAsKwh(mutation.data.solarWh)} solar, {" "}
            {formatWhAsKwh(mutation.data.batteryWh)} home battery, {" "}
            {formatWhAsKwh(mutation.data.gridWh)} grid
          </Text>
        </Card>
      )}
      {mutation.isError && (
        <Text size="2" color="red">{mutation.error.message}</Text>
      )}
    </div>
  );
}

function HistoryMigrationView({ model }: { model: HistoryMigrationModel }) {
  return (
    <SettingsSection
      icon={<DatabaseBackup size={18} />}
      title="History & Migration"
      description="Import legacy ChargeHQ and Solar.web history into E.V Solar Stats without changing live charging."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Text size="2" weight="bold">ChargeHQ CSV</Text>
          <DestinationVehicle
            vehicles={model.vehicles}
            vehicleId={model.vehicleId}
            busy={model.busy}
            onChange={model.setVehicleId}
          />
          <ChargeHqFilePicker
            files={model.files}
            busy={model.busy}
            isAnalyzing={model.isAnalyzing}
            onSelect={model.selectFiles}
            onAnalyze={model.analyze}
          />
          <ChargeHqFileList files={model.files} previews={model.previews} />
          {model.readyToImport && <ChargeHqPreview summary={model.previewTotals} />}
          <ExistingArchive coverage={model.coverage} />
          <ImportControls model={model} />
          <ImportResultCard result={model.lastImport} />
        </div>

        <div style={{ borderTop: "1px solid var(--gray-a5)", paddingTop: 16 }}>
          <SolarWebHistoryImport />
        </div>
      </div>
    </SettingsSection>
  );
}

export function HistoryMigrationSettings() {
  return <HistoryMigrationView model={useHistoryMigrationModel()} />;
}
