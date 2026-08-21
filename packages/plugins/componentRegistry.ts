import type { ComponentType } from "react";
import type { PluginStepDef } from "./hostUi.ts";

// Tesla settings + development components
import { TeslaSettings } from "./vehicles/tesla/client/TeslaSettings.tsx";
import { TeslaVehicleVisualDev } from "./vehicles/tesla/client/TeslaVehicleVisualDev.tsx";

// Fronius settings components
import { FroniusCloudConfig } from "./energy/fronius-cloud/client/FroniusCloudConfig.tsx";
import { FroniusLocalConfig } from "./energy/fronius-local/client/FroniusLocalConfig.tsx";

// Sigenergy settings component
import { SigenergyLocalConfig } from "./energy/sigenergy-local/client/SigenergyLocalConfig.tsx";

// Enphase settings component
import { EnphaseLocalConfig } from "./energy/enphase-local/client/EnphaseLocalConfig.tsx";

// Plugin wizard step definitions — imported from each plugin's client folder
import {
  froniusCloudOption,
  froniusCloudWizardSteps,
} from "./energy/fronius-cloud/client/wizardSteps.ts";
import {
  froniusLocalOption,
  froniusLocalWizardSteps,
} from "./energy/fronius-local/client/wizardSteps.ts";
import {
  sigenergyLocalOption,
  sigenergyLocalWizardSteps,
} from "./energy/sigenergy-local/client/wizardSteps.ts";
import {
  enphaseLocalOption,
  enphaseLocalWizardSteps,
} from "./energy/enphase-local/client/wizardSteps.ts";
import {
  teslaScheduleNote,
  teslaVehicleOption,
  teslaWizardSteps,
} from "./vehicles/tesla/client/wizardSteps.ts";

/** Metadata for an energy plugin option shown on the inverter type selection step. */
export interface EnergyPluginOption {
  id: string;
  label: string;
  description: string;
  iconKey: "server" | "cloud" | "monitor";
}

/** Energy plugin options for the inverter type selection step. */
export const energyPluginOptions: EnergyPluginOption[] = [
  froniusLocalOption,
  froniusCloudOption,
  sigenergyLocalOption,
  enphaseLocalOption,
];

/** A schedule-related note contributed by a vehicle plugin. */
export interface PluginScheduleNote {
  adapterType: string;
  text: string;
}

/** Metadata for a vehicle plugin option shown on the vehicle type selection step. */
export interface VehiclePluginOption {
  id: string;
  label: string;
  description: string;
  iconKey: "car" | "monitor";
  /** Default config for creating a new vehicle of this type from the settings page. */
  defaultVehicleConfig?: Record<string, unknown>;
}

/** Vehicle plugin options for the vehicle type selection step. */
export const vehiclePluginOptions: VehiclePluginOption[] = [teslaVehicleOption];

/** Schedule notes from vehicle plugins, shown on the Schedules page. */
export const vehicleScheduleNotes: PluginScheduleNote[] = [
  teslaScheduleNote,
];

/** Vehicle plugin wizard steps, keyed by VehicleAdapterType. */
export const vehiclePluginSteps: Record<string, PluginStepDef[]> = {
  tesla: teslaWizardSteps,
};

/** Energy plugin wizard steps, keyed by energy adapter type. */
export const energyPluginSteps: Record<string, PluginStepDef[]> = {
  fronius_local: froniusLocalWizardSteps,
  fronius_cloud: froniusCloudWizardSteps,
  sigenergy_local: sigenergyLocalWizardSteps,
  enphase_local: enphaseLocalWizardSteps,
};

/**
 * Maps settingsComponentKey strings (from EnergyPlugin) to React components.
 * Used by the settings page to render plugin-provided config forms dynamically.
 */
export const pluginSettingsComponents: Record<string, ComponentType> = {
  "tesla-settings": TeslaSettings,
  "fronius-local-config": FroniusLocalConfig,
  "fronius-cloud-config": FroniusCloudConfig,
  "sigenergy-local-config": SigenergyLocalConfig,
  "enphase-local-config": EnphaseLocalConfig,
};

/** Development-only pages implemented by plugins but mounted by the host. */
export const pluginDevComponents: Record<string, ComponentType> = {
  "vehicle-visual": TeslaVehicleVisualDev,
};
