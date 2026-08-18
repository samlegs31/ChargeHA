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
import { publicProcedure, router } from "../trpc.ts";

const csvTextInput = z.string().min(1).max(15_000_000);
const vehicleIdInput = z.object({ vehicleId: z.string().min(1) });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SOLARWEB_EMAIL_KEY = "solarweb.history.email";
const SOLARWEB_PASSWORD_KEY = "solarweb.history.password";
const SOLARWEB_PV_SYSTEM_ID_KEY = "solarweb.history.pv_system_id";
const solarWebImportInput = z.object({
  email: z.string().email(),
  password: z.string().max(1024),
  pvSystemId: z.string().min(1),
  from: isoDate,
  to: isoDate,
}).refine((input) => input.from <= input.to, {
  message: "Start date must be before or equal to end date",
  path: ["from"],
});

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

async function readSolarWebHistory(input: z.infer<typeof solarWebImportInput>) {
  try {
    return await fetchSolarWebHomeEvHistory(input);
  } catch (error) {
    if (error instanceof SolarWebHistoryError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

export const historyRouter = router({
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

  importChargeHq: publicProcedure
    .input(z.object({
      csvText: csvTextInput,
      vehicleId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const vehicle = await ctx.db.getVehicle(input.vehicleId);
      if (vehicle === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Vehicle not found",
        });
      }

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

  getSolarWebImportCredentials: publicProcedure.query(async ({ ctx }) => {
    const [email, password, pvSystemId] = await Promise.all([
      ctx.db.readSecret(SOLARWEB_EMAIL_KEY),
      ctx.db.readSecret(SOLARWEB_PASSWORD_KEY),
      ctx.db.readSecret(SOLARWEB_PV_SYSTEM_ID_KEY),
    ]);
    return {
      email: email ?? "",
      pvSystemId: pvSystemId ?? "",
      hasPassword: password !== null && password !== "",
    };
  }),

  importSolarWeb: publicProcedure
    .input(solarWebImportInput)
    .mutation(async ({ ctx, input }) => {
      const savedEmail = await ctx.db.readSecret(SOLARWEB_EMAIL_KEY);
      const savedPassword = savedEmail === input.email
        ? await ctx.db.readSecret(SOLARWEB_PASSWORD_KEY)
        : null;
      const password = input.password !== "" ? input.password : savedPassword;
      if (password === null || password === "") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solar.web password is required",
        });
      }

      const history = await readSolarWebHistory({ ...input, password });
      await Promise.all([
        ctx.db.storeSecret(SOLARWEB_EMAIL_KEY, input.email),
        ctx.db.storeSecret(SOLARWEB_PV_SYSTEM_ID_KEY, input.pvSystemId),
        ...(input.password !== ""
          ? [ctx.db.storeSecret(SOLARWEB_PASSWORD_KEY, input.password)]
          : []),
      ]);

      const repository = new HistoryRepository(ctx.db.db);
      const importResult = await repository.importAggregateRows(history.rows);
      const coverage = await repository.getAggregateCoverage("solarweb");
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
    }),
});
