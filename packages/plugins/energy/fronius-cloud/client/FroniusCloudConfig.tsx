import { Badge, Button, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { SettingsRow } from "../../../hostUi.ts";

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

  if (!config) return null;

  return (
    <>
      <Text size="1" color="gray">
        Solar.web → Settings → Permissions → enable <strong>Guest access via link</strong>,
        then paste the complete GuestLogOn link below. E.V Solar only receives
        read-only monitoring data; no Solar.web email, password or Query API key
        is stored.
      </Text>

      <SettingsRow
        label="Solar.web Guest Link"
        help="Paste the complete https://www.solarweb.com/Home/GuestLogOn?pvSystemId=... link. Keep guest access enabled in Solar.web while E.V Solar uses this connection."
      >
        <TextField.Root
          size="2"
          placeholder="https://www.solarweb.com/Home/GuestLogOn?pvSystemId=..."
          value={config.froniusCloudGuestUrl}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ froniusCloudGuestUrl: e.target.value })}
          style={{ width: 520, maxWidth: "100%" }}
        />
      </SettingsRow>

      <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
        The link is read-only, but anyone who has it can view the shared Solar.web
        installation. Treat it as a private sharing link.
      </Text>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="2"
          variant="soft"
          disabled={!config.froniusCloudGuestUrl || testMutation.isPending}
          onClick={() =>
            testMutation.mutate({
              guestUrl: config.froniusCloudGuestUrl,
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
    </>
  );
}
