import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { setupAuthApp } from "../test-helpers/authHarness.ts";

describe("static asset auth exemptions", () => {
  function setupStaticAuthApp() {
    return setupAuthApp({
      authMode: "local",
      extraRoutes: (app) => {
        app.get("/public/app.js", (c) => c.text("public js"));
        app.get("/api/private.js", (c) => c.text("private api"));
        app.get("/trpc/private.js", (c) => c.text("private trpc"));
        app.get("/auth/private.js", (c) => c.text("private auth"));
      },
    });
  }

  it("allows non-API static assets without a session", async () => {
    const { app } = setupStaticAuthApp();

    const res = await app.request("/public/app.js");
    expect(res.status).toBe(200);
  });

  it("does not bypass auth for API-like paths ending in a static extension", async () => {
    const { app } = setupStaticAuthApp();

    for (const path of [
      "/api/private.js",
      "/trpc/private.js",
      "/auth/private.js",
    ]) {
      const res = await app.request(path);
      expect(res.status).toBe(401);
    }
  });
});
