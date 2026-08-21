import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { EnergyData } from "@chargeha/shared";
import { renderWithProviders } from "../../test-utils.tsx";
import type { ChargingVehicleFlow } from "./EnergyFlowDiagram.tsx";
import { EnergyFlowDiagram } from "./EnergyFlowDiagram.tsx";

describe("EnergyFlowDiagram", () => {
  afterEach(cleanup);

  const makeEnergyData = (overrides: Partial<EnergyData> = {}): EnergyData => ({
    solarProductionW: 3500,
    gridPowerW: 200,
    homeConsumptionW: 3700,
    batteryPowerW: null,
    batterySoc: null,
    gridVoltageV: null,
    lastUpdated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });

  const chargingVehicle: ChargingVehicleFlow = {
    id: "edith",
    name: "E.D.I.T.H.",
    chargePowerW: 2100,
    solarW: 2100,
    batteryW: 0,
    gridW: 0,
  };

  it("shows one central rail and correctly routed colored branches", () => {
    renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({
          solarProductionW: 3100,
          batteryPowerW: -225,
          batterySoc: 46,
          gridPowerW: 4,
          homeConsumptionW: 2795,
        })}
        chargingVehicles={[chargingVehicle]}
      />,
    );

    expect(screen.getAllByTestId("energy-bus-track")).toHaveLength(1);
    expect(screen.getByTestId("energy-bus")).toHaveAttribute("data-source", "solar");
    expect(screen.getByTestId("energy-bus")).toHaveAttribute("data-route-count", "3");
    expect(screen.queryByTestId("energy-hub")).not.toBeInTheDocument();
    expect(screen.getByTestId("energy-bus-solar-to-vehicle-edith"))
      .toHaveAttribute("data-motion", "forward");
    expect(screen.getByTestId("energy-bus-solar-to-battery"))
      .toHaveAttribute("data-motion", "forward");
    expect(screen.getByTestId("energy-bus-solar-to-home"))
      .toHaveAttribute("data-motion", "forward");
    expect(screen.getByTestId("energy-bus-solar-to-vehicle-edith"))
      .toHaveAttribute("data-bead-count", "1");
    expect(screen.queryByTestId("energy-bus-solar")).not.toBeInTheDocument();

    expect(screen.getByTestId("flow-solar")).toHaveAttribute("data-direction", "up");
    expect(screen.getByTestId("flow-solar")).toHaveAttribute("data-role", "source");
    expect(screen.getByTestId("flow-solar").getAttribute("style"))
      .toContain("--branch-color: var(--color-solar)");

    expect(screen.getByTestId("flow-vehicle-edith")).toHaveAttribute("data-direction", "up");
    expect(screen.getByTestId("flow-vehicle-edith")).toHaveAttribute("data-role", "destination");
    expect(screen.getByTestId("flow-vehicle-edith")).toHaveAttribute("data-sources", "solar");
    expect(screen.getByTestId("flow-vehicle-edith").getAttribute("style"))
      .toContain("--branch-color: var(--color-solar)");

    expect(screen.getByTestId("flow-battery")).toHaveAttribute("data-direction", "down");
    expect(screen.getByTestId("flow-battery")).toHaveAttribute("data-role", "destination");
    expect(screen.getByTestId("flow-battery")).toHaveAttribute("data-sources", "solar");
    expect(screen.getByTestId("flow-battery").getAttribute("style"))
      .toContain("--branch-color: var(--color-solar)");

    expect(screen.getByTestId("flow-home")).toHaveAttribute("data-direction", "down");
    expect(screen.getByTestId("flow-home")).toHaveAttribute("data-role", "destination");
    expect(screen.getByTestId("flow-home")).toHaveAttribute("data-sources", "solar");
    expect(screen.getByTestId("flow-home").getAttribute("style"))
      .toContain("--branch-color: var(--color-solar)");

    expect(screen.getByTestId("flow-grid")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("flow-grid")).toHaveAttribute("data-role", "idle");
  });

  it("shows the capture values once without a duplicate metrics row", () => {
    renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({
          solarProductionW: 3100,
          batteryPowerW: -225,
          batterySoc: 46,
          gridPowerW: 4,
          homeConsumptionW: 2795,
        })}
        chargingVehicles={[chargingVehicle]}
      />,
    );

    expect(screen.getByTestId("node-solar")).toHaveTextContent("3.1 kW");
    expect(screen.getByTestId("node-battery")).toHaveTextContent("225 W");
    expect(screen.getByTestId("node-battery")).toHaveTextContent("46% · Charging");
    expect(screen.getByTestId("node-home")).toHaveTextContent("695 W");
    expect(screen.getByTestId("node-grid")).toHaveTextContent("4 W");
    expect(screen.getByTestId("vehicle-node-edith")).toHaveTextContent("2.1 kW");
    expect(screen.queryByTestId(/metric-/)).not.toBeInTheDocument();
  });

  it("uses a fixed bead count and scales bead size to inverter and grid limits", () => {
    renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({
          solarProductionW: 6000,
          batteryPowerW: -3000,
          batterySoc: 50,
          gridPowerW: 12_000,
          homeConsumptionW: 15_000,
        })}
      />,
    );

    expect(screen.getByTestId("energy-bus-grid-to-home"))
      .toHaveAttribute("data-bead-count", "1");
    expect(screen.getByTestId("energy-bus-grid-to-home").getAttribute("style"))
      .toContain("--bus-bead-size: 11.5px");
    expect(screen.getByTestId("energy-bus-grid-to-battery").getAttribute("style"))
      .toContain("--bus-bead-size: 8.5px");
    expect(screen.getByTestId("energy-bus-solar-to-home").getAttribute("style"))
      .toContain("--bus-bead-size: 13px");
    expect(screen.getByTestId("flow-solar")).toHaveAttribute("data-bead-count", "1");
    expect(screen.getByTestId("flow-solar").querySelector("[data-source]")
      ?.getAttribute("style"))
      .toContain("--branch-bead-size: 13px");
    expect(screen.getByTestId("flow-battery").querySelector("[data-source]")
      ?.getAttribute("style"))
      .toContain("--branch-bead-size: 10px");
    expect(screen.getByTestId("flow-grid").querySelector("[data-source]")
      ?.getAttribute("style"))
      .toContain("--branch-bead-size: 13px");
  });

  it("moves a discharging battery upward and makes it dominant", () => {
    renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({
          solarProductionW: 200,
          batteryPowerW: 1800,
          batterySoc: 72,
          gridPowerW: 100,
        })}
      />,
    );

    expect(screen.getByTestId("energy-bus")).toHaveAttribute("data-source", "battery");
    expect(screen.getByTestId("energy-bus-battery-to-home"))
      .toHaveAttribute("data-motion", "forward");
    expect(screen.getByTestId("flow-battery")).toHaveAttribute("data-direction", "up");
    expect(screen.getByTestId("flow-battery")).toHaveAttribute("data-role", "source");
  });

  it("moves grid import upward in red and reverses the central stream", () => {
    renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({
          solarProductionW: 200,
          batteryPowerW: 400,
          gridPowerW: 2400,
        })}
      />,
    );

    expect(screen.getByTestId("energy-bus")).toHaveAttribute("data-source", "grid");
    expect(screen.getByTestId("energy-bus-grid-to-home"))
      .toHaveAttribute("data-motion", "reverse");
    expect(screen.getByTestId("flow-grid")).toHaveAttribute("data-direction", "up");
    expect(screen.getByTestId("flow-grid")).toHaveAttribute("data-role", "source");
    expect(screen.getByTestId("flow-grid").getAttribute("style"))
      .toContain("--branch-color: var(--color-grid-import)");
  });

  it("moves grid export downward in green", () => {
    renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({
          solarProductionW: 3200,
          batteryPowerW: 0,
          gridPowerW: -900,
          homeConsumptionW: 2300,
        })}
      />,
    );

    expect(screen.getByTestId("energy-bus")).toHaveAttribute("data-source", "solar");
    expect(screen.getByTestId("energy-bus-solar-to-grid"))
      .toHaveAttribute("data-motion", "forward");
    expect(screen.getByTestId("flow-grid")).toHaveAttribute("data-direction", "down");
    expect(screen.getByTestId("flow-grid")).toHaveAttribute("data-role", "destination");
    expect(screen.getByTestId("flow-grid").getAttribute("style"))
      .toContain("--branch-color: var(--color-solar)");
    expect(screen.getByTestId("node-grid")).toHaveTextContent("Export");
  });

  it("routes solar to the car, home battery, home, and grid export", () => {
    renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({
          solarProductionW: 5000,
          batteryPowerW: -1000,
          batterySoc: 46,
          gridPowerW: -800,
          homeConsumptionW: 3200,
        })}
        chargingVehicles={[{
          ...chargingVehicle,
          chargePowerW: 1000,
          solarW: 1000,
        }]}
      />,
    );

    expect(screen.getByTestId("flow-vehicle-edith"))
      .toHaveAttribute("data-sources", "solar");
    expect(screen.getByTestId("flow-battery"))
      .toHaveAttribute("data-sources", "solar");
    expect(screen.getByTestId("flow-home"))
      .toHaveAttribute("data-sources", "solar");
    expect(screen.getByTestId("flow-grid"))
      .toHaveAttribute("data-sources", "solar");
    expect(screen.getByTestId("flow-grid")).toHaveAttribute("data-role", "destination");
  });

  it("routes a discharging battery to the car, home, and grid export", () => {
    renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({
          solarProductionW: 0,
          batteryPowerW: 4000,
          batterySoc: 70,
          gridPowerW: -500,
          homeConsumptionW: 3500,
        })}
        chargingVehicles={[{
          ...chargingVehicle,
          chargePowerW: 1500,
          solarW: 0,
          batteryW: 1500,
        }]}
      />,
    );

    expect(screen.getByTestId("flow-vehicle-edith"))
      .toHaveAttribute("data-sources", "battery");
    expect(screen.getByTestId("flow-home"))
      .toHaveAttribute("data-sources", "battery");
    expect(screen.getByTestId("flow-grid"))
      .toHaveAttribute("data-sources", "battery");
    expect(screen.getByTestId("flow-battery")).toHaveAttribute("data-role", "source");
  });

  it("routes grid import to the car, home battery, and home", () => {
    renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({
          solarProductionW: 0,
          batteryPowerW: -1000,
          batterySoc: 30,
          gridPowerW: 5000,
          homeConsumptionW: 4000,
        })}
        chargingVehicles={[{
          ...chargingVehicle,
          chargePowerW: 2000,
          solarW: 0,
          gridW: 2000,
        }]}
      />,
    );

    expect(screen.getByTestId("flow-vehicle-edith"))
      .toHaveAttribute("data-sources", "grid");
    expect(screen.getByTestId("flow-battery"))
      .toHaveAttribute("data-sources", "grid");
    expect(screen.getByTestId("flow-home"))
      .toHaveAttribute("data-sources", "grid");
    expect(screen.getByTestId("flow-grid")).toHaveAttribute("data-role", "source");
  });

  it("colors a mixed-source car from the energy that feeds it", () => {
    renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({
          solarProductionW: 3000,
          batteryPowerW: 1000,
          batterySoc: 70,
          gridPowerW: 2000,
          homeConsumptionW: 6000,
        })}
        chargingVehicles={[{
          ...chargingVehicle,
          chargePowerW: 6000,
          solarW: 3000,
          batteryW: 1000,
          gridW: 2000,
        }]}
      />,
    );

    const vehicleFlow = screen.getByTestId("flow-vehicle-edith");
    expect(vehicleFlow).toHaveAttribute("data-sources", "solar battery grid");
    expect(vehicleFlow).toHaveAttribute("data-bead-count", "3");
    expect(vehicleFlow.getAttribute("style"))
      .toContain("--branch-color: var(--color-solar)");
    expect([...vehicleFlow.querySelectorAll("[data-source]")].map((node) =>
      node.getAttribute("data-source")
    )).toEqual(["solar", "battery", "grid"]);

    const vehicle = screen.getByTestId("vehicle-node-edith");
    expect(vehicle).toHaveAttribute("data-sources", "solar battery grid");
    expect(vehicle.getAttribute("style"))
      .toContain("--vehicle-energy-color: var(--color-solar)");
    const ringStyle = vehicle.querySelector("div")?.getAttribute("style");
    expect(ringStyle).toContain("--vehicle-solar-stop: 180deg");
    expect(ringStyle).toContain("--vehicle-battery-stop: 240deg");
    expect(ringStyle).toContain("--vehicle-grid-stop: 360deg");
  });

  it("updates the dynamic home battery icon", () => {
    const { rerender } = renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({ batteryPowerW: -1200, batterySoc: 18 })}
      />,
    );

    expect(screen.getByTestId("home-battery-icon")).toHaveAttribute("data-level", "low");
    expect(screen.getByTestId("home-battery-icon")).toHaveAttribute("data-charging", "true");

    rerender(
      <EnergyFlowDiagram
        data={makeEnergyData({ batteryPowerW: 800, batterySoc: 91 })}
      />,
    );
    expect(screen.getByTestId("home-battery-icon")).toHaveAttribute("data-fill", "91");
    expect(screen.getByTestId("home-battery-icon")).toHaveAttribute("data-level", "high");
  });

  it("subtracts charging vehicles from ordinary home use", () => {
    renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({ homeConsumptionW: 5400 })}
        chargingVehicles={[{ ...chargingVehicle, chargePowerW: 4600 }]}
      />,
    );

    expect(screen.getByTestId("node-home")).toHaveTextContent("800 W");
    expect(screen.queryByText("5.4 kW")).not.toBeInTheDocument();
  });

  it("shows two compact vehicle receivers", () => {
    renderWithProviders(
      <EnergyFlowDiagram
        data={makeEnergyData({ homeConsumptionW: 14_000 })}
        chargingVehicles={[
          chargingVehicle,
          { id: "friday", name: "F.R.I.D.A.Y.", chargePowerW: 7400, solarW: 1000, gridW: 6400 },
        ]}
      />,
    );

    expect(screen.getByTestId("vehicle-node-edith")).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-node-friday")).toBeInTheDocument();
    expect(screen.getByTestId("flow-vehicle-edith")).toHaveAttribute("data-direction", "up");
    expect(screen.getByTestId("flow-vehicle-friday")).toHaveAttribute("data-direction", "up");
    expect(screen.getAllByTestId("vehicle-silhouette-icon")).toHaveLength(2);
  });

  it("supports loading and installations without a battery", () => {
    renderWithProviders(
      <EnergyFlowDiagram data={makeEnergyData({ batteryPowerW: null })} loading />,
    );

    expect(screen.getByTestId("flow-summary")).toHaveTextContent("Connecting to live energy");
    expect(screen.getAllByText("---").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByTestId("home-battery-icon")).not.toBeInTheDocument();
    expect(screen.queryByTestId("flow-battery")).not.toBeInTheDocument();
  });
});
