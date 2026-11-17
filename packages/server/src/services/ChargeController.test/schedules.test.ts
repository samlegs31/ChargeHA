import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  BASE_ENERGY,
  type ControllerCtx,
  currentScheduleWindow,
  REQUEST_CONTEXT,
  setupController,
  setupMultiVehicleController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";
import { OSCILLATION_BY_VEHICLE_KEY, Overseer } from "../Overseer.ts";
import { Logger } from "../../lib/Logger.ts";
import { testable } from "../../test-helpers/Testable.ts";
import { toSqliteDatetime } from "../../db/repositories/sqliteHelpers.ts";

describe("ChargeController — schedules", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("blockout schedule", () => {
    it("stops charging during active blockout", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();

      ctx = await setupController({ isCharging: true }, "auto");
      await ctx.db.createSchedule({
        id: "blockout-1",
        vehicleId: null,
        scheduleType: "blockout",
        startTime,
        endTime,
        days: [today],
        chargeAmps: null,
        chargeLimitPct: null,
        enabled: true,
      });
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(log?.action).toBe("stop");
      expect(
        log.checks.some(
          (c) => c.check === "blockout_schedule" && c.result.includes("active"),
        ),
      ).toBe(true);
    });
  });

  describe("charge schedule", () => {
    it("charges at scheduled amps during active schedule", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();

      ctx = await setupController({}, "auto");
      await ctx.db.createSchedule({
        id: "charge-1",
        vehicleId: VIN,
        scheduleType: "charge",
        startTime,
        endTime,
        days: [today],
        chargeAmps: 16,
        chargeLimitPct: null,
        enabled: true,
      });
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
      expect(ctx.adapter.commands).toContainEqual({
        cmd: "setAmps",
        args: 16,
      });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("start");
      expect(log?.targetAmps).toBe(16);
    });

    it("permits an active SOLAR + clock schedule even when home-battery protection is triggered", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();
      ctx = await setupController(
        {},
        "auto",
        { ...BASE_ENERGY, batterySoc: 20, batteryPowerW: 2500 },
        {
          battery_priority_enabled: "true",
          battery_priority_limit: "80",
          battery_discharge_tolerance_w: "0",
          battery_discharge_grace_minutes: "0",
        },
      );
      await ctx.db.createSchedule({
        id: "charge-battery-protected",
        vehicleId: VIN,
        scheduleType: "charge",
        startTime,
        endTime,
        days: [today],
        chargeAmps: 16,
        chargeLimitPct: null,
        enabled: true,
      });

      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("start");
      expect(log?.targetAmps).toBe(16);
    });

    it("keeps a scheduled charge running when the home battery discharges during the window", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();
      ctx = await setupController(
        { isCharging: true, chargeAmps: 16, chargePowerKw: 3.68 },
        "auto",
        { ...BASE_ENERGY, batterySoc: 90, batteryPowerW: 1200 },
        {
          battery_priority_enabled: "true",
          battery_priority_limit: "80",
          battery_discharge_tolerance_w: "0",
          battery_discharge_grace_minutes: "5",
        },
      );
      await ctx.db.createSchedule({
        id: "charge-battery-discharge",
        vehicleId: VIN,
        scheduleType: "charge",
        startTime,
        endTime,
        days: [today],
        chargeAmps: 16,
        chargeLimitPct: null,
        enabled: true,
      });

      await ctx.runOneLoop();

      expect(ctx.adapter.commands).not.toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.targetAmps).toBe(16);
    });

    it("does not apply a charge schedule in SOLAR ONLY mode", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();
      ctx = await setupController(
        {},
        "vacation",
        { ...BASE_ENERGY, solarProductionW: 0, gridPowerW: 1000 },
      );
      await ctx.db.createSchedule({
        id: "charge-solar-only",
        vehicleId: VIN,
        scheduleType: "charge",
        startTime,
        endTime,
        days: [today],
        chargeAmps: 16,
        chargeLimitPct: null,
        enabled: true,
      });

      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.checks.some((check) => check.check === "charge_schedule"))
        .toBe(false);
    });

    it("clears safety trips and runs uninterrupted over >10 minutes despite battery protection, overlapping blockout, zero solar, and inverter poll failure", async () => {
      using time = new FakeTime(Date.now());
      const { today, startTime, endTime } = currentScheduleWindow();
      const localCtx = await setupController(
        {
          isCharging: false,
          chargeAmps: 0,
          batteryLevel: 50,
          chargeLimit: 90,
        },
        "auto",
        {
          ...BASE_ENERGY,
          solarProductionW: 0,
          gridPowerW: 1500,
          batterySoc: 10,
          batteryPowerW: 3000,
          lastUpdated: new Date().toISOString(),
        },
        {
          battery_priority_enabled: "true",
          battery_priority_limit: "80",
          battery_discharge_tolerance_w: "0",
          battery_discharge_grace_minutes: "3",
          grace_period_minutes: "1",
          cooldown_period_minutes: "10",
          max_grid_import_kw: "6",
        },
      );
      const overseer = new Overseer(
        localCtx.db,
        localCtx.trackingEmitter,
        new Logger("schedule-safety-test", "error"),
        localCtx.manager,
      );
      overseer.stop();

      const fetch = localCtx.adapter.getChargeState.bind(localCtx.adapter);
      localCtx.adapter.getChargeState = async (origin) => ({
        ...await fetch(origin),
        lastUpdated: new Date().toISOString(),
      });

      try {
        // Pre-seed 5 start/stop transitions and trigger a real Overseer safety trip.
        for (
          const action of ["start", "stop", "start", "stop", "start"] as const
        ) {
          await localCtx.db.insertControllerLogEntries([{
            vehicleId: VIN,
            vehicleName: "Test Car",
            mode: "auto",
            inputsJson: "{}",
            checksJson: "{}",
            action,
            actionDetail: action,
            targetAmps: null,
            traceId: "pre-trip",
          }]);
        }
        await testable(overseer).check();
        expect(await localCtx.db.getConfig("oscillation_paused")).toBe("true");
        expect(await localCtx.db.getConfig("system_alert")).not.toBe("");

        // Add overlapping blockout + active charge schedule.
        await localCtx.db.createSchedule({
          id: "overlap-blockout",
          vehicleId: null,
          scheduleType: "blockout",
          startTime,
          endTime,
          days: [today],
          chargeAmps: null,
          chargeLimitPct: null,
          enabled: true,
        });
        await localCtx.db.createSchedule({
          id: "charge-immune",
          vehicleId: VIN,
          scheduleType: "charge",
          startTime,
          endTime,
          days: [today],
          chargeAmps: 16,
          chargeLimitPct: 80,
          enabled: true,
        });

        // 12 ticks (11 minutes > 3-min battery discharge grace & > 90s energy outage grace).
        for (let tick = 0; tick < 12; tick++) {
          if (tick > 0) time.tick(60_000);
          assertExists(localCtx.poller.snapshot);
          const inverterOut = tick >= 3 && tick <= 8;
          const evWatts = localCtx.adapter.state.isCharging
            ? localCtx.adapter.state.chargeAmps * 230
            : 0;
          localCtx.adapter.state.chargePowerKw = evWatts / 1000;
          localCtx.poller.snapshot = inverterOut
            ? {
              realtime: {
                ...BASE_ENERGY,
                pollFailed: true,
                solarProductionW: 0,
                batterySoc: 10,
                batteryPowerW: 3000,
                gridPowerW: 1500 + evWatts,
                lastUpdated: new Date().toISOString(),
              },
              cumulative: {
                solarProducedWh: 0,
                gridImportedWh: 0,
                gridExportedWh: 0,
                dailySolarProducedWh: 0,
                dailyGridImportWh: 0,
                dailyGridExportWh: 0,
              },
            }
            : {
              realtime: {
                ...BASE_ENERGY,
                solarProductionW: 0,
                batterySoc: 10,
                batteryPowerW: 3000,
                gridPowerW: 1500 + evWatts,
                lastUpdated: new Date().toISOString(),
              },
              cumulative: {
                solarProducedWh: 0,
                gridImportedWh: 0,
                gridExportedWh: 0,
                dailySolarProducedWh: 0,
                dailyGridImportWh: 0,
                dailyGridExportWh: 0,
              },
            };

          await localCtx.runOneLoop();
          await testable(overseer).check();

          expect(localCtx.adapter.commands).not.toContainEqual({ cmd: "stop" });
          expect(localCtx.adapter.state.isCharging).toBe(true);
          expect(localCtx.adapter.state.chargeAmps).toBe(16);
          expect(await localCtx.db.getConfig("oscillation_paused")).toBe(
            "false",
          );
          expect(await localCtx.db.getConfig("system_alert")).toBe("");
        }

        const inScheduleLog = await localCtx.getLastLogParsed();
        const inputs = inScheduleLog?.inputs as {
          config?: { oscillationPaused?: boolean };
        };
        expect(inputs?.config?.oscillationPaused).toBe(false);

        // End of schedule window: disable schedule, keep battery violation -> must stop
        // immediately under Priority 3, and Overseer must NOT re-trip falsely.
        localCtx.adapter.commands = [];
        await localCtx.db.updateSchedule("charge-immune", { enabled: false });
        await localCtx.db.updateSchedule("overlap-blockout", {
          enabled: false,
        });
        time.tick(10_000);
        assertExists(localCtx.poller.snapshot);
        localCtx.poller.snapshot.realtime = {
          ...BASE_ENERGY,
          solarProductionW: 5000,
          gridPowerW: -2000,
          batterySoc: 10,
          batteryPowerW: 3000,
          lastUpdated: new Date().toISOString(),
        };
        await localCtx.runOneLoop();
        await testable(overseer).check();

        expect(localCtx.adapter.commands).toContainEqual({ cmd: "stop" });
        expect(localCtx.adapter.state.isCharging).toBe(false);
        expect(await localCtx.db.getConfig("oscillation_paused")).toBe("false");
      } finally {
        overseer.stop();
        localCtx.controller.stop();
        localCtx.db.close();
      }
    });

    it("STOP mode immediately halts an active scheduled charge", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();
      ctx = await setupController({}, "auto");
      await ctx.db.createSchedule({
        id: "charge-before-stop",
        vehicleId: VIN,
        scheduleType: "charge",
        startTime,
        endTime,
        days: [today],
        chargeAmps: 16,
        chargeLimitPct: null,
        enabled: true,
      });

      await ctx.runOneLoop();
      expect(ctx.adapter.state.isCharging).toBe(true);
      expect(ctx.adapter.state.chargeAmps).toBe(16);

      ctx.adapter.commands = [];
      await ctx.db.updateVehicleMode(VIN, "stop");
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
      expect(ctx.adapter.state.isCharging).toBe(false);
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("stop");
    });

    it("clears safety trip only for the scheduled vehicle while keeping an unscheduled vehicle paused", async () => {
      using _time = new FakeTime(Date.now());
      const { today, startTime, endTime } = currentScheduleWindow();
      const VIN_1 = "TEST_VIN_001";
      const VIN_2 = "TEST_VIN_002";
      const multiCtx = await setupMultiVehicleController(
        [
          {
            vin: VIN_1,
            name: "Scheduled Car",
            priority: 1,
            state: { isCharging: false, chargeAmps: 0 },
            mode: "auto",
          },
          {
            vin: VIN_2,
            name: "Solar Only Car",
            priority: 2,
            state: { isCharging: false, chargeAmps: 0 },
            mode: "auto",
          },
        ],
        {
          ...BASE_ENERGY,
          solarProductionW: 0,
          gridPowerW: 500,
          lastUpdated: new Date().toISOString(),
        },
        { priority_charging_enabled: "true" },
      );
      const overseer = new Overseer(
        multiCtx.db,
        multiCtx.trackingEmitter,
        new Logger("multi-schedule-safety-test", "error"),
        multiCtx.manager,
      );
      overseer.stop();

      try {
        const tripAt = toSqliteDatetime(new Date().toISOString());
        await multiCtx.db.setConfig("oscillation_paused", "true");
        await multiCtx.db.setConfig("oscillation_trip_at", tripAt);
        await multiCtx.db.setConfig(
          "system_alert",
          JSON.stringify({
            message: "Paused V1",
            timestamp: new Date().toISOString(),
            vehicleId: VIN_1,
            vehicleName: "Scheduled Car",
          }),
        );
        await multiCtx.db.setPluginConfig(
          OSCILLATION_BY_VEHICLE_KEY,
          JSON.stringify({
            [VIN_1]: {
              paused: true,
              tripAt,
              vehicleName: "Scheduled Car",
              alertMessage: "Paused V1",
            },
            [VIN_2]: {
              paused: true,
              tripAt,
              vehicleName: "Solar Only Car",
              alertMessage: "Paused V2",
            },
          }),
        );

        await multiCtx.db.createSchedule({
          id: "charge-vin1-only",
          vehicleId: VIN_1,
          scheduleType: "charge",
          startTime,
          endTime,
          days: [today],
          chargeAmps: 14,
          chargeLimitPct: null,
          enabled: true,
        });

        await multiCtx.runOneLoop();
        await testable(overseer).check();

        expect(multiCtx.adapters.get(VIN_1)?.state.isCharging).toBe(true);
        expect(multiCtx.adapters.get(VIN_1)?.state.chargeAmps).toBe(14);
        expect(multiCtx.adapters.get(VIN_2)?.state.isCharging).toBe(false);

        const rawMap = await multiCtx.db.getPluginConfig(
          OSCILLATION_BY_VEHICLE_KEY,
        );
        const byVehicle = JSON.parse(rawMap ?? "{}");
        expect(byVehicle[VIN_1]?.paused).toBe(false);
        expect(byVehicle[VIN_2]?.paused).toBe(true);
        expect(await multiCtx.db.getConfig("oscillation_paused")).toBe("true");
        const remainingAlert = JSON.parse(
          (await multiCtx.db.getConfig("system_alert")) || "{}",
        );
        expect(remainingAlert.vehicleId).toBe(VIN_2);
      } finally {
        overseer.stop();
        multiCtx.controller.stop();
        multiCtx.db.close();
      }
    });
  });

  describe("schedule to solar transition", () => {
    it("stops immediately when no solar generation (nighttime)", async () => {
      // Was charging at 16A under a schedule that just ended; zero solar means
      // grace-period would burn grid for nothing — should stop now.
      ctx = await setupController(
        { isCharging: true, chargeAmps: 16, chargePowerKw: 3.68 },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 0, gridPowerW: 3500 },
      );
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("stop");
      expect(log?.actionDetail).toContain("no solar generation");
      expect(log?.actionDetail).toContain("no grace period");
    });

    it("drops to min amps during grace period when solar exists but is insufficient", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 16, chargePowerKw: 3.68 },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 5000, gridPowerW: -4000 },
      );
      await ctx.runOneLoop();
      ctx.adapter.commands = [];
      assertExists(ctx.poller.snapshot);
      ctx.poller.snapshot.realtime = {
        ...BASE_ENERGY,
        solarProductionW: 500,
        gridPowerW: 3500,
      };
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({
        cmd: "setAmps",
        args: 5,
      });
      expect(ctx.adapter.commands).not.toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("adjust_amps");
      expect(log?.targetAmps).toBe(5);
    });

    it("enters grace period when solar is below min generation but non-zero", async () => {
      // 800W is below the 1kW min_solar_generation threshold but not zero —
      // should grace, not stop hard.
      ctx = await setupController(
        { isCharging: true, chargeAmps: 10, chargePowerKw: 2.3 },
        "auto",
        {
          ...BASE_ENERGY,
          solarProductionW: 4000,
          gridPowerW: -2500,
          homeConsumptionW: 1500,
        },
        { min_solar_generation_kw: "1", grace_period_minutes: "6" },
      );
      await ctx.runOneLoop();
      ctx.adapter.commands = [];
      assertExists(ctx.poller.snapshot);
      ctx.poller.snapshot.realtime = {
        ...BASE_ENERGY,
        solarProductionW: 800,
        gridPowerW: 2000,
        homeConsumptionW: 2800,
      };

      await ctx.runOneLoop();

      expect(ctx.adapter.commands).not.toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("adjust_amps");
      expect(log?.actionDetail).toContain("grace");
      expect(log?.targetAmps).toBe(5);
    });

    it("enforces cooldown after grace expires due to low solar generation", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 10, chargePowerKw: 2.3 },
        "auto",
        {
          ...BASE_ENERGY,
          solarProductionW: 4000,
          gridPowerW: -2500,
          homeConsumptionW: 1500,
        },
        {
          min_solar_generation_kw: "1",
          grace_period_minutes: "1",
          cooldown_period_minutes: "15",
        },
      );

      using fakeTime = new FakeTime();

      await ctx.runOneLoop();
      ctx.adapter.commands = [];
      assertExists(ctx.poller.snapshot);
      ctx.poller.snapshot.realtime = {
        ...BASE_ENERGY,
        solarProductionW: 800,
        gridPowerW: 2000,
        homeConsumptionW: 2800,
      };

      // Loop 1: enters grace period
      await ctx.runOneLoop();
      expect(ctx.adapter.commands).not.toContainEqual({ cmd: "stop" });

      // Loop 2: grace expires → stop with cooldown
      fakeTime.tick(90_000);
      await ctx.runOneLoop();
      const log1 = await ctx.getLastLogParsed();
      expect(log1?.action).toBe("stop");
      expect(log1?.actionDetail).toContain("grace period expired");

      // Solar recovers — enough to charge
      ctx.adapter.commands = [];
      ctx.adapter.state = {
        ...ctx.adapter.state,
        isCharging: false,
        chargeAmps: 0,
        chargePowerKw: 0,
      };
      await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
      assertExists(ctx.poller.snapshot);
      ctx.poller.snapshot.realtime = {
        ...BASE_ENERGY,
        solarProductionW: 5000,
        gridPowerW: -2000,
      };

      // Loop 3: 1 minute later — cooldown should prevent restart
      fakeTime.tick(60_000);
      await ctx.runOneLoop();
      const log2 = await ctx.getLastLogParsed();
      expect(log2?.action).toBe("none");
      expect(log2?.actionDetail).toContain("ooldown");

      // Loop 4: after cooldown expires — should restart
      ctx.adapter.commands = [];
      fakeTime.tick(15 * 60_000);
      await ctx.runOneLoop();
      const log3 = await ctx.getLastLogParsed();
      expect(log3?.action).toBe("start");
    });
  });
});
