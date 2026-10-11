import { assert, assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { SolarForecastService } from "./SolarForecastService.ts";
import { ConfigService } from "./ConfigService.ts";
import { Logger } from "../lib/Logger.ts";
import type { EnergyAdapterManager } from "./EnergyAdapterManager.ts";
import type { EnergyPoller } from "./EnergyPoller.ts";
import type { ScheduleService } from "./ScheduleService.ts";
import {
  BASE_ENERGY,
  REQUEST_CONTEXT,
  setupController,
  VIN,
} from "../test-helpers/ChargeControllerHarness.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";

Deno.test("background habit learning persists across service restart without vehicle commands or weather calls", async () => {
  using time = new FakeTime(Date.UTC(2026, 0, 5, 12));
  const ctx = await setupController(
    { isPluggedIn: true },
    "auto",
    BASE_ENERGY,
    { timezone: "UTC" },
  );
  let now = new Date("2026-01-05T12:00:00Z");
  let weatherCalls = 0;
  const logger = new Logger("habit-test", "error");
  const create = () =>
    new SolarForecastService(
      ctx.db,
      new ConfigService(
        ctx.db,
        throwingMock<EnergyAdapterManager>("energy"),
        null,
        logger,
      ),
      ctx.manager,
      ctx.poller as unknown as EnergyPoller,
      throwingMock<ScheduleService>("schedule"),
      logger,
      () => {
        weatherCalls++;
        return Promise.reject(new Error("unexpected weather fetch"));
      },
      () => now,
    );
  try {
    const service = create();
    service.startBackgroundLearning(ctx.trackingEmitter);
    service.startBackgroundLearning(ctx.trackingEmitter);
    for (let week = 0; week < 4; week++) {
      now = new Date(Date.UTC(2026, 0, 5 + week * 7, 12));
      time.tick(now.getTime() - Date.now());
      ctx.adapter.state.lastUpdated = now.toISOString();
      await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
      ctx.trackingEmitter.emit("energy_update", {
        ...BASE_ENERGY,
        solarProductionW: 0,
        batterySoc: 70,
        lastUpdated: now.toISOString(),
        solarProducedWh: 0,
        gridImportedWh: 0,
        gridExportedWh: 0,
        dailySolarProducedWh: 0,
        dailyGridImportWh: 0,
        dailyGridExportWh: 0,
      });
      // Drain asynchronous bounded background work without a production timer.
      await time.tickAsync(1);
    }
    const restored = create();
    const outlook = await restored.getConnectionOutlook(VIN);
    assertEquals(outlook.hours.length, 24);
    assertEquals(outlook.hours[0].samples, 4);
    assert((outlook.hours[0].probability ?? 0) > 0.8);
    assertEquals(outlook.hours[0].weather, "unknown");
    const [first, second] = await Promise.all([
      restored.getTodayForecast(VIN),
      restored.getTodayForecast(VIN),
    ]);
    assert(
      first === second,
      "Concurrent requests share one forecast computation",
    );
    assertEquals(first.connectionOutlook?.hours[0].samples, 4);
    assertEquals(weatherCalls, 0);
    assertEquals(ctx.adapter.commands, []);
    assertEquals(
      (await restored.getConnectionOutlook("missing")).hours[0].probability,
      null,
    );
  } finally {
    ctx.controller.stop();
    ctx.db.close();
  }
});
