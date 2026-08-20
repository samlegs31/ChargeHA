import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  fetchChargingHistory,
  type ChargingHistoryTokenProvider,
} from "./ChargingHistory.ts";

describe("ChargingHistory", () => {
  function provider(): ChargingHistoryTokenProvider {
    return {
      getAccessToken: () => Promise.resolve("token"),
      getFleetApiBaseUrl: () => Promise.resolve("https://fleet.example"),
    };
  }

  it("filters the archive by VIN and builds external charge intervals", async () => {
    const requestedUrls: string[] = [];
    const fetchFn = ((input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({
        response: {
          data: [
            {
              vin: "VIN_EDITH",
              chargeSessionId: "session-edith",
              chargeStartDateTime: "2026-08-10T10:00:00+02:00",
              chargeStopDateTime: "2026-08-10T10:30:00+02:00",
              energyAdded: 6,
            },
            {
              vin: "VIN_FRIDAY",
              chargeSessionId: "session-friday",
              chargeStartDateTime: "2026-08-10T11:00:00+02:00",
              chargeStopDateTime: "2026-08-10T11:30:00+02:00",
              energyAdded: 10,
            },
          ],
          totalResults: 2,
          pageSize: 25,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }) as typeof globalThis.fetch;

    const archive = await fetchChargingHistory(provider(), {
      vin: "VIN_EDITH",
      from: "2026-08-01",
      to: "2026-08-19",
    }, fetchFn);

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("vin=VIN_EDITH");
    expect(requestedUrls[0]).toContain("pageSize=25");
    expect(archive.pagesRead).toBe(1);
    expect(archive.sessionsRead).toBe(2);
    expect(archive.sessionsMatched).toBe(1);
    expect(archive.sessionsSkipped).toBe(1);
    expect(archive.rows).toHaveLength(2);
    expect(Math.round(archive.chargedWh)).toBe(6000);
    expect(archive.rows.every((row) => row.source === "vehicle-history")).toBe(true);
    expect(archive.rows.every((row) => row.awayWh === row.chargedWh)).toBe(true);
    expect(archive.rows.every((row) => row.atHomeWh === 0)).toBe(true);
    expect(archive.rows[0]?.startTimeUtc).toBe("2026-08-10 08:00:00");
    expect(archive.rows[0]?.startTimeLocal).toBe("2026-08-10 10:00:00");
  });

  it("falls back when the filtered query is rejected", async () => {
    const urls: string[] = [];
    const fetchFn = ((input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("startTime=")) {
        return Promise.resolve(new Response("unsupported query", { status: 422 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        response: {
          data: [{
            chargeSessionId: "session-edith",
            chargeStartDateTime: "2026-08-10T10:00:00Z",
            chargeStopDateTime: "2026-08-10T10:15:00Z",
            energyAdded: 2,
          }],
          totalResults: 1,
          pageSize: 25,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }) as typeof globalThis.fetch;

    const archive = await fetchChargingHistory(provider(), {
      vin: "VIN_EDITH",
      from: "2026-08-01",
      to: "2026-08-19",
    }, fetchFn);

    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("vin=VIN_EDITH");
    expect(urls[1]).toContain("pageSize=25");
    expect(archive.sessionsMatched).toBe(1);
    expect(archive.rows).toHaveLength(1);
    expect(Math.round(archive.chargedWh)).toBe(2000);
  });

  it("keeps VIN attribution when Tesla omits VIN from filtered records", async () => {
    const requests: Array<{ url: string; contentType: string | null }> = [];
    const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        contentType: headers.get("Content-Type"),
      });
      return Promise.resolve(new Response(JSON.stringify({
        response: {
          data: [{
            chargeSessionId: "session-edith",
            chargeStartDateTime: "2026-08-18T12:00:00+02:00",
            chargeStopDateTime: "2026-08-18T12:30:00+02:00",
            energyAdded: 3.5,
          }],
          totalResults: 1,
          pageSize: 25,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }) as typeof globalThis.fetch;

    const archive = await fetchChargingHistory(provider(), {
      vin: "VIN_EDITH",
      from: "2026-08-18",
      to: "2026-08-19",
    }, fetchFn);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("vin=VIN_EDITH");
    expect(requests[0]?.url).toContain("pageSize=25");
    expect(requests[0]?.contentType).toBe("application/json");
    expect(archive.sessionsRead).toBe(1);
    expect(archive.sessionsMatched).toBe(1);
    expect(archive.rows.length).toBeGreaterThan(0);
    expect(Math.round(archive.chargedWh)).toBe(3500);
    expect(archive.truncated).toBe(false);
  });
});
