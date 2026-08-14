// EVSOLAR_BATCH5
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import type { PluginTunnelRoute } from "@chargeha/plugins/types";
import { registerPublicPluginRoutes } from "./publicPluginRoutes.ts";

describe("registerPublicPluginRoutes", () => {
  it("serves a plugin .well-known handler at the root path", async () => {
    const app = new Hono();
    const routes: PluginTunnelRoute[] = [
      {
        path: "/.well-known/appspecific/com.tesla.3p.public-key.pem",
        handler: () =>
          new Response("PUBLIC-KEY", {
            headers: { "Content-Type": "text/plain" },
          }),
      },
    ];

    registerPublicPluginRoutes(app, routes);

    const res = await app.request(
      "/.well-known/appspecific/com.tesla.3p.public-key.pem",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PUBLIC-KEY");
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  it("does not expose proxy-only tunnel routes", async () => {
    const app = new Hono();
    registerPublicPluginRoutes(app, [
      {
        path: "/api/vehicle/tesla/callback",
        proxy: true,
      },
    ]);

    const res = await app.request("/api/vehicle/tesla/callback");
    expect(res.status).toBe(404);
  });

  it("keeps the first handler when plugins declare the same path", async () => {
    const app = new Hono();
    registerPublicPluginRoutes(app, [
      {
        path: "/.well-known/example",
        handler: () => new Response("first"),
      },
      {
        path: "/.well-known/example",
        handler: () => new Response("second"),
      },
    ]);

    const res = await app.request("/.well-known/example");
    expect(await res.text()).toBe("first");
  });
});
