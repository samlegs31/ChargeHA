import { z } from "zod";
import { Logger } from "@chargeha/server/lib/Logger";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { FroniusCloudAdapter } from "./FroniusCloudAdapter.ts";
import { FRONIUS_CLOUD_SECRET_KEYS, froniusCloudConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import { resolveFroniusCloudTestPassword } from "./resolveTestPassword.ts";

// ── Typed Zod schema for Fronius Cloud plugin procedure ─────────────────────

const testConnectionInput = z.object({
  email: z.string(),
  password: z.string(),
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
        try {
          const password = await resolveFroniusCloudTestPassword(
            input.password,
            () => deps.getSecret("password"),
          );
          const adapter = new FroniusCloudAdapter(
            input.email,
            password,
            input.pvSystemId,
            new Logger("FroniusCloud", "error"),
          );

          await adapter.connect();
          try {
            // A successful login alone is not enough: validate the same
            // realtime flow endpoint used by the EnergyPoller so Local and
            // Cloud are tested against the same runtime capability.
            await adapter.getRealtimeData();
            const deviceInfo = await adapter.getDeviceInfo();
            return { success: true as const, systemName: deviceInfo.name };
          } finally {
            await adapter.disconnect();
          }
        } catch (err) {
          return {
            success: false as const,
            error: err instanceof Error ? err.message : "Connection failed",
          };
        }
      }),
  });
}
