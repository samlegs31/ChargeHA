import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../../db/AppDatabase.ts";
import { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import { HealthService } from "../../services/HealthService.ts";
import { TypedEventEmitter } from "../../services/TypedEventEmitter.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import type { VehiclePlugin } from "@chargeha/plugins/types";
import { throwingMock } from "../../test-helpers/throwingMock.ts";

describe("Health tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);

  let db: AppDatabase;

  const makePlugin = (
    overrides: Partial<VehiclePlugin> = {},
  ): VehiclePlugin => ({
    id: "test",
    displayName: "Test",
    configDef: {},
    secretKeys: [],
    settingsComponentKey: null,
    createMiddleware: () =>
      Promise.resolve(
        throwingMock<ReturnType<VehiclePlugin["createMiddleware"]>>(
          "VehicleMiddleware",
        ),
      ),
    shutdown: () => Promise.resolve(),
    getRouter: () => null,
    getHttpRoutes: () => null,
    getHealthChecks: () => [],
    getCommandStatus: () =>
      Promise.resolve({ commandsDisabled: false, reason: null }),
    getTunnelRoutes: () => [],
    ...overrides,
  });

  const setupCaller = async (
    encryptionKey: string | null,
    plugin?: VehiclePlugin,
  ) => {
    db = new AppDatabase(":memory:");
    await db.init();
    const vehiclePlugins = new VehiclePluginRegistry();
    if (plugin) vehiclePlugins.register(plugin);
    const healthService = new HealthService(
      vehiclePlugins,
      new EnergyPluginRegistry(),
      encryptionKey,
    );
    return createCaller(throwingMock<TrpcContext>("TrpcContext", {
      healthService,
    }));
  };

  afterEach(() => {
    db.close();
  });

  describe("health.encryption", () => {
    ([
      ["configured: false when no encryption key", null, false],
      ["configured: true when encryption key is set", "some-key", true],
    ] as const).forEach(([name, key, expected]) => {
      it(`returns ${name}`, async () => {
        const caller = await setupCaller(key);
        const data = await caller.health.encryption();
        expect(data.configured).toBe(expected);
      });
    });
  });

  describe("health.pluginWarnings", () => {
    it("returns empty array when all health checks pass", async () => {
      const plugin = makePlugin({
        getHealthChecks: () => [{
          name: "test-check",
          warningTitle: "Test Warning",
          warningMessage: "Something is wrong",
          run: () => Promise.resolve({ status: "ok" as const }),
        }],
      });
      const caller = await setupCaller(null, plugin);

      const data = await caller.health.pluginWarnings();
      expect(data).toEqual([]);
    });

    it("returns warning when a health check fails", async () => {
      const plugin = makePlugin({
        getHealthChecks: () => [{
          name: "test-check",
          warningTitle: "Proxy Down",
          warningMessage: "Cannot reach proxy",
          run: () =>
            Promise.resolve({
              status: "error" as const,
              message: "not reachable",
            }),
        }],
      });
      const caller = await setupCaller(null, plugin);

      const data = await caller.health.pluginWarnings();
      expect(data).toEqual([
        { title: "Proxy Down", message: "Cannot reach proxy" },
      ]);
    });
  });

  describe("health.regulation", () => {
    it("exposes instantaneous effective limit, cause, and command queue depth per vehicle", async () => {
      db = new AppDatabase(":memory:");
      await db.init();
      const nowIso = new Date().toISOString();
      const eventEmitter = new TypedEventEmitter();
      eventEmitter.emit(
        "controller_status",
        {
          vehicleId: "VIN_FRIDAY",
          action: "none",
          reason: "solar_tracking",
          detail: "Already charging at 22A",
          targetAmps: 22,
          checksJson: "[]",
          observedAt: nowIso,
        },
        "VIN_FRIDAY",
      );
      const caller = createCaller(
        throwingMock<TrpcContext>("TrpcContext", {
          db,
          vehicleManager: throwingMock<TrpcContext["vehicleManager"]>(
            "VehicleManager",
            {
              getAllStates: () =>
                Promise.resolve(
                  new Map([
                    [
                      "VIN_FRIDAY",
                      {
                        vehicleId: "VIN_FRIDAY",
                        vehicleName: "F.R.I.D.A.Y.",
                        batteryLevel: 55,
                        chargeLimit: 80,
                        isCharging: true,
                        isPluggedIn: true,
                        isOnline: true,
                        chargeAmps: 22,
                        chargeAmpsActual: 22,
                        chargeAmpsMax: 32,
                        chargeAmpsMin: 5,
                        chargePowerKw: 5.06,
                        chargerVoltage: 230,
                        chargerPhases: 1,
                        energyAddedKwh: 2,
                        minutesToFull: 60,
                        chargePortOpen: true,
                        lastUpdated: nowIso,
                        latitude: 43.6,
                        longitude: 1.44,
                        isHome: true,
                      },
                    ],
                  ]),
                ),
              getCommandQueueDepth: (id?: string) => (id ? 1 : 1),
              isCommandInFlight: () => true,
            },
          ),
          configService: throwingMock<TrpcContext["configService"]>(
            "ConfigService",
            {
              getCharging: () =>
                Promise.resolve({
                  chargingEnabled: true,
                  priorityChargingEnabled: false,
                  vehicleSolarCurrentLimits: { VIN_FRIDAY: 22 },
                  vehicleCurrentLimits: {},
                  maxGridImportKw: null,
                }),
              getSolar: () =>
                Promise.resolve({
                  solarTrackingEnabled: true,
                  solarTrackingMode: "solar_only" as const,
                  solarReference: "excess" as const,
                  solarMarginKw: 0,
                  minSolarGenerationKw: 0.2,
                  minExcessSolarKw: null,
                  gridVoltage: 230,
                  threePhaseCharger: false,
                  consumptionExcludesCharging: false,
                  gracePeriodMinutes: 6,
                  cooldownPeriodMinutes: 15,
                  ampDebounceThreshold: 2,
                  ampDebounceSettleMinutes: 3,
                }),
              getBattery: () =>
                Promise.resolve({
                  batteryPriorityEnabled: false,
                  batteryPriorityLimit: 80,
                  batteryDischargeToleranceW: 300,
                  batteryDischargeGraceMinutes: 3,
                }),
            },
          ),
          poller: throwingMock<TrpcContext["poller"]>("EnergyPoller", {
            tryGetRealtimeSnapshot: () => ({
              timestamp: nowIso,
              realtime: {
                solarProductionW: 6500,
                gridPowerW: -1000,
                homeConsumptionW: 5500,
                batteryPowerW: null,
                batterySoc: null,
                gridVoltageV: 230,
                lastUpdated: nowIso,
              },
              cumulative: {
                solarProducedWh: 0,
                gridImportedWh: 0,
                gridExportedWh: 0,
                dailySolarProducedWh: 0,
                dailyGridImportWh: 0,
                dailyGridExportWh: 0,
              },
            }),
            getRealtimeMaxAgeMs: () => 90_000,
          }),
          eventEmitter,
        }),
      );

      const data = await caller.health.regulation();
      expect(data.commandQueueDepth).toBe(1);
      expect(data.vehicles).toHaveLength(1);
      expect(data.vehicles[0].effectiveLimitAmps).toBe(22);
      expect(data.vehicles[0].effectiveLimitCause).toBe("solar_ceiling");
      expect(data.vehicles[0].effectiveLimitLabel).toContain("22 A (5.1 kW)");
      expect(data.vehicles[0].commandQueueDepth).toBe(1);
      expect(data.vehicles[0].commandInFlight).toBe(true);
    });
  });
});
