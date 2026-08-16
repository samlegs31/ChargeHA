import { z } from "zod";
import { Logger } from "@chargeha/server/lib/Logger";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { FroniusCloudAdapter } from "./FroniusCloudAdapter.ts";
import { FRONIUS_CLOUD_SECRET_KEYS, froniusCloudConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";

// ── Typed Zod schema for Fronius Cloud plugin procedure ─────────────────────
// Password is deliberately NOT accepted from the browser. getConfig() masks
// stored secrets as "********", so echoing that value into a connection test
// would authenticate with the mask instead of the real Solar.web password.
const testConnectionInput = z.object({
  email: z.string(),
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
        // Always read the decrypted password server-side. The browser only ever
        // sees the secret mask returned by createPluginConfigProcedures().
        const password = await deps.getSecret("password") ?? "";
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
