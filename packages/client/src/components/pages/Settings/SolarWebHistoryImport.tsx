import { useState } from "react";
import { Badge, Button, Card, Text, TextField } from "@radix-ui/themes";
import { CloudDownload } from "lucide-react";
import { trpc } from "../../../trpc.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";

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

export function SolarWebHistoryImport() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pvSystemId, setPvSystemId] = useState("");
  const [from, setFrom] = useState(oneYearAgoIsoDate);
  const [to, setTo] = useState(todayIsoDate);
  const mutation = trpc.history.importSolarWeb.useMutation();
  const ready = email !== "" && password !== "" && pvSystemId !== "" &&
    from !== "" && to !== "" && from <= to && !mutation.isPending;

  const importHistory = () => {
    if (!ready) return;
    mutation.mutate({ email, password, pvSystemId, from, to });
  };

  return (
    <SettingsSection
      icon={<CloudDownload size={18} />}
      title="Solar.web home EV history"
      description="One-time Wattpilot archive import. Your active Fronius Local integration is not changed."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Text size="1" color="gray">
          Solar.web credentials are used only for this import request and are not
          saved as your realtime energy source. Only home Wattpilot charging is imported,
          for all vehicles combined.
        </Text>

        <SettingsRow label="Solar.web email">
          <TextField.Root
            size="2"
            type="email"
            placeholder="name@email.com"
            value={email}
            disabled={mutation.isPending}
            onChange={(event) => setEmail(event.currentTarget.value)}
            style={{ width: 260 }}
          />
        </SettingsRow>
        <SettingsRow label="Solar.web password">
          <TextField.Root
            size="2"
            type="password"
            placeholder="Password"
            value={password}
            disabled={mutation.isPending}
            onChange={(event) => setPassword(event.currentTarget.value)}
            style={{ width: 260 }}
          />
        </SettingsRow>
        <SettingsRow
          label="PV System ID"
          help="Use the pvSystemId value from your logged-in Solar.web system URL."
        >
          <TextField.Root
            size="2"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={pvSystemId}
            disabled={mutation.isPending}
            onChange={(event) => setPvSystemId(event.currentTarget.value)}
            style={{ width: 320 }}
          />
        </SettingsRow>
        <SettingsRow label="From">
          <TextField.Root
            size="2"
            type="date"
            value={from}
            max={to}
            disabled={mutation.isPending}
            onChange={(event) => setFrom(event.currentTarget.value)}
            style={{ width: 180 }}
          />
        </SettingsRow>
        <SettingsRow label="To">
          <TextField.Root
            size="2"
            type="date"
            value={to}
            min={from}
            max={todayIsoDate()}
            disabled={mutation.isPending}
            onChange={(event) => setTo(event.currentTarget.value)}
            style={{ width: 180 }}
          />
        </SettingsRow>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Button size="2" disabled={!ready} onClick={importHistory}>
            <CloudDownload size={15} />
            {mutation.isPending
              ? "Importing Solar.web history..."
              : "Import Solar.web home EV history"}
          </Button>
          <Text size="1" color="gray">
            Re-importing the same period is safe. For large archives, import year by year.
          </Text>
        </div>

        {mutation.isSuccess && (
          <Card style={{ borderLeft: "3px solid var(--green-9)" }}>
            <Badge color="green" variant="soft">
              {mutation.data.insertedRows} intervals imported
            </Badge>
            <Text size="1" color="gray" style={{ display: "block", marginTop: 6 }}>
              {formatKwh(mutation.data.chargedWh)} charged at home ·{" "}
              {formatKwh(mutation.data.solarWh)} solar ·{" "}
              {formatKwh(mutation.data.batteryWh)} home battery ·{" "}
              {formatKwh(mutation.data.gridWh)} grid
            </Text>
          </Card>
        )}
        {mutation.isError && (
          <Text size="2" color="red">{mutation.error.message}</Text>
        )}
      </div>
    </SettingsSection>
  );
}
