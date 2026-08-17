import type { MutationHandlers } from "../types.ts";
import {
  buildSectionInputSchema,
  serializeSection,
} from "@chargeha/shared/configSections";
import { simulatedEnergyConfigDef } from "../../../../../../plugins/energy/simulated/server/config.ts";
import { updateDemoState } from "../../demoState.ts";

type EnergyMutations = Pick<
  MutationHandlers,
  | "plugin.energy.simulated_energy.setConfig"
  | "plugin.energy.fronius_cloud.importEvHistory"
>;

const inputSchema = buildSectionInputSchema(simulatedEnergyConfigDef);

export const energyMutations: EnergyMutations = {
  // Persist the simulated-energy config into demo state (same shape the server
  // writes). The live tick reads it to simulate solar, so edits take effect.
  "plugin.energy.simulated_energy.setConfig": (input) => {
    const validated = inputSchema.parse(input);
    const kv = serializeSection(simulatedEnergyConfigDef, validated);
    updateDemoState((m) => ({ ...m, config: { ...m.config, ...kv } }));
  },
  // Solar.web is not connected in demo mode. Keep the typed mutation surface
  // complete without inventing historical charging data.
  "plugin.energy.fronius_cloud.importEvHistory": () => ({
    insertedRows: 0,
    skippedRows: 0,
    duplicateRows: 0,
    overlapRows: 0,
    samplesRead: 0,
    chargingIntervals: 0,
    chargedWh: 0,
    solarWh: 0,
    batteryWh: 0,
    gridWh: 0,
    coverage: {
      rowCount: 0,
      firstStartTimeLocal: null,
      lastStartTimeLocal: null,
      chargedWh: 0,
    },
  }),
};
