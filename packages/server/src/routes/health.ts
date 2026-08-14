// EVSOLAR_BATCH2
import { Hono } from "hono";
import type { AppDatabase } from "../db/AppDatabase.ts";

/**
 * Lightweight liveness/readiness endpoint for Docker.
 * A successful response proves the HTTP router is alive and SQLite is readable.
 */
export function createHealthRoutes(
  db: Pick<AppDatabase, "getConfig">,
) {
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      await db.getConfig("wizard_completed");
      return c.json({ status: "ok", database: "ok" });
    } catch {
      return c.json({ status: "error", database: "error" }, 503);
    }
  });

  return app;
}
