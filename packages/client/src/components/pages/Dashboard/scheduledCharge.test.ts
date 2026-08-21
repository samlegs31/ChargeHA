import { describe, expect, it } from "vitest";
import type { ChargeSchedule } from "@chargeha/shared";
import { getScheduledChargeDisplay } from "./scheduledCharge.ts";

describe("getScheduledChargeDisplay", () => {
  const timezone = "Europe/Paris";
  const schedule = (
    overrides: Partial<ChargeSchedule> = {},
  ): ChargeSchedule => ({
    id: "night-charge",
    vehicleId: "vehicle-1",
    scheduleType: "charge",
    startTime: "23:10",
    endTime: "04:40",
    days: ["fri"],
    chargeAmps: 16,
    chargeLimitPct: 80,
    enabled: true,
    ...overrides,
  });

  it("shows today's next programmed charge", () => {
    const display = getScheduledChargeDisplay(
      [schedule()],
      "vehicle-1",
      "auto",
      new Date("2026-08-21T12:00:00.000Z"),
      timezone,
    );

    expect(display).toMatchObject({
      status: "upcoming",
      title: "Charge programmed for today",
      detail: "23:10–04:40 · Target 80%",
    });
  });

  it("recognizes an overnight programmed charge in progress", () => {
    const display = getScheduledChargeDisplay(
      [schedule()],
      "vehicle-1",
      "auto",
      new Date("2026-08-21T23:30:00.000Z"),
      timezone,
    );

    expect(display).toMatchObject({
      status: "active",
      title: "Programmed charge in progress",
      detail: "Until 04:40 · Target 80%",
    });
  });

  it("keeps a charge after midnight on the correct local day", () => {
    const display = getScheduledChargeDisplay(
      [schedule({ days: ["sat"], startTime: "00:10", endTime: "02:00" })],
      "vehicle-1",
      "auto",
      new Date("2026-08-21T22:05:00.000Z"),
      timezone,
    );

    expect(display).toMatchObject({
      status: "upcoming",
      title: "Charge programmed for today",
      detail: "00:10–02:00 · Target 80%",
    });
  });

  it("selects the nearest enabled charge for the correct vehicle", () => {
    const display = getScheduledChargeDisplay(
      [
        schedule({ id: "disabled", enabled: false, startTime: "14:30" }),
        schedule({ id: "other", vehicleId: "vehicle-2", startTime: "14:45" }),
        schedule({ id: "later", startTime: "21:30" }),
        schedule({ id: "next", startTime: "19:15" }),
      ],
      "vehicle-1",
      "auto",
      new Date("2026-08-21T12:00:00.000Z"),
      timezone,
    );

    expect(display?.scheduleId).toBe("next");
    expect(display?.detail).toContain("19:15–04:40");
  });

  it("warns when a saved charge cannot run in the selected mode", () => {
    const display = getScheduledChargeDisplay(
      [schedule()],
      "vehicle-1",
      "vacation",
      new Date("2026-08-21T12:00:00.000Z"),
      timezone,
    );

    expect(display).toMatchObject({
      status: "inactive_mode",
      title: "Programmed charge is saved",
    });
    expect(display?.detail).toContain("Turn on Smart Charge");
  });

  it("returns null when no enabled charge exists", () => {
    expect(
      getScheduledChargeDisplay(
        [schedule({ enabled: false })],
        "vehicle-1",
        "auto",
        new Date("2026-08-21T12:00:00.000Z"),
        timezone,
      ),
    ).toBeNull();
  });
});
