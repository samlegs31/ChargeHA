import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { HistoryRepository } from "../../db/repositories/HistoryRepository.ts";
import {
  ChargeHqCsvError,
  parseChargeHqIntervalCsv,
} from "../../history/ChargeHqCsv.ts";
import {
  fetchSolarWebHomeEvHistory,
  SolarWebHistoryError,
} from "../../history/SolarWebHistory.ts";
import { reconcileLegacySolarWebHistory } from "../../history/reconcileLegacySolarWebHistory.ts";
import { publicProcedure, router } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";

const SOLARWEB_EMAIL_KEY = "solarweb.history.email";
const SOLARWEB_PASSWORD_KEY = "solarweb.history.password";
const SOLARWEB_SYSTEM_ID_KEY = "solarweb.history.pv_system_id";

const csvTextInput = z.string().min(1).max(15_000_000);
const vehicleIdInput = z.object({ vehicleId: z.string().min(1) });
const homeChargingSourceInput = z.object({
  vehicleId: z.string().min(1),
  source: z.enum(["chargehq", "solarweb"]).nullable(),
});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const archiveRangeInput = z.object({
  vehicleId: z.string().min(1),
  from: isoDate,
  to: isoDate,
}).refine((input) => input.from <= input.to, {
  message: "Start date must be before or equal to end date",
  path: ["from"],
});
const solarWebImportInput = z.object({
  vehicleId: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1).optional(),
  pvSystemId: z.string().min(1),
  from: isoDate,
  to: isoDate,
}).refine((input) => input.from <= input.to, {
  message: "Start date must be before or equal to end date",
  path: ["from"],
});

type SolarWebImportInput = z.infer<typeof solarWebImportInput>;
type SolarWebResolvedInput = Omit<SolarWebImportInput, "password"> & {
  password: string;
};

function parseChargeHqCsv(csvText: string) {
  try {
    return parseChargeHqIntervalCsv(csvText);
  } catch (error) {
    if (error instanceof ChargeHqCsvError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

async function readSolarWebHistory(input: SolarWebResolvedInput) {
  try {
    return await fetchSolarWebHomeEvHistory(input);
  } catch (error) {
    if (error instanceof SolarWebHistoryError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

async function resolveSolarWebInput(
  ctx: Pick<TrpcContext, "db">,
  input: SolarWebImportInput,
): Promise<SolarWebResolvedInput> {
  const savedPassword = input.password === undefined
    ? await ctx.db.readSecret(SOLARWEB_PASSWORD_KEY)
    : null;
  const password = input.password ?? savedPassword;
  if (!password) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Solar.web password is required",
    });
  }
  return { ...input, password };
}

async function saveSolarWebCredentials(
  ctx: Pick<TrpcContext, "db" | "encryptionKey">,
  input: SolarWebImportInput,
): Promise<void> {
  await Promise.all([
    ctx.db.setPluginConfig(SOLARWEB_EMAIL_KEY, input.email),
    ctx.db.setPluginConfig(SOLARWEB_SYSTEM_ID_KEY, input.pvSystemId),
  ]);
  if (input.password !== undefined && ctx.encryptionKey !== null) {
    await ctx.db.storeSecret(SOLARWEB_PASSWORD_KEY, input.password);
  }
}

async function requireVehicle(
  ctx: {
    db: {
      getVehicle(id: string): Promise<
        {
          id: string;
          name: string;
          adapterType: string;
        } | null
      >;
    };
  },
  vehicleId: string,
) {
  const vehicle = await ctx.db.getVehicle(vehicleId);
  if (vehicle === null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Vehicle not found" });
  }
  return vehicle;
}

export const historyRouter = router({
  setHomeChargingSource: publicProcedure
    .input(homeChargingSourceInput)
    .mutation(async ({ ctx, input }) => {
      const vehicle = await requireVehicle(ctx, input.vehicleId);
      await ctx.db.vehicles.updateVehicleHomeChargingSource(
        input.vehicleId,
        input.source,
      );
      return {
        success: true,
        vehicleId: input.vehicleId,
        vehicleName: vehicle.name,
        source: input.source,
      };
    }),

  previewChargeHq: publicProcedure
    .input(z.object({ csvText: csvTextInput }))
    .mutation(({ input }) => {
      const parsed = parseChargeHqCsv(input.csvText);
      return {
        summary: parsed.summary,
        historyRowCount: parsed.historyRows.length,
      };
    }),

  getChargeHqCoverage: publicProcedure
    .input(vehicleIdInput)
    .query(async ({ ctx, input }) => {
      const repository = new HistoryRepository(ctx.db.db);
      return await repository.getCoverage("chargehq", input.vehicleId);
    }),

  getSolarWebCredentials: publicProcedure.query(async ({ ctx }) => {
    const [email, pvSystemId, passwordRow] = await Promise.all([
      ctx.db.getPluginConfig(SOLARWEB_EMAIL_KEY),
      ctx.db.getPluginConfig(SOLARWEB_SYSTEM_ID_KEY),
      ctx.db.getSecret(SOLARWEB_PASSWORD_KEY),
    ]);
    return {
      email: email ?? "",
      pvSystemId: pvSystemId ?? "",
      hasPassword: passwordRow !== null,
      canSavePassword: ctx.encryptionKey !== null,
    };
  }),

  importChargeHq: publicProcedure
    .input(z.object({
      csvText: csvTextInput,
      vehicleId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireVehicle(ctx, input.vehicleId);
      const parsed = parseChargeHqCsv(input.csvText);
      const repository = new HistoryRepository(ctx.db.db);
      const importResult = await repository.importChargeHqRows(
        input.vehicleId,
        parsed.historyRows,
      );
      const coverage = await repository.getCoverage(
        "chargehq",
        input.vehicleId,
      );
      return {
        ...importResult,
        parsedIntervals: parsed.summary.intervalCount,
        parsedHistoryRows: parsed.historyRows.length,
        summary: parsed.summary,
        coverage,
      };
    }),

  importVehicleChargingHistory: publicProcedure
    .input(archiveRangeInput)
    .mutation(async ({ ctx, input }) => {
      const vehicle = await requireVehicle(ctx, input.vehicleId);
      const plugin = ctx.vehiclePlugins.get(vehicle.adapterType);
      if (plugin?.importChargingHistory === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Charging history import is not available for this vehicle integration",
        });
      }
      try {
        return await plugin.importChargingHistory(
          input.vehicleId,
          input.from,
          input.to,
        );
      } catch (error) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: error instanceof Error
            ? error.message
            : "Vehicle charging history import failed",
          cause: error,
        });
      }
    }),

  importSolarWeb: publicProcedure
    .input(solarWebImportInput)
    .mutation(async ({ ctx, input }) => {
      const vehicle = await requireVehicle(ctx, input.vehicleId);
      const resolvedInput = await resolveSolarWebInput(ctx, input);
      const history = await readSolarWebHistory(resolvedInput);
      await saveSolarWebCredentials(ctx, input);
      const repository = new HistoryRepository(ctx.db.db);
      const importResult = await repository.importRows(
        input.vehicleId,
        history.rows,
      );
      const reconciledLegacyRows = reconcileLegacySolarWebHistory(ctx.db.db);
      const coverage = await repository.getCoverage(
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
        vehicleId: input.vehicleId,
        vehicleName: vehicle.name,
        reconciledLegacyRows,
        coverage,
      };
    }),
});
