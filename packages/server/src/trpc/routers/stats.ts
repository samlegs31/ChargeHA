import { z } from "zod";
import { publicProcedure, router } from "../trpc.ts";
import {
  statsDayInput,
  statsMonthInput,
  statsYearInput,
} from "@chargeha/shared/schemas";
import { HistoryRepository } from "../../db/repositories/HistoryRepository.ts";
import { buildTotalStats } from "../../history/TotalStats.ts";
import { mergeChargeHqStats } from "../../history/mergeChargeHqStats.ts";
import { reconcileLegacySolarWebHistory } from "../../history/reconcileLegacySolarWebHistory.ts";

const statsTotalInput = z.object({
  tz: z.number().min(-14).max(14).optional(),
  vehicleId: z.string().optional(),
});

export const statsRouter = router({
  day: publicProcedure
    .input(statsDayInput)
    .query(async ({ ctx, input }) => {
      if (!input.vehicleId) reconcileLegacySolarWebHistory(ctx.db.db);
      const tz = input.tz ?? 0;
      const detailed = input.resolution === "15m";
      const response = await ctx.statsService.buildDayStats(
        input.date,
        tz,
        input.vehicleId,
        detailed,
      );
      // Archived stats combine vehicle-attributed history with any remaining
      // installation-level Solar.web history that has not yet been superseded.
      const history = new HistoryRepository(ctx.db.db);
      const historyRows = detailed
        ? await history.getChargeHqStatsDayDetailed(input.date, input.vehicleId)
        : await history.getChargeHqStatsDay(input.date, input.vehicleId);
      return mergeChargeHqStats(response, historyRows, "day");
    }),

  month: publicProcedure
    .input(statsMonthInput)
    .query(async ({ ctx, input }) => {
      if (!input.vehicleId) reconcileLegacySolarWebHistory(ctx.db.db);
      const tz = input.tz ?? 0;
      const response = await ctx.statsService.buildMonthStats(
        input.year,
        input.month,
        tz,
        input.vehicleId,
      );
      const history = new HistoryRepository(ctx.db.db);
      const historyRows = await history.getChargeHqStatsMonth(
        input.year,
        input.month,
        input.vehicleId,
      );
      return mergeChargeHqStats(response, historyRows, "month");
    }),

  year: publicProcedure
    .input(statsYearInput)
    .query(async ({ ctx, input }) => {
      if (!input.vehicleId) reconcileLegacySolarWebHistory(ctx.db.db);
      const tz = input.tz ?? 0;
      const response = await ctx.statsService.buildYearStats(
        input.year,
        tz,
        input.vehicleId,
      );
      const history = new HistoryRepository(ctx.db.db);
      const historyRows = await history.getChargeHqStatsYear(
        input.year,
        input.vehicleId,
      );
      return mergeChargeHqStats(response, historyRows, "year");
    }),

  total: publicProcedure
    .input(statsTotalInput)
    .query(async ({ ctx, input }) => {
      if (!input.vehicleId) reconcileLegacySolarWebHistory(ctx.db.db);
      return await buildTotalStats(
        ctx.db,
        ctx.statsService,
        input.tz ?? 0,
        input.vehicleId,
      );
    }),
});
