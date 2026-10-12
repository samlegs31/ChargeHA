import { assertEquals } from "@std/assert";
import { createVersionRoutes } from "./version.ts";

Deno.test("release identity is explicit, never today's date, and cannot be cached", async () => {
  for (
    const env of [
      {},
      { EVSOLAR_VERSION: "2026.10.12" },
      { EVSOLAR_VERSION: "2026.10.12", EVSOLAR_REVISION: "invalid" },
      { EVSOLAR_VERSION: "<script>", EVSOLAR_REVISION: "8617582" },
    ]
  ) {
    const response = await createVersionRoutes((name) =>
      (env as Record<string, string>)[name]
    ).request("/");
    assertEquals(await response.json(), { version: null, revision: null });
  }
  const response = await createVersionRoutes((name) =>
    name === "EVSOLAR_VERSION" ? "2026.10.12" : "8617582"
  ).request("/");
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(await response.json(), {
    version: "2026.10.12",
    revision: "8617582",
  });
});
