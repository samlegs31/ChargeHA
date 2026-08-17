import { Badge, Button, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { SettingsRow } from "../../../hostUi.ts";

export function FroniusCloudConfig(): JSX.Element | null {
  const { data: config } = trpc.plugin.energy.fronius_cloud.getConfig.useQuery();
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.energy.fronius_cloud.setConfig.useMutation({
    onSuccess: () => utils.plugin.energy.fronius_cloud.getConfig.invalidate(),
  });
  const testMutation = trpc.plugin.energy.fronius_cloud.testConnection.useMutation();

  if (!config) return null;

  return (
    <>
      <Text size="1" color="gray">
        Use a Solar.web account that has <code>guest</code>{" "}
        access to this PV system. An existing guest account is fine for local
        testing; a dedicated service account can be used later for hosted E.V Solar.
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
          disabled={!config.froniusCloudEmail || !config.froniusCloudPassword ||
            !config.froniusCloudPvSystemId || testMutation.isPending}
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
            Connected{testMutation.data.systemName ? ` — ${testMutation.data.systemName}` : ""}
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
    </>
  );
}
