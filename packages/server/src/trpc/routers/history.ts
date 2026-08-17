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
const solarWebImportInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

  importSolarWeb: publicProcedure
    .input(solarWebImportInput)
    .mutation(async ({ ctx, input }) => {
      const history = await readSolarWebHistory(input);
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
