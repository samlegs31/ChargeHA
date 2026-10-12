import { assertEquals } from "@std/assert";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { AppDatabase } from "../db/AppDatabase.ts";
import { ConfigService } from "../services/ConfigService.ts";
import { Logger } from "../lib/Logger.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";
import type { EnergyAdapterManager } from "../services/EnergyAdapterManager.ts";
import type { TrpcContext } from "./trpc.ts";
import { appRouter } from "./root.ts";

// Exercise the HTTP transport and Zod parsing, not just createCaller().
Deno.test("Settings HTTP batch preserves one-amp edits and legacy partial saves", async () => {
  const db = new AppDatabase(":memory:");
  try {
    await db.init();
    const energyManager = throwingMock<EnergyAdapterManager>("energyManager", {
      reconfigure: () => Promise.resolve(),
    });
    const configService = new ConfigService(
      db,
      energyManager,
      null,
      new Logger("http-test", "error"),
    );
    // The HTTP adapter awaits context creation; this mock must not be thenable.
    const context = throwingMock<TrpcContext & { then: undefined }>("context", {
      db,
      configService,
      then: undefined,
    });
    const request = async (path: string, input?: unknown) => {
      const mutation = input !== undefined;
      const response = await fetchRequestHandler({
        endpoint: "/trpc",
        router: appRouter,
        createContext: () => context,
        req: new Request(`http://localhost/trpc/${path}?batch=1`, {
          method: mutation ? "POST" : "GET",
          headers: mutation ? { "content-type": "application/json" } : {},
          body: mutation ? JSON.stringify({ "0": input }) : undefined,
        }),
      });
      return { status: response.status, body: await response.json() };
    };
    for (const amps of [22, 23, 21]) {
      const saved = await request("config.charging.set", {
        vehicleSolarCurrentLimits: { Friday: amps },
      });
      assertEquals(saved.status, 200, JSON.stringify(saved.body));
      const read = await request("config.charging.get,config.solar.get");
      assertEquals(read.status, 200);
      assertEquals(read.body.length, 2);
      assertEquals(read.body[0].result.data.vehicleSolarCurrentLimits, {
        Friday: amps,
      });
    }
    const legacySave = await request("config.charging.set", {
      vehicleCurrentLimits: { Friday: 32 },
    });
    assertEquals(legacySave.status, 200);
    const wrongMethod = await request("config.charging.set");
    assertEquals(wrongMethod.status, 405);
    const mixed = await request("config.charging.get,config.missing");
    assertEquals(mixed.status, 207);
    assertEquals(mixed.body[0].result.data.vehicleSolarCurrentLimits, {
      Friday: 21,
    });
    assertEquals(mixed.body[1].error.data.code, "NOT_FOUND");
    assertEquals(
      (await request("config.charging.get")).body[0].result.data
        .vehicleSolarCurrentLimits,
      { Friday: 21 },
    );
    for (const value of [22.5, 0, 81, "22", null]) {
      const rejected = await request("config.charging.set", {
        vehicleSolarCurrentLimits: { Friday: value },
      });
      assertEquals(rejected.status, 400);
      assertEquals(rejected.body[0].error.data.code, "BAD_REQUEST");
      assertEquals(
        (await request("config.charging.get")).body[0].result.data
          .vehicleSolarCurrentLimits,
        { Friday: 21 },
      );
    }
  } finally {
    db.close();
  }
});
