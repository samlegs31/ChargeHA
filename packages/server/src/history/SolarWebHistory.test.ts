import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { fetchSolarWebHomeEvHistory } from "./SolarWebHistory.ts";

describe("fetchSolarWebHomeEvHistory", () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function requestUrl(input: string | URL | Request): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  }

  it("authenticates once and maps Wattpilot home energy", async () => {
    const calls: string[] = [];
    const fetchFn = (input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      calls.push(url);
      if (url.includes("/iam/jwt")) {
        return Promise.resolve(jsonResponse({ jwtToken: "token" }));
      }
      return Promise.resolve(jsonResponse({
        data: [{
          logDateTime: "2026-08-01T12:00:00+02:00",
          logDuration: 300,
          channels: [
            { channelName: "EnergyEVCCharge", value: 500 },
            { channelName: "EnergyEVCChargeBatt", value: 100 },
            { channelName: "EnergyEVCChargeGrid", value: 400 },
          ],
        }],
      }));
    };

    const result = await fetchSolarWebHomeEvHistory({
      email: "user@example.com",
      password: "secret",
      pvSystemId: "pv-system-1",
      from: "2026-08-01",
      to: "2026-08-01",
    }, fetchFn);

    expect(calls).toHaveLength(2);
    expect(result.samplesRead).toBe(1);
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

    const historyUrl = new URL(calls[1]);
    expect(historyUrl.searchParams.get("channel")).toBe(
      "EnergyEVCCharge,EnergyEVCChargeBatt,EnergyEVCChargeGrid",
    );
    expect(historyUrl.searchParams.get("timezone")).toBe("local");
    expect(historyUrl.searchParams.get("limit")).toBe("1000");
  });

  it("filters zero-energy and out-of-range samples", async () => {
    const fetchFn = (input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/iam/jwt")) {
        return Promise.resolve(jsonResponse({ accessToken: "token" }));
      }
      return Promise.resolve(jsonResponse({
        data: [
          {
            logDateTime: "2026-07-31T23:55:00+02:00",
            channels: [{ channelName: "EnergyEVCChargeGrid", value: 500 }],
          },
          {
            logDateTime: "2026-08-01T10:00:00+02:00",
            channels: [{ channelName: "EnergyEVCChargeGrid", value: 0 }],
          },
        ],
      }));
    };

    const result = await fetchSolarWebHomeEvHistory({
      email: "user@example.com",
      password: "secret",
      pvSystemId: "pv-system-1",
      from: "2026-08-01",
      to: "2026-08-01",
    }, fetchFn);

    expect(result.rows).toEqual([]);
    expect(result.chargedWh).toBe(0);
  });
});
