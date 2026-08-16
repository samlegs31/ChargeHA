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
  size: number;
  historyRowCount: number;
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

export function HistoryMigrationSettings() {
  const { addToast } = useToast();
  const vehiclesQuery = trpc.vehicles.list.useQuery();
  const vehicles = vehiclesQuery.data?.vehicles ?? [];
  const [vehicleId, setVehicleId] = useState("");
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
      setVehicleId(vehicles[0].id);
    }
  }, [vehicleId, vehicles]);

  const previewTotals = useMemo(
    () => previews.reduce(
      (total, preview) => ({
        intervals: total.intervals + preview.summary.intervalCount,
        chargedKwh: total.chargedKwh + preview.summary.chargedKwh,
        solarKwh: total.solarKwh + preview.summary.solarKwh,
        batteryKwh: total.batteryKwh + preview.summary.batteryKwh,
        gridKwh: total.gridKwh + preview.summary.gridKwh,
        awayKwh: total.awayKwh + preview.summary.awayKwh,
      }),
      {
        intervals: 0,
        chargedKwh: 0,
        solarKwh: 0,
        batteryKwh: 0,
        gridKwh: 0,
        awayKwh: 0,
      },
    ),
    [previews],
  );

  const selectedFilesAreAnalyzed = files.length > 0 &&
    previews.length === files.length;
  const busy = isAnalyzing || isImporting;

  const analyzeFiles = async () => {
    if (files.length === 0) return;
    setIsAnalyzing(true);
    setPreviews([]);
    setLastImport(null);
    try {
      const analyzed = await files.reduce<Promise<FilePreview[]>>(
        async (previousPromise, file) => {
          const previous = await previousPromise;
          if (file.size > MAX_FILE_BYTES) {
            throw new Error(`${file.name} exceeds the 15 MB import limit`);
          }
          const csvText = await file.text();
          const result = await previewMutation.mutateAsync({ csvText });
          return [...previous, {
            name: file.name,
            size: file.size,
            historyRowCount: result.historyRowCount,
            summary: result.summary,
          }];
        },
        Promise.resolve([]),
      );
      setPreviews(analyzed);
      addToast(
        `${analyzed.length} ChargeHQ CSV file${analyzed.length === 1 ? "" : "s"} validated`,
        "success",
      );
    } catch (error) {
      addToast(errorMessage(error), "error");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const importFiles = async () => {
    if (!selectedFilesAreAnalyzed || vehicleId === "") return;
    setIsImporting(true);
    setLastImport(null);
    try {
      const totals = await files.reduce<Promise<ImportTotals>>(
        async (previousPromise, file) => {
          const previous = await previousPromise;
          const csvText = await file.text();
          const result = await importMutation.mutateAsync({ csvText, vehicleId });
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
      setLastImport(totals);
      await coverageQuery.refetch();
      addToast(
        `${totals.insertedRows} ChargeHQ history rows imported`,
        "success",
      );
    } catch (error) {
      await coverageQuery.refetch();
      addToast(
        `${errorMessage(error)}. Files already imported are safe to retry.`,
        "error",
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <SettingsSection
      icon={<DatabaseBackup size={18} />}
      title="History & Migration"
      description="Migrate legacy ChargeHQ Interval Data into E.V Solar Stats without changing live charging."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <Text size="2" weight="medium">Destination vehicle</Text>
          <Text size="1" color="gray" style={{ display: "block", marginTop: 2 }}>
            ChargeHQ history is attached to this E.V Solar vehicle. Native E.V
            Solar readings always take priority where the histories overlap.
          </Text>
          <select
            value={vehicleId}
            disabled={busy || vehicles.length === 0}
            onChange={(event) => {
              setVehicleId(event.currentTarget.value);
              setLastImport(null);
            }}
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
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Text size="2" weight="medium">ChargeHQ Interval Data CSV files</Text>
          <Text size="1" color="gray" style={{ display: "block", marginTop: 2 }}>
            Select one or several yearly exports. Files are analyzed and imported
            sequentially, so overlapping exports and repeated imports remain safe.
          </Text>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              disabled={busy}
              onChange={(event) => {
                setFiles(Array.from(event.currentTarget.files ?? []));
                setPreviews([]);
                setLastImport(null);
              }}
            />
            <Button
              size="2"
              variant="soft"
              disabled={busy || files.length === 0}
              onClick={analyzeFiles}
            >
              <FileCheck2 size={15} />
              {isAnalyzing ? "Analyzing..." : "Analyze"}
            </Button>
          </div>
        </div>

        {files.length > 0 && (
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
                          {preview.summary.firstStartTimeLocal ?? "?"} → {preview.summary.lastStartTimeLocal ?? "?"}
                          {" · "}{preview.summary.intervalCount} intervals
                          {" · "}{formatKwh(preview.summary.chargedKwh)} kWh
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
        )}

        {selectedFilesAreAnalyzed && (
          <Card>
            <Text size="2" weight="bold">Import preview</Text>
            <Text size="2" style={{ display: "block", marginTop: 6 }}>
              {previewTotals.intervals} intervals · {formatKwh(previewTotals.chargedKwh)} kWh total
            </Text>
            <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
              Home solar {formatKwh(previewTotals.solarKwh)} kWh · Home battery {formatKwh(previewTotals.batteryKwh)} kWh · Grid {formatKwh(previewTotals.gridKwh)} kWh · Away {formatKwh(previewTotals.awayKwh)} kWh
            </Text>
          </Card>
        )}

        {vehicleId !== "" && coverageQuery.data && coverageQuery.data.rowCount > 0 && (
          <Card>
            <Text size="2" weight="bold">Existing ChargeHQ archive</Text>
            <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
              {coverageQuery.data.firstStartTimeLocal ?? "?"} → {coverageQuery.data.lastStartTimeLocal ?? "?"}
              {" · "}{coverageQuery.data.rowCount} rows
              {" · "}{formatKwh(coverageQuery.data.chargedWh / 1000)} kWh
            </Text>
          </Card>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Button
            size="2"
            disabled={
              busy || !selectedFilesAreAnalyzed || vehicleId === "" ||
              vehicles.length === 0
            }
            onClick={importFiles}
          >
            <Upload size={15} />
            {isImporting
              ? "Importing..."
              : `Import ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
          </Button>
          <Text size="1" color="gray">
            Re-importing the same data does not create duplicates.
          </Text>
        </div>

        {lastImport && (
          <Card style={{ borderLeft: "3px solid var(--green-9)" }}>
            <Text size="2" weight="bold">Migration complete</Text>
            <Text size="1" color="gray" style={{ display: "block", marginTop: 4 }}>
              {lastImport.files} files · {lastImport.parsedIntervals} intervals · {lastImport.insertedRows} rows added · {lastImport.duplicateRows} duplicates skipped · {lastImport.overlapRows} native-overlap rows skipped
            </Text>
          </Card>
        )}
      </div>
    </SettingsSection>
  );
}
