import { z } from "zod";
import { Logger } from "@chargeha/server/lib/Logger";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { FroniusCloudAdapter } from "./FroniusCloudAdapter.ts";
import { FRONIUS_CLOUD_SECRET_KEYS, froniusCloudConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { VehicleChargeHistoryRowInput } from "@chargeha/server/db/repositories/HistoryRepository";
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

function shiftedDayIso(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().replace(".000Z", "Z");
}

function rowsInLocalDateRange(
  rows: readonly VehicleChargeHistoryRowInput[],
  from: string,
  to: string,
): VehicleChargeHistoryRowInput[] {
  return rows.filter((row) => {
    const localDate = row.startTimeLocal.slice(0, 10);
    return localDate >= from && localDate <= to;
  });
}

function sumWh(
  rows: readonly VehicleChargeHistoryRowInput[],
  pick: (row: VehicleChargeHistoryRowInput) => number,
): number {
  return rows.reduce((sum, row) => sum + pick(row), 0);
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
          // Query one extra UTC day on each side, then keep the requested
          // Solar.web local dates. This preserves local midnight boundaries
          // regardless of the PV system's UTC offset or DST.
          const history = await fetchFroniusCloudEvHistory(
            adapter,
            pvSystemId,
            shiftedDayIso(input.from, -1),
            shiftedDayIso(input.to, 2),
          );
          const rows = rowsInLocalDateRange(history.rows, input.from, input.to);
          const importResult = await deps.importVehicleChargeHistoryRows(
            input.vehicleId,
            rows,
          );
          const coverage = await deps.getVehicleChargeHistoryCoverage(
            "solarweb",
            input.vehicleId,
          );

          return {
            ...importResult,
            samplesRead: history.samplesRead,
            chargingIntervals: rows.length,
            chargedWh: sumWh(rows, (row) => row.chargedWh),
            solarWh: sumWh(rows, (row) => row.solarWh),
            batteryWh: sumWh(rows, (row) => row.batteryWh),
            gridWh: sumWh(rows, (row) => row.gridWh),
            coverage,
          };
        } finally {
          await adapter.disconnect();
        }
      }),
  });
}
