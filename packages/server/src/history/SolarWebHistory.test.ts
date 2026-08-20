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

  it("authenticates once and reads daily Wattpilot aggregates", async () => {
    const calls: string[] = [];
    const fetchFn = (input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      calls.push(url);
      if (url.includes("/iam/jwt")) {
        return Promise.resolve(jsonResponse({ jwtToken: "token" }));
      }
      return Promise.resolve(jsonResponse({
        data: [{
          logDate: "2026-08-01",
          channels: [
            { channelName: "EnergyEVCCharge", value: 1000 },
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
      to: "2026-08-03",
    }, fetchFn);

    expect(calls).toHaveLength(2);
    const historyUrl = new URL(calls[1]);
    expect(historyUrl.pathname).toContain("/pvsystems/pv-system-1/aggrdata");
    expect(historyUrl.searchParams.get("from")).toBe("2026-08-01");
    expect(historyUrl.searchParams.get("to")).toBe("2026-08-03");
    expect(historyUrl.searchParams.get("channel")).toBe(
      "EnergyEVCCharge,EnergyEVCChargeBatt,EnergyEVCChargeGrid",
    );
    expect(historyUrl.searchParams.has("timezone")).toBe(false);

    expect(result.samplesRead).toBe(1);
    expect(result.chargedWh).toBe(1000);
    expect(result.solarWh).toBe(500);
    expect(result.batteryWh).toBe(100);
    expect(result.gridWh).toBe(400);
    expect(result.rows).toEqual([{
      source: "solarweb",
      externalId: "pv-system-1:wattpilot-day:2026-08-01",
      startTimeUtc: "2026-08-01 12:00:00",
      startTimeLocal: "2026-08-01 12:00:00",
      intervalSeconds: 1,
      chargedWh: 1000,
      solarWh: 500,
      batteryWh: 100,
      gridWh: 400,
      awayWh: 0,
      atHomeWh: 1000,
    }]);
  });

  it("accepts an ISO logDateTime returned by Solar.web aggregates", async () => {
    const fetchFn = (input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/iam/jwt")) {
        return Promise.resolve(jsonResponse({ accessToken: "token" }));
      }
      return Promise.resolve(jsonResponse({
        data: [{
          logDateTime: "2026-08-02T00:00:00+02:00",
          channels: [{ channelName: "EnergyEVCCharge", value: 2500 }],
        }],
      }));
    };

    const result = await fetchSolarWebHomeEvHistory({
      email: "user@example.com",
      password: "secret",
      pvSystemId: "pv-system-1",
      from: "2026-08-02",
      to: "2026-08-02",
    }, fetchFn);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.startTimeLocal).toBe("2026-08-02 12:00:00");
    expect(result.rows[0]?.solarWh).toBe(2500);
  });

  it("conserves total energy across solar, battery and grid", async () => {
    const fetchFn = (input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/iam/jwt")) {
        return Promise.resolve(jsonResponse({ jwtToken: "token" }));
      }
      return Promise.resolve(jsonResponse({
        data: [
          {
            logDate: "2026-08-01",
            channels: [
              { channelName: "EnergyEVCCharge", value: 1000 },
              { channelName: "EnergyEVCChargeGrid", value: 1000 },
            ],
          },
          {
            logDate: "2026-08-02",
            channels: [
              { channelName: "EnergyEVCCharge", value: 1000 },
            ],
          },
          {
            logDate: "2026-08-03",
            channels: [
              { channelName: "EnergyEVCCharge", value: 1000 },
              { channelName: "EnergyEVCChargeBatt", value: 200 },
              { channelName: "EnergyEVCChargeGrid", value: 300 },
            ],
          },
        ],
      }));
    };

    const result = await fetchSolarWebHomeEvHistory({
      email: "user@example.com",
      password: "secret",
      pvSystemId: "pv-system-1",
      from: "2026-08-01",
      to: "2026-08-03",
    }, fetchFn);

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({
      chargedWh: 1000,
      solarWh: 0,
      batteryWh: 0,
      gridWh: 1000,
    });
    expect(result.rows[1]).toMatchObject({
      chargedWh: 1000,
      solarWh: 1000,
      batteryWh: 0,
      gridWh: 0,
    });
    expect(result.rows[2]).toMatchObject({
      chargedWh: 1000,
      solarWh: 500,
      batteryWh: 200,
      gridWh: 300,
    });
    result.rows.forEach((row) => {
      expect(row.solarWh + row.batteryWh + row.gridWh).toBe(row.chargedWh);
    });
  });

  it("normalizes inconsistent source components without exceeding total", async () => {
    const fetchFn = (input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/iam/jwt")) {
        return Promise.resolve(jsonResponse({ jwtToken: "token" }));
      }
      return Promise.resolve(jsonResponse({
        data: [{
          logDate: "2026-08-01",
          channels: [
            { channelName: "EnergyEVCCharge", value: 1000 },
            { channelName: "EnergyEVCChargeBatt", value: 800 },
            { channelName: "EnergyEVCChargeGrid", value: 800 },
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

    expect(result.rows[0]).toMatchObject({
      chargedWh: 1000,
      solarWh: 0,
      batteryWh: 500,
      gridWh: 500,
    });
  });

  it("uses known battery and grid energy when total channel is missing", async () => {
    const fetchFn = (input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/iam/jwt")) {
        return Promise.resolve(jsonResponse({ jwtToken: "token" }));
      }
      return Promise.resolve(jsonResponse({
        data: [{
          logDate: "2026-08-01",
          channels: [
            { channelName: "EnergyEVCChargeBatt", value: 200 },
            { channelName: "EnergyEVCChargeGrid", value: 300 },
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

    expect(result.rows[0]).toMatchObject({
      chargedWh: 500,
      solarWh: 0,
      batteryWh: 200,
      gridWh: 300,
    });
  });

  it("filters zero-energy and out-of-range aggregate rows", async () => {
    const fetchFn = (input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/iam/jwt")) {
        return Promise.resolve(jsonResponse({ accessToken: "token" }));
      }
      return Promise.resolve(jsonResponse({
        data: [
          {
            logDate: "2026-07-31",
            channels: [{ channelName: "EnergyEVCChargeGrid", value: 500 }],
          },
          {
            logDate: "2026-08-01",
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

    expect(result.samplesRead).toBe(2);
    expect(result.rows).toEqual([]);
    expect(result.chargedWh).toBe(0);
  });

  it("retries a rate-limited Solar.web login", async () => {
    let loginCalls = 0;
    const fetchFn = (input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/iam/jwt")) {
        loginCalls += 1;
        if (loginCalls === 1) {
          return Promise.resolve(jsonResponse({
            responseError: 1011,
            responseMessage:
              "API calls quota exceeded. Maximum admitted 10 per 1m. Retry after: 0",
          }, 429));
        }
        return Promise.resolve(jsonResponse({ jwtToken: "token" }));
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    };

    const result = await fetchSolarWebHomeEvHistory({
      email: "user@example.com",
      password: "secret",
      pvSystemId: "pv-system-1",
      from: "2026-08-01",
      to: "2026-08-01",
    }, fetchFn);

    expect(loginCalls).toBe(2);
    expect(result.rows).toEqual([]);
  });

  it("retries a rate-limited aggregate request and resumes the import", async () => {
    let aggregateCalls = 0;
    const fetchFn = (input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/iam/jwt")) {
        return Promise.resolve(jsonResponse({ accessToken: "token" }));
      }

      aggregateCalls += 1;
      if (aggregateCalls === 1) {
        return Promise.resolve(jsonResponse({
          responseError: 1011,
          responseMessage:
            "API calls quota exceeded. Maximum admitted 10 per 1m. Retry after: 0",
        }, 429));
      }
      return Promise.resolve(jsonResponse({
        data: [{
          logDate: "2026-08-01",
          channels: [{ channelName: "EnergyEVCCharge", value: 1200 }],
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

    expect(aggregateCalls).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.chargedWh).toBe(1200);
  });
});
