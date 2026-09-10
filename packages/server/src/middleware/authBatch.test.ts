import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { setupAuthApp } from "../test-helpers/authHarness.ts";

describe("tRPC auth batch exemptions", () => {
  it("allows a batch containing only public procedures", async () => {
    const { app } = setupAuthApp({ authMode: "local" });

    const res = await app.request("/trpc/auth.session,auth.login");
    expect(res.status).toBe(200);
  });

  it("rejects a batch with public then private procedures", async () => {
    const { app } = setupAuthApp({ authMode: "local" });

    const res = await app.request("/trpc/auth.session,config.get");
    expect(res.status).toBe(401);
  });

  it("rejects a batch with private then public procedures", async () => {
    const { app } = setupAuthApp({ authMode: "local" });

    const res = await app.request("/trpc/config.get,auth.session");
    expect(res.status).toBe(401);
  });

  it("rejects procedure names that only share a public prefix", async () => {
    const { app } = setupAuthApp({ authMode: "local" });

    const res = await app.request("/trpc/auth.sessionPrivate");
    expect(res.status).toBe(401);
  });
});
