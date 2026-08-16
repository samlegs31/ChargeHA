import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  FroniusCloudAuthError,
  FroniusCloudConnectionError,
  FroniusCloudParseError,
} from "./FroniusCloudAdapter.ts";
import {
  type FetchMock,
  GUEST_ID,
  GUEST_URL,
  makeAdapter,
  RESOLVED_ID,
  setupFetchMock,
} from "./test-helpers/froniusCloudHarness.ts";

describe("FroniusCloudAdapter — Solar.web Guest Link", () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = setupFetchMock();
  });

  afterEach(() => {
    mock.restore();
  });

  describe("error classes", () => {
    const errorCases: Array<[new (msg: string) => Error, string]> = [
      [FroniusCloudConnectionError, "FroniusCloudConnectionError"],
      [FroniusCloudAuthError, "FroniusCloudAuthError"],
      [FroniusCloudParseError, "FroniusCloudParseError"],
    ];

    errorCases.forEach(([ErrorClass, expectedName]) => {
      it(`${expectedName} sets name and message`, () => {
        const err = new ErrorClass("test");
        expect(err.name).toBe(expectedName);
        expect(err.message).toBe("test");
      });
    });
  });

  it("polls Solar.web every 30 seconds", () => {
    expect(makeAdapter().pollIntervalSeconds()).toBe(30);
  });

  describe("guest session", () => {
    it("opens GuestLogOn, follows the PV-system redirect and reads ActualData", async () => {
      await makeAdapter().connect();

      const guestCall = mock.fetchCalls.find((call) =>
        call.url.includes("/Home/GuestLogOn")
      );
      assertExists(guestCall);
      expect(guestCall.url).toContain(`pvSystemId=${GUEST_ID}`);
      expect(guestCall.method).toBe("GET");
      expect(guestCall.redirect).toBe("manual");

      const pvPageCall = mock.fetchCalls.find((call) =>
        call.url.includes("/PvSystems/PvSystem")
      );
      assertExists(pvPageCall);
      expect(pvPageCall.url).toContain(`pvSystemId=${RESOLVED_ID}`);
      expect(pvPageCall.headers.cookie).toContain(".AspNet.Auth=guest-auth");

      const dataCall = mock.fetchCalls.find((call) =>
        call.url.includes("/ActualData/GetCompareDataForPvSystem")
      );
      assertExists(dataCall);
      expect(dataCall.url).toContain(`pvSystemId=${RESOLVED_ID}`);
      expect(dataCall.headers.cookie).toContain(".AspNet.Auth=guest-auth");
      expect(dataCall.headers["x-requested-with"]).toBe("XMLHttpRequest");
    });

    it("never sends Solar.web email/password or SWQAPI access-key headers", async () => {
      await makeAdapter().connect();

      for (const call of mock.fetchCalls) {
        expect(call.url.includes("/iam/jwt")).toBe(false);
        expect(call.headers.authorization).toBeUndefined();
        expect(call.headers.accesskeyid).toBeUndefined();
        expect(call.headers.accesskeyvalue).toBeUndefined();
      }
    });

    it("rejects links that are not Solar.web GuestLogOn links", async () => {
      const adapter = makeAdapter({
        guestUrl: "https://example.com/Home/GuestLogOn?pvSystemId=" + GUEST_ID,
      });

      await expect(adapter.connect()).rejects.toThrow(/Invalid Solar\.web guest link/);
      expect(mock.fetchCalls.length).toBe(0);
    });

    it("rejects a guest link without a valid pvSystemId", async () => {
      const adapter = makeAdapter({
        guestUrl: "https://www.solarweb.com/Home/GuestLogOn?pvSystemId=bad-id",
      });

      await expect(adapter.connect()).rejects.toThrow(/pvSystemId/);
    });

    it("re-opens the guest link when the Solar.web session expires", async () => {
      const adapter = makeAdapter();
      await adapter.connect();

      // Both candidate IDs fail once, forcing a fresh GuestLogOn session.
      mock.queueActualDataResponse({
        status: 302,
        headers: { Location: "/Account/Login" },
      });
      mock.queueActualDataResponse({
        status: 302,
        headers: { Location: "/Account/Login" },
      });

      await adapter.getRealtimeData();

      const guestCalls = mock.fetchCalls.filter((call) =>
        call.url.includes("/Home/GuestLogOn")
      );
      expect(guestCalls.length).toBe(2);
    });
  });

  describe("getRealtimeData", () => {
    it("maps Solar.web P_PV, P_Grid, P_Load, P_Akku and SOC", async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      const data = await adapter.getRealtimeData();

      expect(data.solarProductionW).toBe(3500);
      expect(data.gridPowerW).toBe(-200);
      expect(data.homeConsumptionW).toBe(3300);
      expect(data.batteryPowerW).toBe(500);
      expect(data.batterySoc).toBe(75);
      expect(data.gridVoltageV).toBeNull();
    });

    it("uses StateOfCharge_Relative when Solar.web does not expose SOC", async () => {
      mock.setActualDataResponse({
        status: 200,
        json: {
          P_PV: 2100,
          P_Grid: 100,
          P_Load: -1800,
          P_Akku: -400,
          StateOfCharge_Relative: 82,
          IsOnline: true,
        },
      });

      const adapter = makeAdapter();
      await adapter.connect();
      const data = await adapter.getRealtimeData();
      expect(data.batterySoc).toBe(82);
      expect(data.batteryPowerW).toBe(-400);
    });

    it("returns safe zero values when Solar.web reports the system offline", async () => {
      mock.setActualDataResponse({
        status: 200,
        json: {
          P_PV: 0,
          P_Grid: 0,
          P_Load: 0,
          P_Akku: null,
          SOC: 65,
          IsOnline: false,
        },
      });

      const adapter = makeAdapter();
      await adapter.connect();
      const data = await adapter.getRealtimeData();

      expect(data.solarProductionW).toBe(0);
      expect(data.gridPowerW).toBe(0);
      expect(data.homeConsumptionW).toBe(0);
      expect(data.batteryPowerW).toBeNull();
      expect(data.batterySoc).toBeNull();
    });

    it("fails connection when the guest page does not expose realtime power data", async () => {
      mock.setActualDataResponse({
        status: 200,
        json: { IsOnline: true, Name: "PV system" },
      });

      await expect(makeAdapter().connect()).rejects.toBeInstanceOf(
        FroniusCloudParseError,
      );
    });
  });

  describe("lifecycle and device info", () => {
    it("re-opens GuestLogOn after disconnect", async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      await adapter.disconnect();

      const before = mock.fetchCalls.filter((call) =>
        call.url.includes("/Home/GuestLogOn")
      ).length;

      await adapter.getRealtimeData();

      const after = mock.fetchCalls.filter((call) =>
        call.url.includes("/Home/GuestLogOn")
      ).length;
      expect(after).toBe(before + 1);
    });

    it("returns a read-only Solar.web device identity", async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      const info = await adapter.getDeviceInfo();

      expect(info.id).toBe(RESOLVED_ID);
      expect(info.name).toBe("Fronius Solar.web Guest");
      expect(info.manufacturer).toBe("Fronius");
      expect(info.model).toBe("Solar.web Guest");
    });
  });

  it("accepts the exact GuestLogOn URL format shown by Solar.web", async () => {
    const adapter = makeAdapter({ guestUrl: GUEST_URL });
    await expect(adapter.connect()).resolves.toBeUndefined();
  });
});
