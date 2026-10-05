import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { Overseer } from "../../packages/server/src/services/Overseer.ts";
import { ControllerEngine } from "../../packages/shared/engine/ControllerEngine.ts";
import { makeInput } from "../../packages/shared/engine/test-helpers/controller-engine.ts";

for (const preference of [null, "true", "false"]) {
  Deno.test(`oscillation preserves the ${preference ?? "default"} user preference and forces STOP`, async () => {
    const values = new Map<string, string>();
    if (preference !== null) values.set("charging_enabled", preference);
    const writes: Array<[string, string]> = [];
    const events: string[] = [];
    let stopRequests = 0;
    const db = {
      getConfig: (key: string) => Promise.resolve(values.get(key) ?? null),
      setConfig: (key: string, value: string) => {
        writes.push([key, value]);
        values.set(key, value);
        return Promise.resolve();
      },
      getRecentStateChanges: () =>
        Promise.resolve(
          ["start", "stop", "start", "stop", "start"].map((action) => ({
            vehicleId: "V1",
            vehicleName: "Test car",
            action,
          })),
        ),
    };
    const manager = {
      getState: () => Promise.resolve({ isCharging: true }),
      stopCharging: (
        _id: string,
        _context: unknown,
        _state: unknown,
        options: { force: boolean },
      ) => {
        strictEqual(values.get("charging_disabled_reason"), "safety_trip");
        strictEqual(options.force, true);
        stopRequests++;
        return Promise.resolve({ success: true });
      },
    };
    const overseer = new Overseer(
      db as unknown as ConstructorParameters<typeof Overseer>[0],
      {
        emit: (event: string) => events.push(event),
      } as unknown as ConstructorParameters<typeof Overseer>[1],
      { info() {}, error() {} } as unknown as ConstructorParameters<
        typeof Overseer
      >[2],
      manager as unknown as ConstructorParameters<typeof Overseer>[3],
    );
    try {
      await Reflect.get(overseer, "check").call(overseer);
      strictEqual(values.get("charging_enabled") ?? null, preference);
      strictEqual(writes.some(([key]) => key === "charging_enabled"), false);
      strictEqual(stopRequests, 1);
      deepStrictEqual(events, ["safety_trip"]);
      ok(values.get("oscillation_trip_at"));
      ok(values.get("system_alert")?.includes("setting is unchanged"));
    } finally {
      overseer.stop();
    }
  });
}

for (const failure of ["returned", "thrown"]) {
  Deno.test(`a ${failure} STOP failure leaves safety latched and the switch ON`, async () => {
    const values = new Map<string, string>([["charging_enabled", "true"]]);
    const overseer = new Overseer(
      {
        getConfig: (key: string) => Promise.resolve(values.get(key) ?? null),
        setConfig: (key: string, value: string) => {
          values.set(key, value);
          return Promise.resolve();
        },
      } as unknown as ConstructorParameters<typeof Overseer>[0],
      { emit() {} } as unknown as ConstructorParameters<typeof Overseer>[1],
      { info() {}, error() {} } as unknown as ConstructorParameters<
        typeof Overseer
      >[2],
      {
        getState: () => Promise.resolve({ isCharging: true }),
        stopCharging: () =>
          failure === "thrown"
            ? Promise.reject(new Error("vehicle offline"))
            : Promise.resolve({ success: false, error: "vehicle offline" }),
      } as unknown as ConstructorParameters<typeof Overseer>[3],
    );
    try {
      await Reflect.get(overseer, "trip").call(overseer, "V1", "Test car", 2);
      strictEqual(values.get("charging_enabled"), "true");
      strictEqual(values.get("charging_disabled_reason"), "safety_trip");
      ok(values.get("system_alert")?.includes("Emergency STOP failed"));
      ok(values.get("oscillation_trip_at"));
    } finally {
      overseer.stop();
    }
  });
}

for (const mode of ["auto", "vacation"] as const) {
  for (const isCharging of [true, false]) {
    Deno.test(`a safety latch overrides ON and schedules in ${mode}, charging=${isCharging}`, () => {
      const input = makeInput({
        configOverrides: {
          chargingEnabled: true,
          chargingDisabledReason: "safety_trip",
        },
        vehicle: { mode, state: { isCharging, chargeAmps: 10 } },
        schedules: [{
          id: "schedule",
          vehicleId: null,
          scheduleType: "charge",
          startTime: "00:00",
          endTime: "23:59",
          days: [0, 1, 2, 3, 4, 5, 6],
          chargeAmps: 16,
          chargeLimitPct: 100,
          enabled: true,
        }],
      });
      const decision = new ControllerEngine().decide(input).decisions.get("V1");
      strictEqual(decision?.action, isCharging ? "stop" : "none");
      strictEqual(decision?.reason, "safety_trip");
    });
  }
}

Deno.test("the restored manual OFF behavior still stops an automatic charge", () => {
  const decision = new ControllerEngine().decide(makeInput({
    configOverrides: { chargingEnabled: false, chargingDisabledReason: "user" },
    vehicle: { mode: "auto", state: { isCharging: true, chargeAmps: 10 } },
  })).decisions.get("V1");
  strictEqual(decision?.action, "stop");
  strictEqual(decision?.reason, "charging_disabled");
});

Deno.test("explicit STOP is enforced during a safety trip", () => {
  const decision = new ControllerEngine().decide(makeInput({
    configOverrides: { chargingDisabledReason: "safety_trip" },
    vehicle: { mode: "stop", state: { isCharging: true, chargeAmps: 10 } },
  })).decisions.get("V1");
  strictEqual(decision?.action, "stop");
  strictEqual(decision?.reason, "mode_stop");
});

Deno.test("manual Charge Now remains under user control during a latched stop", () => {
  const decision = new ControllerEngine().decide(makeInput({
    configOverrides: { chargingDisabledReason: "safety_trip" },
    vehicle: {
      mode: "charge_now",
      state: { isCharging: true, chargeAmps: 10 },
    },
  })).decisions.get("V1");
  strictEqual(decision?.action, "none");
});

Deno.test("the saved image's direction-based amperage debounce is retained", () => {
  const engine = new ControllerEngine();
  const config = makeInput().config;
  const state = engine.getControlState("V1");
  const vehicleState =
    makeInput({ vehicle: { state: { isCharging: true, chargeAmps: 10 } } })
      .vehicles[0].state;
  ok(vehicleState);
  const debounce = Reflect.get(engine, "debounceAmps").bind(engine);
  const first = debounce(vehicleState, state, config, 11, 1000);
  Object.assign(state, {
    pendingAmps: first.pendingAmps,
    pendingSince: first.pendingSince,
  });
  const second = debounce(vehicleState, state, config, 12, 61000);
  strictEqual(second.pendingSince, 1000);
  Object.assign(state, {
    pendingAmps: second.pendingAmps,
    pendingSince: second.pendingSince,
  });
  strictEqual(debounce(vehicleState, state, config, 11, 181000).amps, 11);
});
