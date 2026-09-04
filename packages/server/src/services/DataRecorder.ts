import type { EnergyData } from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { TariffService } from "./TariffService.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { Logger } from "../lib/Logger.ts";
import { isHome as computeIsHome, parseHomeCoords } from "@chargeha/shared/geo";
import { calculateSolarAttribution } from "@chargeha/shared/solarAttribution";

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_DATA_RETENTION_DAYS = 730;
const DEFAULT_LOG_RETENTION_DAYS = 7;
const PRUNE_EVERY_N_TICKS = 100;

export class DataRecorder {
  private readonly db: AppDatabase;
  private readonly vehicleManager: VehicleManager;
  private readonly tariffService: TariffService;
  private readonly logger: Logger;
  /** Promise-wrapped timeout id kept for the existing stop/test contract.
   *  Recording is intentionally fixed at 60 seconds because Stats integrate
   *  every stored sample as one minute. */
  private timer: Promise<ReturnType<typeof setTimeout>> | null = null;
  private latestRealtime: EnergyData | null = null;
  private tickCount = 0;

  constructor(
    db: AppDatabase,
    vehicleManager: VehicleManager,
    tariffService: TariffService,
    eventEmitter: TypedEventEmitter,
    logger: Logger,
  ) {
    this.db = db;
    this.vehicleManager = vehicleManager;
    this.tariffService = tariffService;
    this.logger = logger;

    eventEmitter.subscribe("energy_update", (data) => {
      this.latestRealtime = data;
    });
    this.start();
  }

  private start(): void {
    this.logger.info("Started");
    this.scheduleNext();
  }

  async stop(): Promise<void> {
    if (!this.timer) return;
    const id = await this.timer;
    clearTimeout(id);
    this.timer = null;
  }

  private scheduleNext(): void {
    // Fixed one-minute cadence: StatsRepository integrates each sample using
    // 60 / 3600, so allowing another interval would make kWh/cost incorrect.
    this.timer = Promise.resolve(
      setTimeout(() => this.tick(), DEFAULT_INTERVAL_SECONDS * 1000),
    );
  }

  private async tick(): Promise<void> {
    await this.record();

    // Periodic pruning of old data
    this.tickCount++;
    if (this.tickCount % PRUNE_EVERY_N_TICKS === 0) {
      try {
        const dataVal = await this.db.getConfig("data_retention_days");
        const dataDays =
          parseInt(dataVal ?? String(DEFAULT_DATA_RETENTION_DAYS), 10) ||
          DEFAULT_DATA_RETENTION_DAYS;
        const logVal = await this.db.getConfig("log_retention_days");
        const logDays =
          parseInt(logVal ?? String(DEFAULT_LOG_RETENTION_DAYS), 10) ||
          DEFAULT_LOG_RETENTION_DAYS;
        await this.db.pruneEnergyReadings(dataDays);
        await this.db.pruneVehicleChargeReadings(dataDays);
        await this.db.pruneVehiclePollLogs(logDays);
        // Plugin logs are noisy per-API-call entries — short retention.
        await this.db.prunePluginLogs(logDays);
      } catch (error) {
        this.logger.error("Failed to prune old data:", error);
      }
    }

    this.scheduleNext();
  }

  private async record(): Promise<void> {
    if (!this.latestRealtime) return;

    // Resolve tariff rate once per recording tick for both energy and vehicle readings
    const ratePerKwh = await this.tariffService.resolveCurrentRate();

    try {
      await this.db.insertEnergyReading(this.latestRealtime, ratePerKwh);
    } catch (error) {
      this.logger.error("Failed to write energy reading:", error);
    }

    try {
      await this.recordVehicleCharges(ratePerKwh);
    } catch (error) {
      this.logger.error(
        "Failed to write vehicle charge reading:",
        error,
      );
    }
  }

  private async recordVehicleCharges(
    ratePerKwh: number | null,
  ): Promise<void> {
    if (!this.latestRealtime) return;

    const allStates = await this.vehicleManager.getAllStates();
    if (allStates.size === 0) return;

    // Collect charging vehicles and their power
    const activeStates = [...allStates]
      .filter(([_, state]) => state.isCharging && state.chargePowerKw > 0);
    if (activeStates.length === 0) return;

    const homeLat = await this.db.getConfig("home_latitude");
    const homeLng = await this.db.getConfig("home_longitude");
    const home = parseHomeCoords(homeLat, homeLng);
    const chargingVehicles = activeStates
      .map(([id, state]) => ({
        id,
        state,
        // Unknown charging is retained as non-home energy and never
        // attributed to the house.
        isHome: computeIsHome(home, state) === true,
      }));
    const totalHomeChargePowerW = chargingVehicles
      .filter(({ isHome }) => isHome)
      .reduce((sum, { state }) => sum + state.chargePowerKw * 1000, 0);

    // Get energy data for solar attribution
    const energy = this.latestRealtime;
    const solarProductionW = energy.solarProductionW;
    const homeConsumptionW = energy.homeConsumptionW;
    const batteryPowerW = energy.batteryPowerW ?? 0;
    // When the energy poll failed, the home/solar values are zeros (a breadcrumb
    // written by EnergyPoller) so we cannot compute solar attribution. Charge
    // everything to grid — that is the safe default during an inverter outage.
    const energyPollFailed = energy.pollFailed === true;

    await chargingVehicles.reduce((chain, { id, state, isHome }) => {
      const chargePowerW = state.chargePowerKw * 1000;

      // For away charging: solar_contribution_w = 0, grid_contribution_w = 0
      const homeAttribution = this.attributeHomeCharge(
        energyPollFailed,
        chargePowerW,
        totalHomeChargePowerW,
        solarProductionW,
        homeConsumptionW,
        batteryPowerW,
      );
      const awayDefault = {
        solarContributionW: 0,
        batteryContributionW: 0,
        gridContributionW: 0,
      };
      const {
        solarContributionW,
        batteryContributionW,
        gridContributionW,
      } = isHome ? homeAttribution : awayDefault;
      // charge_power_w carries the total for away aggregation

      return chain.then(() =>
        this.db.insertVehicleChargeReading({
          vehicleId: id,
          chargePowerW,
          chargeAmps: state.chargeAmps,
          batteryLevel: state.batteryLevel,
          solarContributionW,
          batteryContributionW,
          gridContributionW,
          isHome,
          ratePerKwh,
        })
      );
    }, Promise.resolve());
  }

  /** Resolve the per-vehicle attribution at home, routing all charging to grid
   *  when the latest energy poll failed (we cannot trust solar/home values). */
  private attributeHomeCharge(
    energyPollFailed: boolean,
    chargePowerW: number,
    totalChargePowerW: number,
    solarProductionW: number,
    homeConsumptionW: number,
    batteryPowerW: number,
  ): {
    solarContributionW: number;
    batteryContributionW: number;
    gridContributionW: number;
  } {
    if (energyPollFailed) {
      return {
        solarContributionW: 0,
        batteryContributionW: 0,
        gridContributionW: chargePowerW,
      };
    }
    const { solarW, batteryW, gridW } = calculateSolarAttribution(
      chargePowerW,
      totalChargePowerW,
      solarProductionW,
      homeConsumptionW,
      batteryPowerW,
    );
    return {
      solarContributionW: solarW,
      batteryContributionW: batteryW,
      gridContributionW: gridW,
    };
  }
}
