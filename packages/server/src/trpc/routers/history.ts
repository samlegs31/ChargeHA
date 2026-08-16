import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { HistoryRepository } from "../../db/repositories/HistoryRepository.ts";
import {
  ChargeHqCsvError,
  parseChargeHqIntervalCsv,
} from "../../history/ChargeHqCsv.ts";
import { publicProcedure, router } from "../trpc.ts";

const csvTextInput = z.string().min(1).max(15_000_000);

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
      const importResult = repository.importChargeHqRows(
        input.vehicleId,
        parsed.historyRows,
      );
      const coverage = await repository.getCoverage("chargehq", input.vehicleId);

      return {
        ...importResult,
        parsedIntervals: parsed.summary.intervalCount,
        parsedHistoryRows: parsed.historyRows.length,
        summary: parsed.summary,
        coverage,
      };
    }),
});
