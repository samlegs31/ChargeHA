import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { VehicleChargeState } from "@chargeha/shared";
import { vehicleImageSource, VehicleVisual } from "./VehicleVisual.tsx";

afterEach(cleanup);

describe("vehicle visual fallback", () => {
  it("maps only known models without guessing from a VIN or name", () => {
    expect(
      vehicleImageSource({
        carType: "Model_Y",
        exteriorColor: "PearlWhite",
        wheelType: "Induction20Black",
      }),
    ).toBe("/vehicles/model-y-pearlwhite-induction20.png");
    expect(
      vehicleImageSource({
        carType: "model3",
        exteriorColor: "DeepBlue",
        wheelType: "StilettoRefresh19",
      }),
    ).toBe("/vehicles/model-3-deepblue-sport19.png");
    expect(
      vehicleImageSource({
        carType: "model3",
        exteriorColor: "RedMulticoat",
        wheelType: "StilettoRefresh19",
      }),
    ).toBeNull();
    expect(vehicleImageSource({ carType: "modelx" })).toBeNull();
    expect(vehicleImageSource({})).toBeNull();
  });

  it("keeps real configuration and falls back when the image fails", () => {
    const state = {
      carType: "model3",
      exteriorColor: "DeepBlue",
      wheelType: "StilettoRefresh19",
    } as VehicleChargeState;
    render(<VehicleVisual state={state} />);
    expect(screen.getByText("Deep Blue · 19″ Sport")).toBeInTheDocument();
    fireEvent.error(screen.getByAltText(/three-quarter view/));
    expect(screen.getByRole("img", { name: "Vehicle silhouette" }))
      .toBeInTheDocument();
    expect(screen.queryByText("Illustration")).not.toBeInTheDocument();
  });
});
