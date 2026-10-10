import { AppDatabase } from "../AppDatabase.ts";
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { parsePluginLogSearch } from "./LogRepository.ts";

describe("parsePluginLogSearch", () => {
  it("returns empty include and no excludes for empty input", () => {
    expect(parsePluginLogSearch("")).toEqual({ include: "", excludes: [] });
    expect(parsePluginLogSearch("   ")).toEqual({ include: "", excludes: [] });
  });

  it("treats unprefixed input as the include phrase", () => {
    expect(parsePluginLogSearch("vehicle came online")).toEqual({
      include: "vehicle came online",
      excludes: [],
    });
  });

  it("extracts a single `-term` as an exclude", () => {
    expect(parsePluginLogSearch("-online-check")).toEqual({
      include: "",
      excludes: ["online-check"],
    });
  });

  it("combines includes and excludes", () => {
    expect(parsePluginLogSearch("tesla -online-check")).toEqual({
      include: "tesla",
      excludes: ["online-check"],
    });
  });

  it("supports multiple excludes", () => {
    expect(parsePluginLogSearch("tesla -online-check -heartbeat")).toEqual({
      include: "tesla",
      excludes: ["online-check", "heartbeat"],
    });
  });

  it("ignores a bare `-` token", () => {
    expect(parsePluginLogSearch("foo - bar")).toEqual({
      include: "foo bar",
      excludes: [],
    });
  });

  it("collapses extra whitespace in includes", () => {
    expect(parsePluginLogSearch("  foo   bar  ")).toEqual({
      include: "foo bar",
      excludes: [],
    });
  });
});

Deno.test("latest controller log is deterministic when timestamps are equal", async () => {
  const db = new AppDatabase(":memory:");
  try {
    await db.init();
    await db.logs.insertControllerLogEntries(
      ["older", "newer"].map((actionDetail) => ({
        vehicleId: "car",
        vehicleName: "Car",
        mode: "auto" as const,
        inputsJson: "{}",
        checksJson: "[]",
        action: "none" as const,
        actionDetail,
        targetAmps: null,
        traceId: null,
      })),
    );
    db.getDriver().exec(
      "UPDATE controller_logs SET timestamp = '2026-10-10 12:00:00'",
    );
    const { rows } = await db.logs.getControllerLogs({
      vehicleId: "car",
      limit: 1,
      offset: 0,
    });
    expect(rows[0].actionDetail).toBe("newer");
    const older = await db.logs.getControllerLogs({
      vehicleId: "car",
      limit: 1,
      offset: 1,
    });
    expect(older.rows[0].actionDetail).toBe("older");
  } finally {
    db.close();
  }
});
