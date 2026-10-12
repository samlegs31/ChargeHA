import { commandMetrics, controllerMetrics } from "../../lib/RuntimeMetrics.ts";
import { externalChargingVehicles } from "../../services/ExternalCharging.ts";

function ageMs(timestamp: string | undefined, now: number): number | null {
  const value = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(value) && value <= now ? now - value : null;
}
import { publicProcedure, router } from "../trpc.ts";

export const healthRouter = router({
  // Protected by the HTTP auth middleware, like every non-auth tRPC procedure.
  // Reads cached states only: opening diagnostics must never wake a vehicle.
  regulation: publicProcedure.query(async ({ ctx }) => {
    const [states, config, external] = await Promise.all([
      ctx.vehicleManager.getAllStates(),
      ctx.configService.getCharging(),
      externalChargingVehicles(ctx.db),
    ]);
    const now = Date.now();
    const energy = ctx.poller.tryGetRealtimeSnapshot()?.realtime;
    const energyAgeMs = ageMs(energy?.lastUpdated, now);
    const decisions = ctx.eventEmitter.getRetained("controller_status");
    return {
      sampledAt: new Date(now).toISOString(),
      chargingEnabled: config.chargingEnabled,
      energyAgeMs,
      energyStale: energyAgeMs === null ||
        energyAgeMs > ctx.poller.getRealtimeMaxAgeMs(),
      gridPowerW: energy?.gridPowerW ?? null,
      controller: controllerMetrics.snapshot(),
      commands: commandMetrics.snapshot(),
      vehicles: [...states.values()].map((state) => {
        const decision = external.has(state.vehicleId)
          ? undefined
          : decisions.find((value) => value.vehicleId === state.vehicleId);
        return {
          id: state.vehicleId,
          name: state.vehicleName,
          external: external.has(state.vehicleId),
          telemetryAgeMs: ageMs(state.lastUpdated, now),
          actualAmps: state.chargeAmpsActual ?? null,
          requestedAmps: decision?.targetAmps ?? null,
          reportedSetpointAmps: state.chargeAmps,
          solarLimitAmps: config.vehicleSolarCurrentLimits?.[state.vehicleId] ??
            null,
          electricalLimitAmps: config.vehicleCurrentLimits?.[state.vehicleId] ??
            null,
          reason: decision?.reason ?? null,
          decisionAgeMs: ageMs(decision?.observedAt, now),
        };
      }),
    };
  }),
  // Check if ENCRYPTION_KEY is configured
  encryption: publicProcedure.query(({ ctx }) =>
    ctx.healthService.checkEncryption()
  ),

  // Collect user-facing warnings from all failed plugin health checks
  pluginWarnings: publicProcedure.query(({ ctx }) =>
    ctx.healthService.getPluginWarnings()
  ),
});
