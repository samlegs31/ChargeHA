import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { fetchSolarWebHomeEvHistory } from "./SolarWebHistory.ts";

describe("Solar.web long quota cooldown", () => {
  it("does not shorten a provider cooldown to five minutes", async () => {
    const calls: string[] = [];
    const fetchFn = (input: string | URL | Request): Promise<Response> => {
      calls.push(String(input));
      return Promise.resolve(
        new Response("Quota exceeded", {
          status: 429,
          headers: { "Retry-After": "3600" },
        }),
      );
    };
    await expect(fetchSolarWebHomeEvHistory({
      email: "test@example.com",
      password: "test",
      pvSystemId: "test",
      from: "2026-09-01",
      to: "2026-09-02",
    }, fetchFn)).rejects.toThrow("60 minutes");
    expect(calls).toHaveLength(1);
  });
});
