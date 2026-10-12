import { assertEquals } from "@std/assert";
import { createVehicleAppearanceRoutes } from "./vehicleAppearance.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
Deno.test("appearance endpoint validates membership and exposes only cosmetic fields", async () => {
  const db = {
    getVehicle: (id: string) =>
      Promise.resolve(id === "known" ? { adapterType: "tesla" } : null),
    config: {
      getConfig: () =>
        Promise.resolve(
          '{"carType":"model3","exteriorColor":"DeepBlue","batteryLevel":99}',
        ),
    },
  };
  const app = createVehicleAppearanceRoutes(db as unknown as AppDatabase);
  assertEquals((await app.request("/")).status, 400);
  assertEquals((await app.request("/?vehicleId=missing")).status, 404);
  const response = await app.request("/?vehicleId=known");
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(await response.json(), {
    carType: "model3",
    exteriorColor: "DeepBlue",
  });
});
