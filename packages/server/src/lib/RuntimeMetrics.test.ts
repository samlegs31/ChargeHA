import { expect } from "@std/expect";
import { RuntimeMetrics } from "./RuntimeMetrics.ts";

Deno.test("metrics retain only 128 recent durations but lifetime failure counts", () => {
  const metrics = new RuntimeMetrics();
  expect(metrics.snapshot().p95Ms).toBeNull();
  for (let i = 1; i <= 1000; i++) metrics.record(i, i % 2 === 0);
  expect(metrics.snapshot()).toEqual({
    count: 1000,
    failures: 500,
    samples: 128,
    p95Ms: 994,
    lastAt: expect.any(String),
  });
});
