import { z } from "zod";
import { publicProcedure, router } from "../trpc.ts";

export const forecastRouter = router({
  today: publicProcedure
    .input(z.object({ vehicleId: z.string().min(1).max(128) }))
    .query(({ ctx, input }) => ctx.solarForecastService.getTodayForecast(input.vehicleId)),
});
