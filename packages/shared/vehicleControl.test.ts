import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  getVehicleChargeController,
  isExternallyControlledVehicle,
  setVehicleChargeController,
} from "./vehicleControl.ts";

describe("vehicle charge controller metadata", () => {
  it("defaults legacy and invalid config to direct vehicle control", () => {
    expect(getVehicleChargeController("{}")).toBe("vehicle");
    expect(getVehicleChargeController("not-json")).toBe("vehicle");
    expect(isExternallyControlledVehicle(undefined)).toBe(false);
  });

  it("detects Wattpilot control", () => {
    expect(getVehicleChargeController('{"chargeController":"wattpilot"}'))
      .toBe("wattpilot");
    expect(isExternallyControlledVehicle('{"chargeController":"wattpilot"}'))
      .toBe(true);
  });

  it("preserves existing config when changing controller", () => {
    const wattpilot = setVehicleChargeController(
      '{"foo":"bar"}',
      "wattpilot",
    );
    expect(JSON.parse(wattpilot)).toEqual({
      foo: "bar",
      chargeController: "wattpilot",
    });

    const vehicle = setVehicleChargeController(wattpilot, "vehicle");
    expect(JSON.parse(vehicle)).toEqual({ foo: "bar" });
  });
});
