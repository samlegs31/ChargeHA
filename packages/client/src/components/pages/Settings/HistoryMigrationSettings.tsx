import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Text } from "@radix-ui/themes";
import { DatabaseBackup, Upload } from "lucide-react";
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
  selectFiles: (files: FileList | null) => Promise<void>;
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
  const homeSourceMutation = trpc.history.setHomeChargingSource.useMutation();
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
  const selectFiles = async (fileList: FileList | null) => {
    const selected = Array.from(fileList ?? []);
    setFiles(selected);
    resetImportState();
    if (selected.length === 0) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeChargeHqFiles(
        selected,
        previewMutation.mutateAsync,
      );
      setPreviews(result);
      addToast(`${result.length} ChargeHQ file(s) ready to import`, "success");
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
      await homeSourceMutation.mutateAsync({ vehicleId, source: "chargehq" });
      await coverageQuery.refetch();
      addToast("ChargeHQ history imported and linked to this car", "success");
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
      <Text size="2" weight="medium">Which car is this file for?</Text>
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
        {vehicles.length === 0 && <option value="">No car connected</option>}
        {vehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>
        ))}
      </select>
    </div>
  );
}

function ChargeHqFilePicker(
  { files, busy, isAnalyzing, onSelect }: {
    files: File[];
    busy: boolean;
    isAnalyzing: boolean;
    onSelect: (files: FileList | null) => Promise<void>;
  },
) {
  return (
    <div>
      <Text size="2" weight="medium">Choose your ChargeHQ CSV file</Text>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 2 }}>
        Choose the Interval Data export from ChargeHQ. E.V. Solar checks it
        automatically.
      </Text>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          disabled={busy}
          onChange={(event) => void onSelect(event.currentTarget.files)}
        />
        {isAnalyzing && <Text size="2" color="gray">Checking file...</Text>}
        {!isAnalyzing && files.length > 0 && (
          <Badge color="green" variant="soft">File checked</Badge>
        )}
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
                    {formatKwh(preview.summary.chargedKwh)} kWh
                  </Text>
                )}
              </div>
              <Badge color={preview ? "green" : "gray"} variant="soft">
                {preview ? "Ready" : "Checking"}
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
    <Card style={{ borderLeft: "3px solid var(--blue-9)" }}>
      <Text size="2" weight="bold">Ready to import</Text>
      <Text size="2" style={{ display: "block", marginTop: 6 }}>
        {formatKwh(summary.chargedKwh)} kWh total ·{" "}
        {formatKwh(summary.atHomeKwh)} kWh at home ·{" "}
        {formatKwh(summary.awayKwh)} kWh away
      </Text>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
        {summary.firstStartTimeLocal ?? "?"} →{" "}
        {summary.lastStartTimeLocal ?? "?"}
      </Text>
    </Card>
  );
}

function ExistingArchive({ coverage }: { coverage: HistoryCoverage | null }) {
  if (!coverage || coverage.rowCount === 0) return null;
  return (
    <Card>
      <Text size="2" weight="bold">Already imported</Text>
      <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
        {coverage.firstStartTimeLocal ?? "?"} →{" "}
        {coverage.lastStartTimeLocal ?? "?"} ·{" "}
        {formatKwh(coverage.chargedWh / 1000)} kWh
      </Text>
    </Card>
  );
}

function importButtonLabel(isImporting: boolean): string {
  return isImporting ? "Importing..." : "Import ChargeHQ history";
}

function ImportControls({ model }: { model: HistoryMigrationModel }) {
  const hasVehicle = model.vehicleId !== "" && model.vehicles.length > 0;
  const disabled = model.busy || !model.readyToImport || !hasVehicle;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <Button size="2" disabled={disabled} onClick={model.importHistory}>
        <Upload size={15} />
        {importButtonLabel(model.isImporting)}
      </Button>
      <Text size="1" color="gray">
        Safe to import the same file again.
      </Text>
    </div>
  );
}

function ImportResultCard({ result }: { result: ImportTotals | null }) {
  if (!result) return null;
  return (
    <Card style={{ borderLeft: "3px solid var(--green-9)" }}>
      <Text size="2" weight="bold">Done</Text>
      <Text size="2" style={{ display: "block", marginTop: 4 }}>
        ChargeHQ history is now linked to this car.
      </Text>
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer" }}>Technical details</summary>
        <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
          {result.files} files · {result.parsedIntervals} intervals ·{" "}
          {result.insertedRows} rows added · {result.duplicateRows} duplicates ·
          {" "}
          {result.overlapRows} overlaps skipped
        </Text>
      </details>
    </Card>
  );
}

function HistoryMigrationView({ model }: { model: HistoryMigrationModel }) {
  return (
    <SettingsSection
      icon={<DatabaseBackup size={18} />}
      title="Import a ChargeHQ file"
      description="Use this if this car's old charging history comes from ChargeHQ."
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
        />
        <ChargeHqFileList files={model.files} previews={model.previews} />
        {model.readyToImport && (
          <ChargeHqPreview summary={model.previewTotals} />
        )}
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
