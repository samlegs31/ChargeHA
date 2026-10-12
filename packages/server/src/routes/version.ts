import { Hono } from "hono";

/** Release identity is supplied by the image, never inferred from today's date. */
export function createVersionRoutes(
  readEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
) {
  const version = readEnv("EVSOLAR_VERSION");
  const revision = readEnv("EVSOLAR_REVISION");
  const valid = version &&
    /^20\d{2}\.\d{2}\.\d{2}(?:\.[1-9]\d*)?$/.test(version) &&
    revision && /^[0-9a-f]{7,40}$/.test(revision);
  const identity = valid
    ? { version, revision }
    : { version: null, revision: null };
  const app = new Hono();
  app.get("/", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(identity);
  });
  return app;
}
