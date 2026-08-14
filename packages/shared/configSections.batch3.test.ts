// EVSOLAR_BATCH3
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { deserializeSection, systemConfigDef } from "./configSections.ts";

describe("system recording interval", () => {
  it("accepts only the 60-second interval used by Stats", () => {
    const schema = systemConfigDef.recordingIntervalSeconds.schema;
    expect(schema.safeParse(60).success).toBe(true);
    expect(schema.safeParse(30).success).toBe(false);
    expect(schema.safeParse(120).success).toBe(false);
  });

  it("falls back to 60 for a stale legacy DB value", () => {
    const config = deserializeSection(systemConfigDef, {
      recording_interval_seconds: "30",
    });
    expect(config.recordingIntervalSeconds).toBe(60);
  });
});
