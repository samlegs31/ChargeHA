import { describe, expect, it } from "vitest";
import { vehicleColorPalette } from "./vehicleColor.ts";

describe("vehicleColorPalette", () => {
  it("maps common Tesla paint names to their visual family", () => {
    expect(vehicleColorPalette("RedMulticoat").label).toBe("Red");
    expect(vehicleColorPalette("DeepBlueMetallic").label).toBe("Blue");
    expect(vehicleColorPalette("PearlWhiteMultiCoat").label).toBe("White");
    expect(vehicleColorPalette("SolidBlack").label).toBe("Black");
    expect(vehicleColorPalette("StealthGrey").label).toBe("Grey");
    expect(vehicleColorPalette("Quicksilver").label).toBe("Silver");
  });

  it("uses a readable E.V. Solar fallback when Tesla color is unavailable", () => {
    const palette = vehicleColorPalette(null);
    expect(palette.label).toBe("Vehicle");
    expect(palette.light).not.toBe(palette.strong);
  });
});
