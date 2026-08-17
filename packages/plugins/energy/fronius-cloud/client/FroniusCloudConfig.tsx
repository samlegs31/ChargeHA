import { useEffect, useState } from "react";
import { Badge, Button, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { SettingsRow } from "../../../hostUi.ts";

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

export function FroniusCloudConfig(): JSX.Element | null {
  const { data: config } = trpc.plugin.energy.fronius_cloud.getConfig
    .useQuery();
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.energy.fronius_cloud.setConfig.useMutation(
    {
      onSuccess: () => utils.plugin.energy.fronius_cloud.getConfig.invalidate(),
    },
  );
  const testMutation = trpc.plugin.energy.fronius_cloud.testConnection
    .useMutation();
  const importHistoryMutation = trpc.plugin.energy.fronius_cloud.importEvHistory
    .useMutation();
  const vehiclesQuery = trpc.vehicle.list.useQuery();
  const vehicles = vehiclesQuery.data?.vehicles ?? [];
  const [historyVehicleId, setHistoryVehicleId] = useState("");
  const [historyFrom, setHistoryFrom] = useState(oneYearAgoIsoDate);
  const [historyTo, setHistoryTo] = useState(todayIsoDate);

  useEffect(() => {
    if (historyVehicleId === "" && vehicles.length > 0) {
      setHistoryVehicleId(vehicles[0].id);
    }
  }, [historyVehicleId, vehicles]);

  if (!config) return null;

  const canImport = historyVehicleId !== "" && historyFrom !== "" &&
    historyTo !== "" && historyFrom <= historyTo &&
    Boolean(config.froniusCloudEmail) && Boolean(config.froniusCloudPassword) &&
    Boolean(config.froniusCloudPvSystemId) && !importHistoryMutation.isPending;

  return (
    <>
      <Text size="1" color="gray">
        Use a Solar.web account that has <code>guest</code>{" "}
        access to this PV system. An existing guest account is fine for local
        testing; a dedicated service account can be used later for hosted E.V
        Solar.
      </Text>

      <SettingsRow label="Email">
        <TextField.Root
          size="2"
          placeholder="guest@email.com"
          value={config.froniusCloudEmail}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ froniusCloudEmail: e.target.value })}
          style={{ width: 220 }}
        />
      </SettingsRow>

      <SettingsRow label="Password">
        <TextField.Root
          size="2"
          type="password"
          placeholder="Solar.web password"
          value={config.froniusCloudPassword}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ froniusCloudPassword: e.target.value })}
          style={{ width: 220 }}
        />
      </SettingsRow>

      <SettingsRow
        label="PV System ID"
        help="Enter only the value after pvSystemId= in your logged-in Solar.web URL (not the guest-link ID and not the full URL)."
      >
        <TextField.Root
          size="2"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={config.froniusCloudPvSystemId}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ froniusCloudPvSystemId: e.target.value })}
          style={{ width: 320 }}
        />
      </SettingsRow>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="2"
          variant="soft"
          disabled={!config.froniusCloudEmail ||
            !config.froniusCloudPassword ||
            !config.froniusCloudPvSystemId ||
            testMutation.isPending}
          onClick={() =>
            testMutation.mutate({
              email: config.froniusCloudEmail,
              password: config.froniusCloudPassword,
              pvSystemId: config.froniusCloudPvSystemId,
            })}
        >
          {testMutation.isPending ? "Testing..." : "Test Connection"}
        </Button>

        {testMutation.isSuccess && testMutation.data.success && (
          <Badge color="green" size="2">
            Connected{testMutation.data.systemName
              ? ` — ${testMutation.data.systemName}`
              : ""}
          </Badge>
        )}
        {testMutation.isError && (
          <Text size="2" color="red">{testMutation.error.message}</Text>
        )}
        {testMutation.isSuccess && !testMutation.data.success && (
          <Text size="2" color="red">
            {testMutation.data.error ?? "Connection failed"}
          </Text>
        )}
      </div>

      <div
        style={{
          marginTop: 18,
          paddingTop: 16,
          borderTop: "1px solid var(--gray-a5)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <Text size="2" weight="bold">Import Solar.web EV history</Text>
        <Text size="1" color="gray">
          Imports historical Wattpilot charging directly from Solar.web and
          adds it to E.V Solar Stats, split into solar, home battery and grid
          energy. Re-importing the same period is safe: duplicate intervals are
          ignored and native E.V Solar readings keep priority.
        </Text>

        <SettingsRow label="Vehicle">
          <select
            value={historyVehicleId}
            onChange={(event) => setHistoryVehicleId(event.target.value)}
            disabled={vehicles.length === 0 || importHistoryMutation.isPending}
            style={{
              minWidth: 220,
              height: 32,
              borderRadius: 6,
              border: "1px solid var(--gray-a7)",
              background: "var(--color-panel-solid)",
              padding: "0 8px",
            }}
          >
            {vehicles.length === 0 && (
              <option value="">No vehicle configured</option>
            )}
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>
            ))}
          </select>
        </SettingsRow>

        <SettingsRow label="From">
          <TextField.Root
            size="2"
            type="date"
            value={historyFrom}
            max={historyTo}
            disabled={importHistoryMutation.isPending}
            onChange={(event: { target: { value: string } }) =>
              setHistoryFrom(event.target.value)}
            style={{ width: 180 }}
          />
        </SettingsRow>

        <SettingsRow label="To">
          <TextField.Root
            size="2"
            type="date"
            value={historyTo}
            min={historyFrom}
            max={todayIsoDate()}
            disabled={importHistoryMutation.isPending}
            onChange={(event: { target: { value: string } }) =>
              setHistoryTo(event.target.value)}
            style={{ width: 180 }}
          />
        </SettingsRow>

        <Text size="1" color="gray">
          The first run defaults to the last 12 months. Move the From date back
          to the beginning of your Solar.web history to import older years. For
          very large archives, importing year by year is recommended.
        </Text>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Button
            size="2"
            variant="soft"
            disabled={!canImport}
            onClick={() =>
              importHistoryMutation.mutate({
                vehicleId: historyVehicleId,
                from: historyFrom,
                to: historyTo,
              })}
          >
            {importHistoryMutation.isPending
              ? "Importing Solar.web history..."
              : "Import Solar.web history"}
          </Button>

          {importHistoryMutation.isSuccess && (
            <Badge color="green" size="2">
              {importHistoryMutation.data.insertedRows} intervals imported
            </Badge>
          )}
        </div>

        {importHistoryMutation.isSuccess && (
          <Text size="1" color="gray">
            {formatKwh(importHistoryMutation.data.chargedWh)} charged —{" "}
            {formatKwh(importHistoryMutation.data.solarWh)} solar, {" "}
            {formatKwh(importHistoryMutation.data.batteryWh)} battery, {" "}
            {formatKwh(importHistoryMutation.data.gridWh)} grid. Solar.web
            archive now contains {importHistoryMutation.data.coverage.rowCount}
            imported charging intervals for this vehicle.
          </Text>
        )}

        {importHistoryMutation.isError && (
          <Text size="2" color="red">
            {importHistoryMutation.error.message}
          </Text>
        )}
      </div>
    </>
  );
}
