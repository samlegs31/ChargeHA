import { z } from "zod";
import { Logger } from "@chargeha/server/lib/Logger";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { FroniusCloudAdapter } from "./FroniusCloudAdapter.ts";
import { FRONIUS_CLOUD_SECRET_KEYS, froniusCloudConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import { resolveFroniusCloudTestPassword } from "./resolveTestPassword.ts";
import { fetchFroniusCloudEvHistory } from "./FroniusCloudHistory.ts";

// ── Typed Zod schemas for Fronius Cloud plugin procedures ───────────────────

const testConnectionInput = z.object({
  email: z.string(),
  password: z.string(),
  pvSystemId: z.string(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const importHistoryInput = z.object({
  vehicleId: z.string().min(1),
  from: isoDate,
  to: isoDate,
}).refine((input) => input.from <= input.to, {
  message: "Start date must be before or equal to end date",
  path: ["from"],
});

function startOfDayIso(date: string): string {
  return `${date}T00:00:00Z`;
}

function dayAfterIso(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().replace(".000Z", "Z");
}

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

    importEvHistory: publicProcedure
      .input(importHistoryInput)
      .mutation(async ({ input }) => {
        const [email, password, pvSystemId] = await Promise.all([
          deps.getConfig("email"),
          deps.getSecret("password"),
          deps.getConfig("pv_system_id"),
        ]);
        if (!email || !password || !pvSystemId) {
          throw new Error(
            "Configure and save the Solar.web email, password and PV System ID before importing history",
          );
        }

        const adapter = new FroniusCloudAdapter(
          email,
          password,
          pvSystemId,
          new Logger("FroniusCloudHistory", "error"),
        );
        try {
          const history = await fetchFroniusCloudEvHistory(
            adapter,
            pvSystemId,
            startOfDayIso(input.from),
            dayAfterIso(input.to),
          );
          const importResult = await deps.importVehicleChargeHistoryRows(
            input.vehicleId,
            history.rows,
          );
          const coverage = await deps.getVehicleChargeHistoryCoverage(
            "solarweb",
            input.vehicleId,
          );

          return {
            ...importResult,
            samplesRead: history.samplesRead,
            chargingIntervals: history.rows.length,
            chargedWh: history.chargedWh,
            solarWh: history.solarWh,
            batteryWh: history.batteryWh,
            gridWh: history.gridWh,
            coverage,
          };
        } finally {
          await adapter.disconnect();
        }
      }),
  });
}
