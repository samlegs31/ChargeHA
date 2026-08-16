import type { PluginStepDef } from "../../../hostUi.ts";
import type { EnergyPluginOption } from "../../../componentRegistry.ts";
import { froniusCloudSetupStep } from "./FroniusCloudSetupStep.tsx";

/** Fronius Solar.web guest wizard steps, in order. */
export const froniusCloudWizardSteps: PluginStepDef[] = [froniusCloudSetupStep];

/** Solar.web guest option metadata for the inverter type selection step. */
export const froniusCloudOption: EnergyPluginOption = {
  id: "fronius_cloud",
  label: "Fronius (Solar.web Guest)",
  description:
    "Connect through the read-only Solar.web Guest Link. No Solar.web email, password or paid Query API access is required.",
  iconKey: "cloud",
};
