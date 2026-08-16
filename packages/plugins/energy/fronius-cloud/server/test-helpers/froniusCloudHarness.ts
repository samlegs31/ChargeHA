import { FroniusCloudAdapter } from "../FroniusCloudAdapter.ts";
import { Logger } from "@chargeha/server/lib/Logger";

export const GUEST_ID = "26e74e4e-57be-4c96-90e5-a9e79fcc9cff";
export const RESOLVED_ID = "dcc0acdf-80d4-4348-85ac-d67015fa8c44";
export const GUEST_URL =
  `https://www.solarweb.com/Home/GuestLogOn?pvSystemId=${GUEST_ID}`;

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  redirect?: RequestRedirect;
}

export interface MockResp {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string | string[]>;
}

export interface FetchMock {
  fetchCalls: FetchCall[];
  setGuestResponse(resp: MockResp): void;
  setPvPageResponse(resp: MockResp): void;
  setActualDataResponse(resp: MockResp): void;
  queueActualDataResponse(resp: MockResp): void;
  restore(): void;
}

export const testLogger = new Logger("FroniusCloud", "error");

const DEFAULT_ACTUAL_DATA = {
  P_PV: 3500,
  P_Grid: -200,
  P_Load: -3300,
  P_Akku: 500,
  SOC: 75,
  IsOnline: true,
};

const extractUrl = (input: string | URL | Request): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

const normalizeHeaders = (headers?: HeadersInit): Record<string, string> => {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
};

const flattenHeaderEntries = (
  headers?: Record<string, string | string[]>,
): Array<[string, string]> =>
  Object.entries(headers ?? {}).flatMap(([name, value]) =>
    Array.isArray(value)
      ? value.map((item) => [name, item] as [string, string])
      : [[name, value]]
  );

const buildResponse = (resp: MockResp): Response => {
  const headers = new Headers(flattenHeaderEntries(resp.headers));

  if (resp.json !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (resp.text !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "text/html; charset=utf-8");
  }

  const body = resp.json !== undefined
    ? JSON.stringify(resp.json)
    : resp.text ?? null;

  return new Response(body, { status: resp.status, headers });
};

export const setupFetchMock = (): FetchMock => {
  const fetchCalls: FetchCall[] = [];
  const actualDataQueue: MockResp[] = [];
  const state: {
    guestResponse?: MockResp;
    pvPageResponse?: MockResp;
    actualDataResponse?: MockResp;
  } = {};

  const originalFetch = globalThis.fetch;

  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = extractUrl(input);
    const headers = normalizeHeaders(init?.headers);

    fetchCalls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      redirect: init?.redirect,
    });

    if (url.includes("/Home/GuestLogOn")) {
      return Promise.resolve(buildResponse(
        state.guestResponse ?? {
          status: 302,
          headers: {
            "Location": `/PvSystems/PvSystem?pvSystemId=${RESOLVED_ID}`,
            "Set-Cookie": [
              ".AspNet.Auth=guest-auth; Path=/; HttpOnly",
              "Culture=en-US; Path=/",
            ],
          },
        },
      ));
    }

    if (url.includes("/PvSystems/PvSystem")) {
      return Promise.resolve(buildResponse(
        state.pvPageResponse ?? {
          status: 200,
          text: `<html><body data-pv-system-id="${RESOLVED_ID}"></body></html>`,
          headers: {
            "Set-Cookie": "TimeFormat=HH:mm; Path=/",
          },
        },
      ));
    }

    if (url.includes("/ActualData/GetCompareDataForPvSystem")) {
      const queued = actualDataQueue.shift();
      return Promise.resolve(buildResponse(
        queued ?? state.actualDataResponse ?? {
          status: 200,
          json: DEFAULT_ACTUAL_DATA,
        },
      ));
    }

    return Promise.resolve(new Response("Not Found", { status: 404 }));
  }) as typeof globalThis.fetch;

  return {
    fetchCalls,
    setGuestResponse: (resp) => {
      state.guestResponse = resp;
    },
    setPvPageResponse: (resp) => {
      state.pvPageResponse = resp;
    },
    setActualDataResponse: (resp) => {
      state.actualDataResponse = resp;
    },
    queueActualDataResponse: (resp) => {
      actualDataQueue.push(resp);
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

export const makeAdapter = (
  overrides: Partial<{
    guestUrl: string;
    logger: Logger;
  }> = {},
): FroniusCloudAdapter =>
  new FroniusCloudAdapter(
    overrides.guestUrl ?? GUEST_URL,
    overrides.logger ?? testLogger,
  );
