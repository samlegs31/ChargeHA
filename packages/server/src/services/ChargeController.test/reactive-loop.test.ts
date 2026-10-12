import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  BASE_ENERGY,
  setupController,
} from "../../test-helpers/ChargeControllerHarness.ts";
import { testable } from "../../test-helpers/Testable.ts";

Deno.test("reactive control coalesces bursts and stop removes pending work", async () => {
  using time = new FakeTime(Date.now());
  const ctx = await setupController();
  const controller = testable(ctx.controller);
  let cycles = 0;
  const run = ctx.controller.runOnce.bind(ctx.controller);
  ctx.controller.runOnce = () => {
    cycles++;
    return run();
  };
  try {
    controller.start();
    for (let i = 0; i < 100; i++) {
      ctx.trackingEmitter.emit("config_changed", { key: "solar_margin_kw" });
    }
    await time.tickAsync(1);
    assertEquals(cycles, 1);
    for (let i = 0; i < 100; i++) controller.requestEarlyCycle();
    await time.tickAsync(4998);
    assertEquals(cycles, 1);
    await time.tickAsync(1);
    assertEquals(cycles, 2);
    ctx.controller.stop();
    controller.requestEarlyCycle();
    await time.tickAsync(60_000);
    assertEquals(cycles, 2);
  } finally {
    ctx.controller.stop();
    ctx.db.close();
  }
});

Deno.test("simultaneous runOnce callers share a single controller cycle", async () => {
  const ctx = await setupController({}, "auto", BASE_ENERGY);
  const controller = testable(ctx.controller);
  const original = controller.runCycle.bind(ctx.controller);
  let count = 0;
  controller.runCycle = async () => {
    count++;
    return await original();
  };
  try {
    await Promise.all([
      ctx.controller.runOnce(),
      ctx.controller.runOnce(),
      ctx.controller.runOnce(),
    ]);
    assertEquals(count, 1);
  } finally {
    ctx.controller.stop();
    ctx.db.close();
  }
});
