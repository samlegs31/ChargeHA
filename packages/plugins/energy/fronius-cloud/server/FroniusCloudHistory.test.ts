import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { fetchFroniusCloudEvHistory } from "./FroniusCloudHistory.ts";
import {
  type FetchMock,
  makeAdapter,
  setupFetchMock,
} from "./test-helpers/froniusCloudHarness.ts";

describe("FroniusCloudHistory", () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = setupFetchMock();
  });

  afterEach(() => {
    mock.restore();
  });

  it("maps Wattpilot solar, battery and grid Wh into an archive row", async () => {
    mock.setPathResponse("/histdata?", {
      ok: true,
      status: 200,
      json: {
        data: [
          {
            logDateTime: "2026-08-01T12:00:00+02:00",
            logDuration: 300,
            channels: [
              { channelName: "EnergyEVCCharge", value: 500 },
              { channelName: "EnergyEVCChargeBatt", value: 100 },
              { channelName: "EnergyEVCChargeGrid", value: 400 },
            ],
          },
          {
            logDateTime: "2026-08-01T12:05:00+02:00",
            logDuration: 300,
            channels: [
              { channelName: "EnergyEVCCharge", value: 0 },
              { channelName: "EnergyEVCChargeBatt", value: 0 },
              { channelName: "EnergyEVCChargeGrid", value: 0 },
            ],
          },
        ],
      },
    });

    const result = await fetchFroniusCloudEvHistory(
      makeAdapter(),
      "pv-system-1",
      "2026-08-01T00:00:00Z",
      "2026-08-02T00:00:00Z",
    );

    expect(result.samplesRead).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.chargedWh).toBe(1000);
    expect(result.solarWh).toBe(500);
    expect(result.batteryWh).toBe(100);
    expect(result.gridWh).toBe(400);
    expect(result.rows[0]).toEqual({
      source: "solarweb",
      externalId: "pv-system-1:2026-08-01T12:00:00+02:00",
      startTimeUtc: "2026-08-01 10:00:00",
      startTimeLocal: "2026-08-01 12:00:00",
      intervalSeconds: 300,
      chargedWh: 1000,
      solarWh: 500,
      batteryWh: 100,
      gridWh: 400,
      awayWh: 0,
      atHomeWh: 1000,
    });
  });

  it("requests only the three Wattpilot source channels", async () => {
    mock.setPathResponse("/histdata?", {
      ok: true,
      status: 200,
      json: { data: [] },
    });

    await fetchFroniusCloudEvHistory(
      makeAdapter(),
      "pv-system-1",
      "2026-01-01T00:00:00Z",
      "2026-01-02T00:00:00Z",
    );

    const historyCall = mock.fetchCalls.find((call) =>
      call.url.includes("/histdata?")
    );
    assertExists(historyCall);
    const url = new URL(historyCall.url);
    expect(url.searchParams.get("channel")).toBe(
      "EnergyEVCCharge,EnergyEVCChargeBatt,EnergyEVCChargeGrid",
    );
    expect(url.searchParams.get("timezone")).toBe("local");
    expect(url.searchParams.get("limit")).toBe("1000");
  });
});
