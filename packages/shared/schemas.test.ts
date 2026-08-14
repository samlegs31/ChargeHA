// EVSOLAR_BATCH2
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { scheduleCreateInput, tariffCreateInput } from "./schemas.ts";

describe("strict HH:MM schemas", () => {
  const baseTariff = {
    label: "Off peak",
    days: ["mon"] as ["mon"],
    ratePerKwh: 0.15,
  };

  it("accepts valid boundary times", () => {
    expect(
      tariffCreateInput.safeParse({
        ...baseTariff,
        startTime: "00:00",
        endTime: "23:59",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid clock times", () => {
    expect(
      tariffCreateInput.safeParse({
        ...baseTariff,
        startTime: "24:00",
        endTime: "12:00",
      }).success,
    ).toBe(false);

    expect(
      tariffCreateInput.safeParse({
        ...baseTariff,
        startTime: "12:60",
        endTime: "13:00",
      }).success,
    ).toBe(false);
  });

  it("applies the same validation to schedules", () => {
    expect(
      scheduleCreateInput.safeParse({
        scheduleType: "charge",
        startTime: "99:99",
        endTime: "10:00",
        days: ["mon"],
        vehicleId: "VIN1",
      }).success,
    ).toBe(false);
  });
});
