import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── Fronius Solar.web guest plugin config section ────────────────────────────
// Keys are relative — PluginDependencies prefixes them with the plugin id.

export const froniusCloudConfigDef = defineSection({
  froniusCloudGuestUrl: {
    key: "guest_url",
    schema: z.string(),
    default: "",
  },
});

export type FroniusCloudConfig = SectionType<typeof froniusCloudConfigDef>;

export type FroniusCloudConfigKey = SectionKeys<typeof froniusCloudConfigDef>;

// Guest-link mode stores no Solar.web password or API secret.
export const FRONIUS_CLOUD_SECRET_KEYS =
  [] as const satisfies readonly FroniusCloudConfigKey[];
