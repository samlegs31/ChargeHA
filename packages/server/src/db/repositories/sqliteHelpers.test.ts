import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { localDayUtcBounds, toSqliteDatetime } from "./sqliteHelpers.ts";

describe("toSqliteDatetime", () => {
  it("converts ISO UTC string to SQLite datetime format", () => {
    expect(toSqliteDatetime("2026-04-07T15:37:00.000Z"))
      .toBe("2026-04-07 15:37:00");
  });

  it("strips sub-second precision", () => {
    expect(toSqliteDatetime("2026-04-07T15:37:00.123456Z"))
      .toBe("2026-04-07 15:37:00");
  });

  it("converts offset-bearing ISO strings to UTC", () => {
    expect(toSqliteDatetime("2026-04-08T01:37:00+10:00"))
      .toBe("2026-04-07 15:37:00");
  });

  it("throws on unparseable input", () => {
    expect(() => toSqliteDatetime("not a date")).toThrow(/Invalid datetime/);
  });
});

describe("localDayUtcBounds", () => {
  it("converts a positive local offset to UTC", () => {
    expect(localDayUtcBounds("2026-09-04", 2)).toEqual({
      start: "2026-09-03 22:00:00",
      end: "2026-09-04 22:00:00",
    });
  });

  it("supports fractional and negative offsets", () => {
    expect(localDayUtcBounds("2026-01-15", -3.5)).toEqual({
      start: "2026-01-15 03:30:00",
      end: "2026-01-16 03:30:00",
    });
  });
});
