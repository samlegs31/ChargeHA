import { ok, strictEqual } from "node:assert";
import { ConfigService } from "../../packages/server/src/services/ConfigService.ts";
import { ChargeController } from "../../packages/server/src/services/ChargeController.ts";
import { configRouter } from "../../packages/server/src/trpc/routers/config.ts";

function makeService(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  const db = {
    getConfig: (key: string) => Promise.resolve(values.get(key) ?? null),
    setConfig: (key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
  const service = new ConfigService(
    db as unknown as ConstructorParameters<typeof ConfigService>[0],
    {} as ConstructorParameters<typeof ConfigService>[1],
    null,
    {} as ConstructorParameters<typeof ConfigService>[3],
  );
  return { service, values };
}

for (const enabled of [true, false]) {
  Deno.test(`Reset clears the latch while preserving chargingEnabled=${enabled}`, async () => {
    const { service, values } = makeService({
      charging_enabled: String(enabled),
      charging_disabled_reason: "safety_trip",
      oscillation_trip_at: "2026-10-05 12:00:00",
      system_alert: "safety alert",
    });
    await service.resetSafetyStop();
    strictEqual((await service.getCharging()).chargingEnabled, enabled);
    strictEqual(
      values.get("charging_disabled_reason"),
      enabled ? "none" : "user",
    );
    strictEqual(values.get("system_alert"), "");
    strictEqual(values.get("oscillation_trip_at"), "2026-10-05 12:00:00");
    await service.resetSafetyStop();
    strictEqual(values.get("charging_enabled"), String(enabled));
  });
}

Deno.test("legacy OFF after oscillation can be reset without enabling charging", async () => {
  const { service, values } = makeService({
    charging_enabled: "false",
    oscillation_trip_at: "2026-09-16 10:00:00",
  });
  strictEqual(
    (await service.getCharging()).chargingDisabledReason,
    "safety_trip",
  );
  await service.resetSafetyStop();
  strictEqual(values.get("charging_enabled"), "false");
  strictEqual((await service.getCharging()).chargingDisabledReason, "user");
});

Deno.test("dismiss and unrelated charging settings cannot clear the safety latch", async () => {
  const { service, values } = makeService({
    charging_enabled: "true",
    charging_disabled_reason: "safety_trip",
    system_alert: "alert",
  });
  await service.dismissSystemAlert();
  await service.setCharging({ priorityChargingEnabled: true });
  strictEqual(values.get("charging_enabled"), "true");
  strictEqual(
    (await service.getCharging()).chargingDisabledReason,
    "safety_trip",
  );
});

Deno.test("only an explicit switch change writes the stored ON/OFF preference", async () => {
  const { service, values } = makeService({
    charging_disabled_reason: "safety_trip",
  });
  strictEqual((await service.getCharging()).chargingEnabled, true);
  await service.setConfigValue("charging_enabled", "false");
  strictEqual(values.get("charging_enabled"), "false");
  strictEqual(values.get("charging_disabled_reason"), "user");
  await service.setCharging({ chargingEnabled: true });
  strictEqual(values.get("charging_enabled"), "true");
  strictEqual(values.get("charging_disabled_reason"), "none");
});

Deno.test("ChargeController passes the independent latch to the real engine configuration", async () => {
  const { service } = makeService({
    charging_enabled: "true",
    charging_disabled_reason: "safety_trip",
  });
  const controller = Object.create(ChargeController.prototype);
  Reflect.set(controller, "configService", service);
  const config = await Reflect.get(controller, "loadConfig").call(controller);
  strictEqual(config.chargingEnabled, true);
  strictEqual(config.chargingDisabledReason, "safety_trip");
});

Deno.test("the charging Reset procedure calls the explicit reset service", async () => {
  const { service, values } = makeService({
    charging_enabled: "true",
    charging_disabled_reason: "safety_trip",
  });
  const caller = configRouter.createCaller(
    { configService: service } as Parameters<
      typeof configRouter.createCaller
    >[0],
  );
  const result = await caller.charging.resetSafetyStop();
  ok(result.success);
  strictEqual(values.get("charging_enabled"), "true");
  strictEqual(values.get("charging_disabled_reason"), "none");
});
