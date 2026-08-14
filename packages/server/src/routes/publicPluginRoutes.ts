// EVSOLAR_BATCH5
import type { Hono } from "hono";
import type { PluginTunnelRoute } from "@chargeha/plugins/types";

/**
 * Expose plugin-provided custom public handlers on the main HTTP server.
 *
 * Tunnel routes with `handler` are self-contained public resources such as
 * Tesla's /.well-known/appspecific/com.tesla.3p.public-key.pem.
 * Proxy-only routes are intentionally ignored here because their canonical
 * HTTP endpoints are already mounted elsewhere.
 */
export function registerPublicPluginRoutes(
  app: Hono,
  routes: PluginTunnelRoute[],
): void {
  const seen = new Set<string>();

  for (const route of routes) {
    if (!route.handler || seen.has(route.path)) continue;
    seen.add(route.path);

    const handler = route.handler;
    app.get(route.path, (c) => handler(c.req.raw));
  }
}
