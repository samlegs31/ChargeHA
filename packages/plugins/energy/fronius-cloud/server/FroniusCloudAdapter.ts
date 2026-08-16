import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";

const SOLAR_WEB_ORIGIN = "https://www.solarweb.com";
const GUEST_PATH = "/Home/GuestLogOn";
const ACTUAL_DATA_PATH = "/ActualData/GetCompareDataForPvSystem";
const MAX_REDIRECTS = 8;
const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class FroniusCloudConnectionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "FroniusCloudConnectionError";
  }
}

/** Kept for compatibility with older callers; guest-link mode no longer logs in. */
export class FroniusCloudAuthError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "FroniusCloudAuthError";
  }
}

export class FroniusCloudParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FroniusCloudParseError";
  }
}

type JsonObject = Record<string, unknown>;

const isSolarWebHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return host === "solarweb.com" || host === "www.solarweb.com";
};

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const asObject = (value: unknown): JsonObject | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;

const firstFiniteNumber = (...values: unknown[]): number | null =>
  values.map(asFiniteNumber).find((value) => value !== null) ?? null;

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export class FroniusCloudAdapter implements EnergySourceAdapter {
  pollIntervalSeconds(): number {
    // Solar.web's dashboard data is updated on a cloud cadence; 30 s avoids
    // unnecessary polling while remaining responsive enough for solar charging.
    return 30;
  }

  private readonly guestUrl: string;
  private readonly logger: Logger;
  private guestPvSystemId: string | null = null;
  private resolvedPvSystemId: string | null = null;
  private readonly cookies = new Map<string, string>();
  private lastActualData: JsonObject | null = null;

  constructor(guestUrl: string, logger: Logger) {
    this.guestUrl = guestUrl.trim();
    this.logger = logger;
  }

  async connect(): Promise<void> {
    await this.establishGuestSession();
    const data = await this.fetchActualData(false);

    if (
      asFiniteNumber(data.P_PV) === null &&
      asFiniteNumber(data.P_Grid) === null &&
      asFiniteNumber(data.P_Load) === null
    ) {
      throw new FroniusCloudParseError(
        "Solar.web guest access opened, but realtime power data was not found",
      );
    }

    this.lastActualData = data;
    this.logger.info(
      `Connected to Solar.web guest system ${this.activePvSystemId()}`,
    );
  }

  disconnect(): Promise<void> {
    this.cookies.clear();
    this.guestPvSystemId = null;
    this.resolvedPvSystemId = null;
    this.lastActualData = null;
    return Promise.resolve();
  }

  async getRealtimeData(): Promise<EnergyData> {
    const data = await this.fetchActualData(true);
    this.lastActualData = data;

    const isOnline = data.IsOnline;
    const allOnline = data.AllOnline;
    if (isOnline === false || allOnline === false) {
      return {
        solarProductionW: 0,
        gridPowerW: 0,
        homeConsumptionW: 0,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: new Date().toISOString(),
      };
    }

    const battery = asObject(data.Battery);
    const batInfo = asObject(data.BatInfo);

    return {
      solarProductionW: asFiniteNumber(data.P_PV) ?? 0,
      gridPowerW: asFiniteNumber(data.P_Grid) ?? 0,
      homeConsumptionW: Math.abs(asFiniteNumber(data.P_Load) ?? 0),
      batteryPowerW: asFiniteNumber(data.P_Akku),
      batterySoc: firstFiniteNumber(
        data.SOC,
        data.StateOfCharge_Relative,
        data.BatterySOC,
        data.BatterySoc,
        battery?.SOC,
        battery?.StateOfCharge_Relative,
        batInfo?.SOC,
        batInfo?.StateOfCharge_Relative,
      ),
      gridVoltageV: null,
      lastUpdated: new Date().toISOString(),
    };
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    if (!this.guestPvSystemId) {
      await this.establishGuestSession();
    }
    if (!this.lastActualData) {
      this.lastActualData = await this.fetchActualData(true);
    }

    const data = this.lastActualData;
    const systemName = [data.PvSystemName, data.SystemName, data.Name]
      .find((value) => typeof value === "string" && value.trim() !== "");
    const model = [data.InverterModel, data.Model]
      .find((value) => typeof value === "string" && value.trim() !== "");

    return {
      id: this.activePvSystemId(),
      name: typeof systemName === "string"
        ? systemName
        : "Fronius Solar.web Guest",
      manufacturer: "Fronius",
      model: typeof model === "string" ? model : "Solar.web Guest",
    };
  }

  private parseGuestUrl(): { normalizedUrl: string; guestId: string } {
    const parsed = this.parseGuestUrlValue();

    if (
      parsed.protocol !== "https:" ||
      !isSolarWebHost(parsed.hostname) ||
      parsed.pathname.replace(/\/$/, "").toLowerCase() !==
        GUEST_PATH.toLowerCase()
    ) {
      throw new FroniusCloudConnectionError(
        "Invalid Solar.web guest link. Expected https://www.solarweb.com/Home/GuestLogOn?pvSystemId=...",
      );
    }

    const guestId = parsed.searchParams.get("pvSystemId") ?? "";
    if (!UUID_RE.test(guestId)) {
      throw new FroniusCloudConnectionError(
        "Invalid Solar.web guest link: pvSystemId is missing or invalid",
      );
    }

    const normalized = new URL(GUEST_PATH, SOLAR_WEB_ORIGIN);
    normalized.searchParams.set("pvSystemId", guestId);
    return { normalizedUrl: normalized.toString(), guestId };
  }

  private parseGuestUrlValue(): URL {
    try {
      return new URL(this.guestUrl);
    } catch (error) {
      throw new FroniusCloudConnectionError(
        "Invalid Solar.web guest link. Paste the full GuestLogOn URL from Solar.web Settings → Permissions.",
        asError(error),
      );
    }
  }

  private async establishGuestSession(): Promise<void> {
    const { normalizedUrl, guestId } = this.parseGuestUrl();
    this.guestPvSystemId = guestId;
    this.resolvedPvSystemId = null;
    this.cookies.clear();

    const response = await this.followGuestRedirects(
      new URL(normalizedUrl),
      MAX_REDIRECTS,
    );
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      const html = await response.text();
      this.captureResolvedPvSystemIdFromHtml(html);
    }
  }

  private async followGuestRedirects(
    currentUrl: URL,
    redirectsRemaining: number,
  ): Promise<Response> {
    const response = await this.requestGuestPage(currentUrl);
    this.storeResponseCookies(response.headers);
    this.captureResolvedPvSystemId(currentUrl);

    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400 &&
      location !== null;

    if (isRedirect) {
      if (redirectsRemaining <= 0) {
        throw new FroniusCloudConnectionError(
          "Solar.web guest link redirected too many times",
        );
      }

      const nextUrl = new URL(location, currentUrl);
      if (!isSolarWebHost(nextUrl.hostname)) {
        throw new FroniusCloudConnectionError(
          `Solar.web guest link redirected to an unexpected host: ${nextUrl.hostname}`,
        );
      }
      this.captureResolvedPvSystemId(nextUrl);
      return await this.followGuestRedirects(nextUrl, redirectsRemaining - 1);
    }

    if (!response.ok) {
      throw new FroniusCloudConnectionError(
        `Solar.web guest link returned HTTP ${response.status}`,
      );
    }

    return response;
  }

  private async requestGuestPage(url: URL): Promise<Response> {
    try {
      return await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: this.browserHeaders(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new FroniusCloudConnectionError(
        "Unable to open the Solar.web guest link",
        asError(error),
      );
    }
  }

  private captureResolvedPvSystemId(url: URL): void {
    const path = url.pathname.replace(/\/$/, "").toLowerCase();
    if (path !== "/pvsystems/pvsystem") return;

    const id = url.searchParams.get("pvSystemId");
    if (id && UUID_RE.test(id)) this.resolvedPvSystemId = id;
  }

  private captureResolvedPvSystemIdFromHtml(html: string): void {
    const match = html.match(
      /\/PvSystems\/PvSystem\?pvSystemId=([0-9a-f-]{36})/i,
    );
    const id = match?.[1];
    if (id && UUID_RE.test(id)) this.resolvedPvSystemId = id;
  }

  private activePvSystemId(): string {
    const id = this.resolvedPvSystemId ?? this.guestPvSystemId;
    if (!id) {
      throw new FroniusCloudConnectionError(
        "Solar.web guest session has not been initialized",
      );
    }
    return id;
  }

  private candidatePvSystemIds(): string[] {
    const ids = [this.resolvedPvSystemId, this.guestPvSystemId]
      .filter((id): id is string => !!id);
    return [...new Set(ids)];
  }

  private async fetchActualData(
    allowSessionRefresh: boolean,
  ): Promise<JsonObject> {
    if (!this.guestPvSystemId) await this.establishGuestSession();

    try {
      return await this.fetchActualDataFromCandidates(
        this.candidatePvSystemIds(),
      );
    } catch (error) {
      if (allowSessionRefresh) {
        await this.establishGuestSession();
        return await this.fetchActualData(false);
      }
      if (error instanceof FroniusCloudConnectionError) throw error;
      throw new FroniusCloudConnectionError(
        "Unable to read realtime data from the Solar.web guest link",
        asError(error),
      );
    }
  }

  private async fetchActualDataFromCandidates(
    candidates: string[],
  ): Promise<JsonObject> {
    const [pvSystemId, ...remaining] = candidates;
    if (!pvSystemId) {
      throw new FroniusCloudConnectionError(
        "Unable to read realtime data from the Solar.web guest link",
      );
    }

    try {
      const data = await this.fetchActualDataForId(pvSystemId);
      // The guest-link UUID itself is accepted by some Solar.web versions;
      // other versions redirect to the internal PV system UUID. Remember
      // whichever identifier actually returned realtime data.
      this.resolvedPvSystemId = pvSystemId;
      return data;
    } catch (error) {
      if (remaining.length > 0) {
        return await this.fetchActualDataFromCandidates(remaining);
      }
      throw new FroniusCloudConnectionError(
        "Unable to read realtime data from the Solar.web guest link",
        asError(error),
      );
    }
  }

  private async fetchActualDataForId(pvSystemId: string): Promise<JsonObject> {
    const url = new URL(ACTUAL_DATA_PATH, SOLAR_WEB_ORIGIN);
    url.searchParams.set("pvSystemId", pvSystemId);

    const response = await this.requestActualData(url, pvSystemId);
    this.storeResponseCookies(response.headers);

    if (response.status >= 300 && response.status < 400) {
      throw new FroniusCloudConnectionError(
        "Solar.web guest session expired or was redirected",
      );
    }

    if (!response.ok) {
      throw new FroniusCloudConnectionError(
        `Solar.web realtime data returned HTTP ${response.status}`,
      );
    }

    try {
      const data = await response.json();
      const object = asObject(data);
      if (!object) {
        throw new FroniusCloudParseError(
          "Solar.web realtime response was not a JSON object",
        );
      }
      return object;
    } catch (error) {
      if (error instanceof FroniusCloudParseError) throw error;
      throw new FroniusCloudParseError(
        `Unable to parse Solar.web realtime data: ${
          error instanceof Error ? error.message : "invalid JSON"
        }`,
      );
    }
  }

  private async requestActualData(
    url: URL,
    pvSystemId: string,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: this.ajaxHeaders(pvSystemId),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new FroniusCloudConnectionError(
        "Failed to request Solar.web realtime data",
        asError(error),
      );
    }
  }

  private browserHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": USER_AGENT,
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    return headers;
  }

  private ajaxHeaders(pvSystemId: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": `${SOLAR_WEB_ORIGIN}/PvSystems/PvSystem?pvSystemId=${
        encodeURIComponent(pvSystemId)
      }`,
      "User-Agent": USER_AGENT,
      "X-Requested-With": "XMLHttpRequest",
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    return headers;
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  private storeResponseCookies(headers: Headers): void {
    const extendedHeaders = headers as Headers & {
      getSetCookie?: () => string[];
    };
    const setCookies = typeof extendedHeaders.getSetCookie === "function"
      ? extendedHeaders.getSetCookie()
      : this.splitSetCookieHeader(headers.get("set-cookie"));

    setCookies.forEach((setCookie) => {
      const firstPart = setCookie.split(";", 1)[0]?.trim() ?? "";
      const equals = firstPart.indexOf("=");
      if (equals <= 0) return;
      const name = firstPart.slice(0, equals).trim();
      const value = firstPart.slice(equals + 1).trim();
      if (!name) return;
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    });
  }

  private splitSetCookieHeader(value: string | null): string[] {
    if (!value) return [];
    // Fallback for runtimes without Headers.getSetCookie(). Do not split on
    // the comma inside Expires=Wed, ...; only split before the next cookie.
    return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
  }
}
