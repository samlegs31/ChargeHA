import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { TeslaTokenManager } from "./TeslaTokenManager.ts";
import { TeslaAdapter } from "./TeslaAdapter.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import type { CallContext } from "@chargeha/shared";
import { PluginDbLogger } from "../../../PluginDbLogger.ts";
import { MockTokenManager } from "./test-helpers/MockTokenManager.ts";

describe("TeslaAdapter exterior color", () => {
  const VIN = "5YJ3E1EA1MF000001";
  const context: CallContext = { origin: "test:color", traceId: "color" };
  const logger = new Logger("TeslaColorTest", "error");
  let server: Deno.HttpServer;
  let adapter: TeslaAdapter;
  let requestedEndpoints = "";

  beforeEach(() => {
    server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
      const url = new URL(req.url);
      if (url.pathname === `/api/1/vehicles/${VIN}/vehicle_data`) {
        requestedEndpoints = url.searchParams.get("endpoints") ?? "";
        return Response.json({
          response: {
            charge_state: {
              battery_level: 50,
              charge_limit_soc: 80,
              charging_state: "Disconnected",
            },
            vehicle_state: { vehicle_name: "Friday" },
            vehicle_config: { exterior_color: "RedMulticoat" },
            state: "online",
          },
        });
      }
      if (url.pathname === "/api/1/vehicles") {
        return Response.json({ response: [{ vin: VIN, state: "online" }] });
      }
      return new Response("Not found", { status: 404 });
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

  it("returns exterior color from the existing vehicle_data request", async () => {
    const state = await adapter.getChargeState(context);

    expect(state.exteriorColor).toBe("RedMulticoat");
    expect(requestedEndpoints).toContain("vehicle_config");
    expect(requestedEndpoints).toContain("charge_state");
  });
});
