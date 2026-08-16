import { useCallback, useState } from "react";
import {
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { FroniusCloudForm } from "./FroniusCloudForm.tsx";

/** Only the tested-connection branch carries a handler, so there is no
 *  "save without a validated connection" state to guard against. */
function froniusCloudNext(
  validated: { guestUrl: string } | null,
  save: (v: { guestUrl: string }) => Promise<void>,
): WizardNext {
  if (!validated) {
    return { kind: "blocked", reason: "Test the connection to continue" };
  }
  return {
    kind: "ready",
    hint: "Next saves your Solar.web guest link",
    onNext: () => save(validated),
  };
}

export const froniusCloudSetupStep: PluginStepDef = {
  id: "fronius-cloud-setup",
  label: "Fronius Solar.web Guest Setup",
  useStep: () => {
    const { data: config } = trpc.plugin.energy.fronius_cloud.getConfig
      .useQuery();
    const saveMutation = trpc.plugin.energy.fronius_cloud.setConfig
      .useMutation();

    const [validated, setValidated] = useState<{ guestUrl: string } | null>(
      null,
    );

    const handleTestSuccess = useCallback((guestUrl: string) => {
      setValidated({ guestUrl });
    }, []);

    const save = async (v: { guestUrl: string }) => {
      await saveMutation.mutateAsync({
        froniusCloudGuestUrl: v.guestUrl,
      });
    };

    return {
      next: froniusCloudNext(validated, save),
      view: (
        <div className={styles.stepContainer}>
          <FroniusCloudForm
            initialGuestUrl={config?.froniusCloudGuestUrl || ""}
            onTestSuccess={handleTestSuccess}
          />
        </div>
      ),
    };
  },
};
