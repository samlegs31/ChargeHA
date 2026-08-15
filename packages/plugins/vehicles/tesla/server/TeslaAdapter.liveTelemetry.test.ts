import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { TeslaTokenManager } from "./TeslaTokenManager.ts";
import { TeslaAdapter } from "./TeslaAdapter.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import type { AdapterVehicleChargeState, CallContext } from "@chargeha/shared";
import { PluginDbLogger } from "../../../PluginDbLogger.ts";
import { MockTokenManager } from "./test-helpers/MockTokenManager.ts";

type TeslaLiveState = AdapterVehicleChargeState & {
  chargeAmpsActual?: number;
};

describe("TeslaAdapter live charging telemetry", () => {
  const VIN = "5YJ3E1EA1MF000001";
  const logger = new Logger("Tesla", "error");
  const ctx: CallContext = { origin: "test:live-telemetry", traceId: "test" };

  let server: Deno.HttpServer;
  let adapter: TeslaAdapter;

  beforeEach(() => {
    server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
      const url = new URL(req.url);
      if (url.pathname === `/api/1/vehicles/${VIN}/vehicle_data`) {
        return Response.json({
          response: {
            charge_state: {
              battery_level: 60,
              charge_limit_soc: 80,
              charging_state: "Charging",
              charge_current_request: 18,
              charge_current_request_max: 32,
              charger_actual_current: 5,
              charger_voltage: 240,
              charger_phases: 1,
              charge_energy_added: 0.4,
              minutes_to_full_charge: 995,
              charge_port_door_open: true,
            },
            vehicle_state: { vehicle_name: "Friday" },
            state: "online",
          },
        });
      }
      if (url.pathname === "/api/1/vehicles") {
        return Response.json({ response: [{ vin: VIN, state: "online" }] });
      }
      return Response.json({ response: { result: true } });
    });

    const addr = server.addr as Deno.NetAddr;
    const baseUrl = `http://localhost:${addr.port}`;
    const tokenManager = new MockTokenManager();
    tokenManager.fleetApiBaseUrl = baseUrl;

    adapter = new TeslaAdapter(
      VIN,
      tokenManager as unknown as TeslaTokenManager,
      baseUrl,
      logger,
      new PluginDbLogger(async () => {}, logger),
    );
  });

  afterEach(async () => {
    await server.shutdown();
  });

  it("keeps requested amps for control while power follows measured current", async () => {
    const state = await adapter.getChargeState(ctx) as TeslaLiveState;

    expect(state.chargeAmps).toBe(18);
    expect(state.chargeAmpsActual).toBe(5);
    expect(state.chargePowerKw).toBe(1.2);
    expect(state.chargeAmpsMax).toBe(32);
  });
});
