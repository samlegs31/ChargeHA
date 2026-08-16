import type { PluginStepDef } from "../../../hostUi.ts";
import type { EnergyPluginOption } from "../../../componentRegistry.ts";
import { froniusCloudSetupStep } from "./FroniusCloudSetupStep.tsx";

/** Fronius Solar.web account wizard steps, in order. */
export const froniusCloudWizardSteps: PluginStepDef[] = [froniusCloudSetupStep];

/** Solar.web account option metadata for the inverter type selection step. */
export const froniusCloudOption: EnergyPluginOption = {
  id: "fronius_cloud",
  label: "Fronius (Solar.web Account)",
  description:
    "Connect through Solar.web with a read-only guest-role account. Provides the same E.V Solar energy fields as Fronius Local when Solar.web exposes the corresponding channels.",
  iconKey: "cloud",
};
