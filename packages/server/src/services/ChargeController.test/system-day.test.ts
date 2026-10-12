import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  BASE_ENERGY,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

for (const solarCap of [null, 22]) {
  Deno.test(`24h closed-loop system simulation with command refusals and outages (solar cap ${solarCap ?? "unset"})`, async () => {
    using time = new FakeTime(Date.UTC(2026, 5, 15));
    const ctx = await setupController(
      {
        isCharging: false,
        chargeAmps: 0,
        chargeAmpsMax: solarCap === null ? 16 : 32,
      },
      "auto",
      BASE_ENERGY,
      {
        timezone: "UTC",
        grace_period_minutes: "3",
        cooldown_period_minutes: "2",
        vehicle_current_limits: JSON.stringify({
          [VIN]: solarCap === null ? 16 : 32,
        }),
        vehicle_solar_current_limits: JSON.stringify(
          solarCap === null ? {} : { [VIN]: solarCap },
        ),
      },
    );
    let minute = 0;
    let awake = false;
    let fetches = 0;
    let rejectedStart = 0;
    let rejectedAmps = 0;
    let rejectedStops = 0;
    let energyKwh = 0;
    const rows: Array<Record<string, unknown>> = [];
    const originalFetch = ctx.adapter.getChargeState.bind(ctx.adapter);
    ctx.adapter.isVehicleOnline = () => Promise.resolve(awake);
    ctx.adapter.wakeVehicle = () => {
      ctx.adapter.commands.push({ cmd: "wake" });
      awake = true;
      return Promise.resolve(true);
    };
    ctx.adapter.getChargeState = (origin) => {
      fetches++;
      if (minute >= 630 && minute < 640) {
        return Promise.reject(new Error("injected telemetry outage"));
      }
      return originalFetch(origin);
    };
    const start = ctx.adapter.startCharging.bind(ctx.adapter);
    ctx.adapter.startCharging = (origin) => {
      ctx.adapter.startChargingResult = rejectedStart++ > 0;
      return start(origin);
    };
    const setAmps = ctx.adapter.setChargeAmps.bind(ctx.adapter);
    ctx.adapter.setChargeAmps = (amps, origin) => {
      ctx.adapter.setChargeAmpsResult = rejectedAmps++ > 0;
      return setAmps(amps, origin);
    };
    const stop = ctx.adapter.stopCharging.bind(ctx.adapter);
    ctx.adapter.stopCharging = (origin) => {
      ctx.adapter.stopChargingResult = !(minute === 630 || minute === 631);
      if (!ctx.adapter.stopChargingResult) rejectedStops++;
      return stop(origin);
    };
    try {
      for (minute = 0; minute < 1440; minute++) {
        time.tick(60_000);
        const disabled = minute >= 570 && minute < 580;
        const external = minute >= 990 && minute < 1020;
        if (minute === 570 || minute === 580) {
          await ctx.db.setConfig("charging_enabled", String(!disabled));
        }
        if (minute === 990 || minute === 1020) {
          await ctx.db.setConfig(
            "external_charging_vehicles",
            JSON.stringify({ [VIN]: external }),
          );
        }
        // Physical current follows accepted commands on the next sample, never
        // copies optimistic manager state back into the simulated vehicle.
        const actual = ctx.adapter.state.isCharging
          ? ctx.adapter.state.chargeAmps
          : 0;
        ctx.adapter.state.chargeAmpsActual = actual;
        ctx.adapter.state.chargePowerKw = actual * 0.23;
        energyKwh += actual * 0.23 / 60;
        ctx.adapter.state.batteryLevel = 20 + energyKwh / 75 * 100;
        let solar = Math.max(
          0,
          6200 * Math.sin((minute - 360) / 720 * Math.PI),
        );
        if (minute < 360 || minute > 1080) solar = 0;
        if (minute >= 660 && minute < 675) solar *= 0.25;
        if (minute >= 780 && minute < 800) solar = 100;
        const home = 600 + (minute >= 720 && minute < 730 ? 2800 : 0);
        const meterFailed = minute >= 840 && minute < 850;
        assertExists(ctx.poller.snapshot);
        ctx.poller.snapshot.realtime = {
          ...BASE_ENERGY,
          solarProductionW: solar,
          gridPowerW: home + actual * 230 - solar,
          homeConsumptionW: home + actual * 230,
          pollFailed: meterFailed,
          lastUpdated: new Date().toISOString(),
        };
        const offset = ctx.adapter.commands.length;
        await ctx.runOneLoop();
        const commands = ctx.adapter.commands.slice(offset);
        const log = await ctx.getLastLogParsed();
        for (const command of commands) {
          if (command.cmd === "setAmps") {
            expect(Number.isInteger(command.args)).toBe(true);
            expect(command.args as number).toBeGreaterThanOrEqual(5);
            expect(command.args as number).toBeLessThanOrEqual(solarCap ?? 16);
          }
        }
        if (disabled) expect(ctx.adapter.state.isCharging).toBe(false);
        if (external) expect(commands).toEqual([]);
        if (minute >= 630 && minute < 640) {
          expect(commands.some((c) => c.cmd === "start" || c.cmd === "setAmps"))
            .toBe(false);
          if (minute >= 632) expect(ctx.adapter.state.isCharging).toBe(false);
        }
        if (minute === 650) expect(ctx.adapter.state.isCharging).toBe(true);
        if (minute === 849) expect(ctx.adapter.state.isCharging).toBe(false);
        if (minute === 870) expect(ctx.adapter.state.isCharging).toBe(true);
        if (minute < 360) expect(commands).toEqual([]);
        if (minute >= 1100) expect(ctx.adapter.state.isCharging).toBe(false);
        if (
          commands.some((c) => c.cmd === "stop") &&
          !ctx.adapter.stopChargingResult
        ) {
          expect(log?.action).toBe("none");
          expect(log?.actionDetail).toContain("Command not executed");
        }
        rows.push({
          minute,
          solarW: Math.round(solar),
          homeW: home,
          actualAmps: actual,
          charging: ctx.adapter.state.isCharging,
          commands,
          action: log?.action,
          reason: log?.actionDetail,
          disabled,
          external,
          meterFailed,
        });
      }
      expect(energyKwh).toBeGreaterThan(5);
      expect(rejectedStart).toBeGreaterThan(1);
      expect(rejectedAmps).toBeGreaterThan(1);
      expect(rejectedStops).toBe(2);
      expect(await ctx.db.getConfig("charging_enabled")).toBe("true");
      const peakCommandAmps = Math.max(
        ...ctx.adapter.commands.filter((c) => c.cmd === "setAmps").map((c) =>
          Number(c.args)
        ),
      );
      expect(peakCommandAmps).toBe(solarCap ?? 16);
      const summary = {
        solarCap,
        peakCommandAmps,
        ticks: rows.length,
        simulatedHours: 24,
        energyKwh: Number(energyKwh.toFixed(3)),
        fetches,
        commands: ctx.adapter.commands.length,
        wakes: ctx.adapter.commands.filter((c) => c.cmd === "wake").length,
        injectedRefusals: { start: 1, setAmps: 1, stop: rejectedStops },
      };
      console.log("SYSTEM_SIMULATION", JSON.stringify(summary));
      const report = Deno.env.get("CHARGEHA_SIM_REPORT");
      if (report) {
        await Deno.writeTextFile(
          solarCap === null ? report : `${report}.solar-${solarCap}.json`,
          JSON.stringify({ summary, rows }, null, 2),
        );
      }
    } finally {
      ctx.controller.stop();
      ctx.db.close();
    }
  });
}
