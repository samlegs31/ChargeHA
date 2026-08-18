import { describe, expect, it } from "vitest";
import {
  decodeTeslaModelYear,
  resolveTeslaGeneration,
  resolveTeslaModel,
  resolveTeslaPaint,
  resolveTeslaVisualSpec,
  resolveTeslaWheel,
} from "./TeslaVehicleVisualCatalog.ts";

describe("TeslaVehicleVisualCatalog", () => {
  it("decodes the Model 3 Shanghai VIN used by the visual POC", () => {
    const vin = "LRW3E7EK9PC819094";
    expect(decodeTeslaModelYear(vin)).toBe(2023);
    expect(resolveTeslaModel(vin, "model3")).toBe("model3");
    expect(resolveTeslaGeneration("model3", 2023)).toBe("model3-classic");
  });

  it("selects Highland and 2025 Model Y generations from VIN year", () => {
    expect(resolveTeslaGeneration("model3", 2024)).toBe("model3-highland");
    expect(resolveTeslaGeneration("modely", 2025)).toBe("modely-2025");
  });

  it("supports Fleet Telemetry CarType enum-style values", () => {
    expect(resolveTeslaModel("", "CarTypeModelS")).toBe("models");
    expect(resolveTeslaModel("", "CarTypeModelX")).toBe("modelx");
    expect(resolveTeslaModel("", "CarTypeCybertruck")).toBe("cybertruck");
    expect(resolveTeslaModel("", "CarTypeSemiTruck")).toBe("semi");
  });

  it("falls back to official VIN line codes when vehicle_config is unavailable", () => {
    expect(resolveTeslaModel("5YJSA1E20HF000001", null)).toBe("models");
    expect(resolveTeslaModel("5YJXCDE20HF000001", null)).toBe("modelx");
    expect(resolveTeslaModel("7SAYGDEE0SA000001", null)).toBe("modely");
    expect(resolveTeslaModel("7SACEHED0RA000001", null)).toBe("cybertruck");
  });

  it("maps documented exterior colors and paint codes", () => {
    expect(resolveTeslaPaint("DeepBlue").key).toBe("blue");
    expect(resolveTeslaPaint("PPSB").key).toBe("blue");
    expect(resolveTeslaPaint("PearlWhiteMultiCoat").key).toBe("white");
    expect(resolveTeslaPaint("PN01").key).toBe("stealth-gray");
    expect(resolveTeslaPaint("UltraRed").key).toBe("red");
    expect(resolveTeslaPaint("Quicksilver").key).toBe("quicksilver");
  });

  it("maps observed and documented wheel families", () => {
    expect(resolveTeslaWheel("StilettoFresh19").family).toBe("stiletto");
    expect(resolveTeslaWheel("Pinwheel18").family).toBe("aero");
    expect(resolveTeslaWheel("Uberturbine21").family).toBe("uberturbine");
    expect(resolveTeslaWheel("Induction20").family).toBe("induction");
    expect(resolveTeslaWheel("Photon18").family).toBe("photon");
    expect(resolveTeslaWheel("Crossflow19").family).toBe("crossflow");
    expect(resolveTeslaWheel("Cyberstream20").family).toBe("cyberstream");
  });

  it("keeps unknown future wheels safe with a generic fallback", () => {
    expect(resolveTeslaWheel("FutureWheel99")).toEqual({
      family: "generic",
      spokes: 10,
      dark: false,
      cover: false,
      turbine: false,
    });
  });

  it("builds a complete visual spec for F.R.I.D.A.Y.", () => {
    const spec = resolveTeslaVisualSpec("LRW3E7EK9PC819094", {
      carType: "model3",
      exteriorColor: "DeepBlue",
      wheelType: "StilettoFresh19",
      trim: "74d",
    });
    expect(spec.model).toBe("model3");
    expect(spec.generation).toBe("model3-classic");
    expect(spec.paint.key).toBe("blue");
    expect(spec.wheel.family).toBe("stiletto");
  });
});
