import { type ComponentType, lazy } from "react";

const TeslaVehicleVisualDev = lazy(() =>
  import("./vehicles/tesla/client/TeslaVehicleVisualDev.tsx").then(
    (module) => ({ default: module.TeslaVehicleVisualDev }),
  )
);

/** Development-only plugin pages, kept separate from the production settings registry. */
export const pluginDevComponents: Record<string, ComponentType> = {
  "vehicle-visual": TeslaVehicleVisualDev,
};
