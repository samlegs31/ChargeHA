// EVSOLAR_BATCH2
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { AppDatabase } from "../db/AppDatabase.ts";
import { createHealthRoutes } from "./health.ts";

describe("GET /health", () => {
  it("returns 200 when SQLite is readable", async () => {
    const db = {
      getConfig: () => Promise.resolve(null),
    } as unknown as Pick<AppDatabase, "getConfig">;

    const res = await createHealthRoutes(db).request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("returns 503 when SQLite read fails", async () => {
    const db = {
      getConfig: () => Promise.reject(new Error("db unavailable")),
    } as unknown as Pick<AppDatabase, "getConfig">;

    const res = await createHealthRoutes(db).request("/");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "error",
      database: "error",
    });
  });
});
