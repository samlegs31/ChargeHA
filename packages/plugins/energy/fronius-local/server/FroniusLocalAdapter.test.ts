import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import {
  FroniusConnectionError,
  FroniusLocalAdapter,
  FroniusParseError,
} from "./FroniusLocalAdapter.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import {
  type FroniusFetchStub,
  installFroniusFetchStub,
} from "./test-helpers/froniusFetchHarness.ts";

describe("FroniusLocalAdapter", () => {
  const testLogger = new Logger("Fronius", "error");
  const makeAdapter = () =>
    new FroniusLocalAdapter("192.168.1.100", 0, testLogger);

  let stub: FroniusFetchStub;

  beforeEach(() => {
    stub = installFroniusFetchStub({ matchBy: "pathContains" });
  });

  afterEach(() => {
    stub.restore();
  });

  describe("pollIntervalSeconds", () => {
    it("is 4 seconds", () => {
      expect(makeAdapter().pollIntervalSeconds()).toBe(4);
    });
  });

  describe("connect", () => {
    it("succeeds when Fronius is reachable", async () => {
      await makeAdapter().connect();
      expect(stub.fetchCalls).toHaveLength(1);
      expect(stub.fetchCalls[0].url).toContain("GetPowerFlowRealtimeData");
    });

    it("throws FroniusConnectionError on non-200 response", async () => {
      stub.setResponse("GetPowerFlowRealtimeData", {
        ok: false,
        status: 500,
        json: {},
      });
      await expect(makeAdapter().connect()).rejects.toBeInstanceOf(
        FroniusConnectionError,
      );
    });

    it("throws FroniusConnectionError when fetch throws", async () => {
      globalThis.fetch = (() => {
        throw new TypeError("fetch failed");
      }) as typeof globalThis.fetch;

      await expect(makeAdapter().connect()).rejects.toBeInstanceOf(
        FroniusConnectionError,
      );
    });
  });

  describe("getRealtimeData", () => {
    it("returns parsed realtime data", async () => {
      const data = await makeAdapter().getRealtimeData();
      expect(data.solarProductionW).toBe(5000);
      expect(data.gridPowerW).toBe(-2000);
      expect(data.homeConsumptionW).toBe(3000);
      expect(data.batteryPowerW).toBeNull();
      expect(data.batterySoc).toBeNull();
    });

    it("throws FroniusParseError on missing Site data", async () => {
      stub.setResponse("GetPowerFlowRealtimeData", {
        ok: true,
        status: 200,
        json: { Body: { Data: {} } },
      });
      await expect(makeAdapter().getRealtimeData()).rejects.toBeInstanceOf(
        FroniusParseError,
      );
    });

    it("caches meter voltage for 60s and falls back on error", async () => {
      using time = new FakeTime(1_000_000);
      const adapter = makeAdapter();
      stub.setResponse("GetMeterRealtimeData", {
        ok: true,
        status: 200,
        json: { Body: { Data: { Voltage_AC_Phase_1: 234.5 } } },
      });

      const first = await adapter.getRealtimeData();
      expect(first.gridVoltageV).toBe(234.5);

      const meterCount = () =>
        stub.fetchCalls.filter((c) => c.url.includes("GetMeterRealtimeData"))
          .length;
      expect(meterCount()).toBe(1);

      // Within 60s window: PowerFlow polls again, meter endpoint is skipped.
      time.tick(30_000);
      const second = await adapter.getRealtimeData();
      expect(second.gridVoltageV).toBe(234.5);
      expect(meterCount()).toBe(1);

      // After 60s window: meter voltage refreshes.
      time.tick(30_000);
      stub.setResponse("GetMeterRealtimeData", {
        ok: true,
        status: 200,
        json: { Body: { Data: { Voltage_AC_Phase_1: 236.2 } } },
      });
      const third = await adapter.getRealtimeData();
      expect(third.gridVoltageV).toBe(236.2);
      expect(meterCount()).toBe(2);

      // Keep cached voltage and back off when refresh fails.
      time.tick(60_000);
      stub.setResponse("GetMeterRealtimeData", {
        ok: false,
        status: 500,
        json: {},
      });
      const fourth = await adapter.getRealtimeData();
      expect(fourth.gridVoltageV).toBe(236.2);
      expect(meterCount()).toBe(3);

      time.tick(10_000);
      const fifth = await adapter.getRealtimeData();
      expect(fifth.gridVoltageV).toBe(236.2);
      expect(meterCount()).toBe(3);
    });
  });

  describe("getDeviceInfo", () => {
    it("returns parsed device info", async () => {
      const info = await makeAdapter().getDeviceInfo();
      expect(info.id).toBe("1");
      expect(info.name).toBe("My Fronius");
      expect(info.manufacturer).toBe("Fronius");
      expect(info.model).toBe("123");
    });
  });
});
