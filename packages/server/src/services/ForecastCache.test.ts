import { assertEquals, assertRejects } from "@std/assert";
import { ForecastCache } from "./ForecastCache.ts";

Deno.test("weather cache shares in-flight requests, expires and retries failures", async () => {
  let now = 0;
  let calls = 0;
  const cache = new ForecastCache<number>(100, 2, () => now);
  const pending = Promise.withResolvers<number>();
  const load = () => {
    calls++;
    return pending.promise;
  };
  const first = cache.get("site", load);
  const second = cache.get("site", load);
  pending.resolve(42);
  assertEquals(await first, 42);
  assertEquals(await second, 42);
  assertEquals(calls, 1);
  assertEquals(await cache.get("site", () => Promise.resolve(99)), 42);
  now = 101;
  assertEquals(await cache.get("site", () => Promise.resolve(99)), 99);
  await assertRejects(() =>
    cache.get("failure", () => Promise.reject(new Error("offline")))
  );
  assertEquals(await cache.get("failure", () => Promise.resolve(7)), 7);
  await cache.get("third", () => Promise.resolve(3));
  assertEquals(await cache.get("site", () => Promise.resolve(100)), 100);
});
