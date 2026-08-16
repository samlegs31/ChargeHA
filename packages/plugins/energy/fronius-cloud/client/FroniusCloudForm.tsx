import { useMemo, useState } from "react";
import { Button, Text, TextField } from "@radix-ui/themes";
import { Loader2 } from "lucide-react";
import { trpc } from "./trpc.ts";
import { stepStyles as styles } from "../../../hostUi.ts";
import type { TestStatus } from "../../InverterSetupShared.tsx";
import { TestResultBadge } from "../../InverterSetupShared.tsx";

interface FroniusCloudFormProps {
  initialGuestUrl: string;
  onTestSuccess: (guestUrl: string) => void;
}

export function FroniusCloudForm({
  initialGuestUrl,
  onTestSuccess,
}: FroniusCloudFormProps): JSX.Element {
  const [guestUrl, setGuestUrl] = useState(initialGuestUrl);

  const testMutation = trpc.plugin.energy.fronius_cloud.testConnection
    .useMutation({
      onSuccess: (data: { success: boolean }) => {
        if (data.success) onTestSuccess(guestUrl);
      },
    });

  const testResult: TestStatus = useMemo(() => {
    if (testMutation.isPending) return { status: "testing" };
    if (testMutation.isSuccess && testMutation.data.success) {
      return { status: "success", detail: testMutation.data.systemName };
    }
    if (testMutation.isSuccess && !testMutation.data.success) {
      return {
        status: "error",
        message: testMutation.data.error ?? "Connection failed",
      };
    }
    if (testMutation.isError) {
      return { status: "error", message: testMutation.error.message };
    }
    return { status: "idle" };
  }, [
    testMutation.isPending,
    testMutation.isSuccess,
    testMutation.isError,
    testMutation.data,
    testMutation.error,
  ]);

  return (
    <>
      <Text as="p" size="3" color="gray">
        Connect E.V Solar to Fronius Solar.web without sharing your account
        credentials. In Solar.web, open <strong>Settings → Permissions</strong>,
        enable <strong>Guest access via link</strong>, then copy the complete link.
      </Text>

      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">
          Solar.web Guest Link
        </Text>
        <Text size="1" color="gray">
          Paste the full <code>GuestLogOn</code> URL. E.V Solar uses it only to
          read live production, home load, grid flow and battery information.
        </Text>
        <TextField.Root
          size="2"
          placeholder="https://www.solarweb.com/Home/GuestLogOn?pvSystemId=..."
          value={guestUrl}
          onChange={(e: { target: { value: string } }) =>
            setGuestUrl(e.target.value)}
          aria-label="Solar.web Guest Link"
        />
      </div>

      <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
        No Solar.web email, password or Query API key is required. The guest link
        is read-only, but anyone who has the link can view the shared installation.
      </Text>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="2"
          variant="soft"
          disabled={!guestUrl || testMutation.isPending}
          onClick={() => testMutation.mutate({ guestUrl })}
        >
          {testMutation.isPending && (
            <Loader2 size={14} className={styles.spinner} />
          )}
          {testMutation.isPending ? "Testing..." : "Test Connection"}
        </Button>
        <TestResultBadge testResult={testResult} />
      </div>
    </>
  );
}
