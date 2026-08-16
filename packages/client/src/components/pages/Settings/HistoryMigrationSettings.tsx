import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Text } from "@radix-ui/themes";
import { DatabaseBackup, FileCheck2, Upload } from "lucide-react";
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected import error";
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

function summarizePreviews(previews: FilePreview[]): ChargeHqSummary {
  return previews.reduce<ChargeHqSummary>((total, preview) => ({
    intervalCount: total.intervalCount + preview.summary.intervalCount,
    firstStartTimeLocal: total.firstStartTimeLocal,
    lastStartTimeLocal: preview.summary.lastStartTimeLocal,
    chargedKwh: total.chargedKwh + preview.summary.chargedKwh,
    solarKwh: total.solarKwh + preview.summary.solarKwh,
    batteryKwh: total.batteryKwh + preview.summary.batteryKwh,
    gridKwh: total.gridKwh + preview.summary.gridKwh,
    awayKwh: total.awayKwh + preview.summary.awayKwh,
    atHomeKwh: total.atHomeKwh + preview.summary.atHomeKwh,
  }), {
    intervalCount: 0,
    firstStartTimeLocal: previews[0]?.summary.firstStartTimeLocal ?? null,
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
  const vehiclesQuery = trpc.vehicles.list.useQuery();
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
    if (vehicleId === "" && vehicles.length > 0) setVehicleIdState(vehicles[0].id);
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
      const result = await analyzeChargeHqFiles(files, previewMutation.mutateAsync);
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
      addToast(`${result.insertedRows} ChargeHQ history rows imported`, "success");
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
        Imported history is attached to this vehicle. Native E.V Solar readings
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
        Select one or several exports. Overlapping files and repeated imports are
        safe because imported rows are deduplicated.
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
        {coverage.rowCount} rows · {formatKwh(coverage.chargedWh / 1000)} kWh
      </Text>
    </Card>
  );
}

function importButtonLabel(isImporting: boolean, fileCount: number): string {
  if (isImporting) return "Importing...";
  return `Import ${fileCount || ""} file${fileCount === 1 ? "" : "s"}`;
}

function ImportControls(
  { model }: { model: HistoryMigrationModel },
) {
  const disabled = model.busy || !model.readyToImport || model.vehicleId === "" ||
    model.vehicles.length === 0;
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
        {result.files} files · {result.parsedIntervals} intervals ·{" "}
        {result.insertedRows} rows added · {result.duplicateRows} duplicates skipped ·{" "}
        {result.overlapRows} native-overlap rows skipped
      </Text>
    </Card>
  );
}

function HistoryMigrationView({ model }: { model: HistoryMigrationModel }) {
  return (
    <SettingsSection
      icon={<DatabaseBackup size={18} />}
      title="History & Migration"
      description="Migrate legacy ChargeHQ Interval Data into E.V Solar Stats without changing live charging."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
    </SettingsSection>
  );
}

export function HistoryMigrationSettings() {
  return <HistoryMigrationView model={useHistoryMigrationModel()} />;
}
