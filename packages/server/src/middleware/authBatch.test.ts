import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { setupAuthApp } from "../test-helpers/authHarness.ts";

describe("tRPC auth batch exemptions", () => {
  function setupBatchAuthApp() {
    return setupAuthApp({
      authMode: "local",
      extraRoutes: (app) => {
        app.all("/trpc/*", (c) => c.json({ result: true }));
      },
    });
  }

  it("allows a batch containing only public procedures", async () => {
    const { app } = setupBatchAuthApp();

    const res = await app.request("/trpc/auth.session,auth.login");
    expect(res.status).toBe(200);
  });

  it("rejects a batch with public then private procedures", async () => {
    const { app } = setupBatchAuthApp();

    const res = await app.request("/trpc/auth.session,config.get");
    expect(res.status).toBe(401);
  });

  it("rejects a batch with private then public procedures", async () => {
    const { app } = setupBatchAuthApp();

    const res = await app.request("/trpc/config.get,auth.session");
    expect(res.status).toBe(401);
  });

  it("rejects procedure names that only share a public prefix", async () => {
    const { app } = setupBatchAuthApp();

    const res = await app.request("/trpc/auth.sessionPrivate");
    expect(res.status).toBe(401);
  });
});

Deno.test("malformed batches and non-tRPC methods require authentication", async () => {
  const { app } = setupAuthApp();
  for (
    const path of [
      "/trpc/auth.session,",
      "/trpc/auth.session/config.get",
      "/trpc/auth.session%2cconfig.get",
      "/healthPrivate",
    ]
  ) expect((await app.request(path)).status).toBe(401);
  expect((await app.request("/trpc/auth.login", { method: "DELETE" })).status)
    .toBe(401);
  expect((await app.request("/assets/app.js", { method: "POST" })).status)
    .toBe(401);
});
