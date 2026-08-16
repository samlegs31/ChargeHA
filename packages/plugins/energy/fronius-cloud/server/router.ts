import { z } from "zod";
import { Logger } from "@chargeha/server/lib/Logger";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { FroniusCloudAdapter } from "./FroniusCloudAdapter.ts";
import { FRONIUS_CLOUD_SECRET_KEYS, froniusCloudConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";

const SECRET_MASK = "********";

// ── Typed Zod schema for Fronius Cloud plugin procedure ─────────────────────
// A password may be supplied by the first-run setup before it has been saved.
// Settings deliberately omits it, because getConfig() only exposes SECRET_MASK.
const testConnectionInput = z.object({
  email: z.string(),
  password: z.string().optional(),
  pvSystemId: z.string(),
});

// ── Fronius Cloud plugin tRPC router ────────────────────────────────────────

export function createFroniusCloudRouter(deps: PluginDependencies) {
  return router({
    ...createPluginConfigProcedures(
      deps,
      froniusCloudConfigDef,
      FRONIUS_CLOUD_SECRET_KEYS,
    ),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(async ({ input }) => {
        // First-run setup can test a newly entered password directly. Settings
        // never sends the masked secret back: it falls through to the encrypted
        // password stored server-side.
        const suppliedPassword = input.password && input.password !== SECRET_MASK
          ? input.password
          : null;
        const password = suppliedPassword ?? await deps.getSecret("password") ?? "";

        if (!password) {
          return {
            success: false as const,
            error: "Solar.web password is not configured",
          };
        }

        const adapter = new FroniusCloudAdapter(
          input.email,
          password,
          input.pvSystemId,
          new Logger("FroniusCloud", "error"),
        );
        try {
          await adapter.connect();
          // Match the Local connection test: validate both device metadata and
          // the realtime EnergyData path used by Home/charge control.
          const [device, realtime] = await Promise.all([
            adapter.getDeviceInfo(),
            adapter.getRealtimeData(),
          ]);
          await adapter.disconnect();
          return {
            success: true as const,
            systemName: device.name,
            device,
            realtime,
          };
        } catch (err) {
          await adapter.disconnect();
          return {
            success: false as const,
            error: err instanceof Error ? err.message : "Connection failed",
          };
        }
      }),
  });
}
