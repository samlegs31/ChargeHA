import { Hono } from "hono";
import type { AppDatabase } from "../db/AppDatabase.ts";
import { parseAppearance } from "../../../plugins/vehicles/tesla/server/TeslaAppearance.ts";

/** Mounted behind authentication. Cosmetic data only, without Tesla requests. */
export function createVehicleAppearanceRoutes(
  db: Pick<AppDatabase, "getVehicle" | "config">,
) {
  const app = new Hono();
  app.get("/", async (c) => {
    c.header("Cache-Control", "no-store");
    const id = c.req.query("vehicleId");
    if (!id || id.length > 128) return c.json({}, 400);
    const vehicle = await db.getVehicle(id);
    if (!vehicle || vehicle.adapterType !== "tesla") return c.json({}, 404);
    return c.json(
      parseAppearance(
        await db.config.getConfig(`tesla.vehicle_appearance.${id}`),
      ),
    );
  });
  return app;
}
