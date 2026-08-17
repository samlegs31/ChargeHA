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
  const uniqueRoutes = routes.reduce<PluginTunnelRoute[]>((acc, route) => {
    const duplicate = acc.some((registered) => registered.path === route.path);
    if (!route.handler || duplicate) return acc;
    return [...acc, route];
  }, []);

  uniqueRoutes.forEach((route) => {
    const handler = route.handler;
    if (handler) app.get(route.path, (c) => handler(c.req.raw));
  });
}
