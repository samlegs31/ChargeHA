import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";

export class FroniusConnectionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "FroniusConnectionError";
  }
}

export class FroniusParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FroniusParseError";
  }
}

function extractBatterySoc(inverters: unknown): number | null {
  if (!inverters || typeof inverters !== "object") return null;

  const firstInverterId = Object.keys(inverters)[0];
  if (!firstInverterId) return null;

  const inverter = (inverters as Record<string, { SOC?: unknown }>)[
    firstInverterId
  ];
  if (
    !inverter ||
    typeof inverter.SOC !== "number" ||
    !Number.isFinite(inverter.SOC)
  ) {
    return null;
  }

  return inverter.SOC;
}

const METER_VOLTAGE_CACHE_MS = 60_000;
const LOCAL_REQUEST_TIMEOUT_MS = 4_000;
const LOCAL_RETRY_DELAY_MS = 300;

export class FroniusLocalAdapter implements EnergySourceAdapter {
  pollIntervalSeconds(): number {
    return 4;
  }

  private host: string;
  private meterDeviceId: number;
  private baseUrl: string;
  private logger: Logger;
  private lastMeterFetchAtMs: number | null = null;
  private cachedGridVoltageV: number | null = null;

  constructor(host: string, meterDeviceId = 0, logger: Logger) {
    this.host = host;
    this.meterDeviceId = meterDeviceId;
    this.baseUrl = `http://${host}`;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    try {
      const response = await fetch(
        `${this.baseUrl}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`,
        { signal: AbortSignal.timeout(5000) },
      );

      if (!response.ok) {
        throw new FroniusConnectionError(
          `Fronius returned HTTP ${response.status}`,
        );
      }

      this.logger.info(`Connected to inverter at ${this.host}`);
    } catch (error) {
      if (error instanceof FroniusConnectionError) throw error;

      throw new FroniusConnectionError(
        `Cannot reach Fronius inverter at ${this.host}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  async disconnect(): Promise<void> {
    this.lastMeterFetchAtMs = null;
    this.cachedGridVoltageV = null;
  }

  async getRealtimeData(): Promise<EnergyData> {
    const [powerFlowRes, gridVoltageV] = await Promise.all([
      this.fetch("/solar_api/v1/GetPowerFlowRealtimeData.fcgi"),
      this.getGridVoltage(),
    ]);

    const json = await powerFlowRes.json();

    const data = json?.Body?.Data;
    const site = data?.Site;
    const inverters = data?.Inverters;

    if (!site) {
      throw new FroniusParseError(
        "Missing Body.Data.Site in PowerFlow response",
      );
    }

    return this.buildEnergyData(site, inverters, gridVoltageV);
  }

  private buildEnergyData(
    site: {
      P_PV?: number | null;
      P_Grid?: number | null;
      P_Load?: number | null;
      P_Akku?: number | null;
    },
    inverters: unknown,
    gridVoltageV: number | null,
  ): EnergyData {
    /*
     * Fronius exposes the battery SOC inside the inverter data:
     *
     * Body.Data.Inverters["1"].SOC
     *
     * It is NOT located at Body.Data.Site.SOC.
     *
     * Take the first inverter returned by the Fronius API.
     */
    const batterySoc = extractBatterySoc(inverters);

    return {
      solarProductionW: site.P_PV ?? 0,
      gridPowerW: site.P_Grid ?? 0,
      homeConsumptionW: Math.abs(site.P_Load ?? 0),
      batteryPowerW: site.P_Akku ?? null,
      batterySoc,
      gridVoltageV,
      lastUpdated: new Date().toISOString(),
    };
  }

  private async getGridVoltage(): Promise<number | null> {
    const now = Date.now();
    const cacheValid = this.lastMeterFetchAtMs !== null &&
      now - this.lastMeterFetchAtMs < METER_VOLTAGE_CACHE_MS;
    if (cacheValid) {
      return this.cachedGridVoltageV;
    }

    try {
      const meterRes = await this.fetch(
        `/solar_api/v1/GetMeterRealtimeData.cgi?Scope=Device&DeviceId=${this.meterDeviceId}`,
      );
      const meterJson = await meterRes.json();
      const rawVoltage = meterJson?.Body?.Data?.Voltage_AC_Phase_1;
      const isValidVoltage = typeof rawVoltage === "number" &&
        Number.isFinite(rawVoltage);
      const voltage = isValidVoltage ? rawVoltage : null;
      this.cachedGridVoltageV = voltage;
      this.lastMeterFetchAtMs = Date.now();
      return voltage;
    } catch (error) {
      // Back off after an established baseline so a transient meter glitch
      // does not stall the 4s PowerFlow poll loop.
      if (this.lastMeterFetchAtMs !== null) {
        this.lastMeterFetchAtMs = Date.now();
      }
      this.logger.debug(
        `Meter voltage refresh failed, using cached voltage (${
          this.cachedGridVoltageV ?? "null"
        }V)`,
        error,
      );
      return this.cachedGridVoltageV;
    }
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const response = await this.fetch(
      "/solar_api/v1/GetInverterInfo.cgi",
    );

    const json = await response.json();

    const inverters = json?.Body?.Data;

    if (!inverters) {
      throw new FroniusParseError(
        "Missing Body.Data in InverterInfo response",
      );
    }

    // Take the first inverter
    const firstId = Object.keys(inverters)[0];
    const info = inverters[firstId];

    return {
      id: firstId ?? "unknown",
      name: info?.CustomName ?? "Fronius Inverter",
      manufacturer: "Fronius",
      model: info?.DT?.toString() ?? "Unknown",
    };
  }

  private async fetch(path: string): Promise<Response> {
    return await this.fetchAttempt(path, 1, 2);
  }

  private async fetchAttempt(
    path: string,
    attempt: number,
    attempts: number,
  ): Promise<Response> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(LOCAL_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new FroniusConnectionError(
          `Fronius returned HTTP ${response.status} for ${path}`,
        );
      }

      return response;
    } catch (error) {
      if (
        error instanceof FroniusConnectionError ||
        error instanceof FroniusParseError
      ) {
        throw error;
      }

      if (attempt < attempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, LOCAL_RETRY_DELAY_MS)
        );
        return await this.fetchAttempt(path, attempt + 1, attempts);
      }

      throw new FroniusConnectionError(
        `Failed to fetch ${path} from Fronius at ${this.host}`,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
