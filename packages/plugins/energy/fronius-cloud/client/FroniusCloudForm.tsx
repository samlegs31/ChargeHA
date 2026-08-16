import { useMemo, useState } from "react";
import { Button, Text, TextField } from "@radix-ui/themes";
import { Loader2 } from "lucide-react";
import { trpc } from "./trpc.ts";
import { stepStyles as styles } from "../../../hostUi.ts";
import type { TestStatus } from "../../InverterSetupShared.tsx";
import { TestResultBadge } from "../../InverterSetupShared.tsx";

interface FroniusCloudFormProps {
  initialEmail: string;
  initialPvSystemId: string;
  onTestSuccess: (email: string, password: string, pvSystemId: string) => void;
}

function CloudFields(
  {
    cloudEmail,
    setCloudEmail,
    cloudPassword,
    setCloudPassword,
    pvSystemId,
    setPvSystemId,
  }: {
    cloudEmail: string;
    setCloudEmail: (v: string) => void;
    cloudPassword: string;
    setCloudPassword: (v: string) => void;
    pvSystemId: string;
    setPvSystemId: (v: string) => void;
  },
) {
  return (
    <>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Email</Text>
        <TextField.Root
          size="2"
          type="email"
          placeholder="guest@email.com"
          value={cloudEmail}
          onChange={(e: { target: { value: string } }) =>
            setCloudEmail(e.target.value)}
          aria-label="Email"
        />
      </div>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Password</Text>
        <TextField.Root
          size="2"
          type="password"
          placeholder="Solar.web password"
          value={cloudPassword}
          onChange={(e: { target: { value: string } }) =>
            setCloudPassword(e.target.value)}
          aria-label="Password"
        />
      </div>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">PV System ID</Text>
        <Text size="1" color="gray">
          Enter only the value after <code>pvSystemId=</code>{" "}
          in your logged-in Solar.web URL. Do not paste the full URL or the
          separate guest-link ID.
        </Text>
        <TextField.Root
          size="2"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={pvSystemId}
          onChange={(e: { target: { value: string } }) =>
            setPvSystemId(e.target.value)}
          aria-label="PV System ID"
        />
      </div>
    </>
  );
}

export function FroniusCloudForm({
  initialEmail,
  initialPvSystemId,
  onTestSuccess,
}: FroniusCloudFormProps): JSX.Element {
  const [cloudEmail, setCloudEmail] = useState(initialEmail);
  const [cloudPassword, setCloudPassword] = useState("");
  const [pvSystemId, setPvSystemId] = useState(initialPvSystemId);

  const testMutation = trpc.plugin.energy.fronius_cloud.testConnection
    .useMutation({
      onSuccess: (data: { success: boolean }) => {
        if (data.success) {
          onTestSuccess(cloudEmail, cloudPassword, pvSystemId);
        }
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
        Connect to your Fronius inverter through Solar.web. Use a Solar.web
        account that already has <code>guest</code>{" "}
        access to this PV system. An existing guest account is fine for local
        testing; a dedicated service account can be used later for hosted E.V Solar.
      </Text>

      <CloudFields
        cloudEmail={cloudEmail}
        setCloudEmail={setCloudEmail}
        cloudPassword={cloudPassword}
        setCloudPassword={setCloudPassword}
        pvSystemId={pvSystemId}
        setPvSystemId={setPvSystemId}
      />

      <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
        Guest rights are sufficient for read-only monitoring.
      </Text>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="2"
          variant="soft"
          disabled={!cloudEmail ||
            !cloudPassword ||
            !pvSystemId ||
            testMutation.isPending}
          onClick={() =>
            testMutation.mutate({
              email: cloudEmail,
              password: cloudPassword,
              pvSystemId: pvSystemId,
            })}
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
