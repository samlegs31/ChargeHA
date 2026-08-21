import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import type { EnergyData } from "@chargeha/shared";
import type { ChargingVehicleFlow } from "./EnergyFlowDiagram.tsx";
import { EnergyFlowDiagram } from "./EnergyFlowDiagram.tsx";

describe("EnergyFlowDiagram", () => {
  afterEach(cleanup);

  const makeEnergyData = (overrides: Partial<EnergyData> = {}): EnergyData => {
    return {
      solarProductionW: 3500,
      gridPowerW: 200,
      homeConsumptionW: 3700,
      batteryPowerW: null,
      batterySoc: null,
      gridVoltageV: null,
      lastUpdated: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  };

  // ---- rendering ----

  describe("rendering", () => {
    it("renders Solar, Home, and Grid labels", () => {
      renderWithProviders(<EnergyFlowDiagram data={makeEnergyData()} />);

      expect(screen.getByText("Solar")).toBeInTheDocument();
      expect(screen.getByText("Home")).toBeInTheDocument();
      expect(screen.getByText("Grid")).toBeInTheDocument();
    });

    it("summarizes the dominant live source in plain language", () => {
      const { rerender } = renderWithProviders(
        <EnergyFlowDiagram data={makeEnergyData()} />,
      );

      expect(screen.getByTestId("flow-summary"))
        .toHaveTextContent("Solar energy is flowing");

      rerender(
        <EnergyFlowDiagram
          data={makeEnergyData({
            solarProductionW: 0,
            batteryPowerW: 1600,
            gridPowerW: 0,
          })}
        />,
      );
      expect(screen.getByTestId("flow-summary"))
        .toHaveTextContent("Home battery is supporting");
    });

    it("animates only the dominant source on one horizontal energy bar", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({
            solarProductionW: 3200,
            batteryPowerW: 900,
            gridPowerW: 700,
            homeConsumptionW: 4800,
          })}
        />,
      );

      expect(screen.getByTestId("energy-bus"))
        .toHaveAttribute("data-stream-count", "1");
      expect(screen.getByTestId("energy-bus"))
        .toHaveAttribute("data-source", "solar");
      expect(screen.getByTestId("energy-bus"))
        .toHaveAttribute("data-available-sources", "solar battery grid");
      expect(screen.getAllByTestId("energy-bus-track")).toHaveLength(1);
      expect(screen.getByTestId("energy-bus-solar").getAttribute("style"))
        .toContain("--energy-dot-color: var(--color-solar)");
      expect(screen.queryByTestId("energy-bus-battery")).not
        .toBeInTheDocument();
      expect(screen.queryByTestId("energy-bus-grid")).not.toBeInTheDocument();
      expect(screen.getByTestId("energy-bus-solar"))
        .toHaveAttribute("data-bead-count", "2");
      expect(screen.getByTestId("flow-home"))
        .toHaveAttribute("data-sources", "solar battery grid");
      expect(screen.getByTestId("flow-home"))
        .toHaveAttribute("data-direction", "down");
    });

    it("recolors and reverses the bar when the grid becomes dominant", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({
            solarProductionW: 300,
            batteryPowerW: 400,
            gridPowerW: 2400,
          })}
        />,
      );

      expect(screen.getByTestId("energy-bus"))
        .toHaveAttribute("data-source", "grid");
      expect(screen.getByTestId("energy-bus-grid"))
        .toHaveAttribute("data-motion", "reverse");
      expect(screen.getByTestId("energy-bus-grid"))
        .toHaveAttribute("data-bead-count", "2");
    });
  });

  // ---- loading state ----

  describe("loading state", () => {
    it('shows "---" placeholders when loading (incl. battery when present)', () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({ batteryPowerW: 1500, batterySoc: 72 })}
          loading
        />,
      );

      expect(screen.getByText("Battery")).toBeInTheDocument();
      const dashes = screen.getAllByText("---");
      // Solar, Home, Grid, Battery should all show "---"
      expect(dashes.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ---- formatted values ----

  describe("formatted values", () => {
    it("shows formatted watt values when data is present", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({
            solarProductionW: 5234,
            homeConsumptionW: 3700,
            gridPowerW: 200,
          })}
        />,
      );

      expect(screen.getByText("5.2 kW")).toBeInTheDocument();
      expect(screen.getByText("3.7 kW")).toBeInTheDocument();
      // Grid shows an "Import" pill with the value below
      expect(screen.getByText("Import")).toBeInTheDocument();
      expect(screen.getByText("200 W")).toBeInTheDocument();
    });

    it("shows ordinary home load without counting the charging vehicle twice", () => {
      const vehicle: ChargingVehicleFlow = {
        id: "friday",
        name: "F.R.I.D.A.Y.",
        chargePowerW: 4600,
        solarW: 4600,
        gridW: 0,
      };

      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({ homeConsumptionW: 5400 })}
          chargingVehicles={[vehicle]}
        />,
      );

      expect(screen.getByText("800 W")).toBeInTheDocument();
      expect(screen.queryByText("5.4 kW")).not.toBeInTheDocument();
    });
  });

  // ---- battery node ----

  describe("battery node", () => {
    it("shows battery node when batteryPowerW is not null", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({
            batteryPowerW: 1500,
            batterySoc: 72,
          })}
        />,
      );

      expect(screen.getByText("Battery")).toBeInTheDocument();
      expect(screen.getByText(/1\.5 kW/)).toBeInTheDocument();
      expect(screen.getByText(/72%/)).toBeInTheDocument();
      expect(screen.getByTestId("home-battery-icon"))
        .toHaveAttribute("data-fill", "72");
      expect(screen.getByTestId("home-battery-icon"))
        .toHaveAttribute("data-level", "medium");
    });

    it("changes the home battery icon with its state of charge", () => {
      const { rerender } = renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({ batteryPowerW: -1200, batterySoc: 18 })}
        />,
      );

      expect(screen.getByTestId("home-battery-icon"))
        .toHaveAttribute("data-level", "low");
      expect(screen.getByTestId("home-battery-icon"))
        .toHaveAttribute("data-charging", "true");

      rerender(
        <EnergyFlowDiagram
          data={makeEnergyData({ batteryPowerW: 800, batterySoc: 91 })}
        />,
      );
      expect(screen.getByTestId("home-battery-icon"))
        .toHaveAttribute("data-fill", "91");
      expect(screen.getByTestId("home-battery-icon"))
        .toHaveAttribute("data-level", "high");
    });

    it("shows every charging source flowing down into the battery", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({
            solarProductionW: 1800,
            gridPowerW: 600,
            batteryPowerW: -1200,
            batterySoc: 54,
          })}
        />,
      );

      expect(screen.getByTestId("flow-battery"))
        .toHaveAttribute("data-direction", "down");
      expect(screen.getByTestId("flow-battery"))
        .toHaveAttribute("data-sources", "solar grid");
      expect(screen.getByTestId("flow-battery"))
        .toHaveAttribute("data-source", "solar");
    });

    it("shows battery power without SOC when batterySoc is null", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({ batteryPowerW: 2000, batterySoc: null })}
        />,
      );

      expect(screen.getByText("Battery")).toBeInTheDocument();
      expect(screen.getByText("2.0 kW")).toBeInTheDocument();
    });

    it("hides battery node when batteryPowerW is null", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({ batteryPowerW: null })}
        />,
      );

      expect(screen.queryByText("Battery")).not.toBeInTheDocument();
    });
  });

  // ---- grid direction ----

  describe("grid direction", () => {
    it.each<[string, number, string]>([
      ["Export", -1500, "1.5 kW"],
      ["Import", 2000, "2.0 kW"],
    ])("shows %s when gridPowerW is %d", (label, gridPowerW, expected) => {
      renderWithProviders(
        <EnergyFlowDiagram data={makeEnergyData({ gridPowerW })} />,
      );

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it("animates import upward in red and export downward in green", () => {
      const { rerender } = renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({ solarProductionW: 0, gridPowerW: 800 })}
        />,
      );

      expect(screen.getByTestId("flow-grid")).toHaveAttribute(
        "data-direction",
        "up",
      );
      expect(screen.getByTestId("flow-grid")).toHaveAttribute(
        "data-source",
        "grid",
      );
      expect(screen.getByTestId("flow-grid").getAttribute("style"))
        .toContain(
          "--flow-color: var(--color-grid-import)",
        );

      rerender(
        <EnergyFlowDiagram
          data={makeEnergyData({ solarProductionW: 1800, gridPowerW: -600 })}
        />,
      );
      expect(screen.getByTestId("flow-grid")).toHaveAttribute(
        "data-direction",
        "down",
      );
      expect(screen.getByTestId("flow-grid")).toHaveAttribute(
        "data-source",
        "export",
      );
      expect(screen.getByTestId("flow-grid").getAttribute("style"))
        .toContain(
          "--flow-color: var(--color-grid-export)",
        );
    });

    it("uses real branch directions for solar, home, and the battery", () => {
      const { rerender } = renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({ batteryPowerW: -1200, batterySoc: 65 })}
        />,
      );

      expect(screen.getByTestId("flow-solar")).toHaveAttribute(
        "data-direction",
        "up",
      );
      expect(screen.getByTestId("flow-home")).toHaveAttribute(
        "data-direction",
        "down",
      );
      expect(screen.getByTestId("flow-battery")).toHaveAttribute(
        "data-direction",
        "down",
      );

      rerender(
        <EnergyFlowDiagram
          data={makeEnergyData({ batteryPowerW: 1200, batterySoc: 64 })}
        />,
      );
      expect(screen.getByTestId("flow-battery")).toHaveAttribute(
        "data-direction",
        "up",
      );
      expect(screen.getByTestId("flow-battery")).toHaveAttribute(
        "data-source",
        "battery",
      );
    });
  });

  // ---- charging vehicles ----

  describe("charging vehicles", () => {
    const mockVehicle: ChargingVehicleFlow = {
      id: "vehicle-1",
      name: "Model 3",
      chargePowerW: 7400,
      solarW: 5000,
      batteryW: 0,
      gridW: 2400,
    };

    it("renders a vehicle node when charging", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData()}
          chargingVehicles={[mockVehicle]}
        />,
      );

      expect(screen.getByText("Model 3")).toBeInTheDocument();
      expect(screen.getByText("7.4 kW")).toBeInTheDocument();
      expect(screen.getByText(/5\.0 kW solar/)).toBeInTheDocument();
      expect(screen.getByText(/2\.4 kW grid/)).toBeInTheDocument();
      expect(screen.getByTestId("vehicle-node-vehicle-1")).toBeInTheDocument();
      expect(screen.getByTestId("vehicle-silhouette-icon")).toBeInTheDocument();
      expect(screen.getByTestId("flow-vehicle-vehicle-1"))
        .toHaveAttribute("data-sources", "solar grid");
      expect(screen.getByTestId("flow-vehicle-vehicle-1"))
        .toHaveAttribute("data-source", "solar");
    });

    it("keeps solar, battery, and grid colors visible on a mixed charge", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData()}
          chargingVehicles={[{
            ...mockVehicle,
            solarW: 4000,
            batteryW: 1000,
            gridW: 2400,
          }]}
        />,
      );

      const branch = screen.getByTestId("flow-vehicle-vehicle-1");
      expect(branch).toHaveAttribute("data-stream-count", "3");
      expect(branch).toHaveAttribute("data-sources", "solar battery grid");
      expect(branch).toHaveAttribute("data-source", "solar");
    });

    it("renders no vehicle nodes when array is empty", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData()}
          chargingVehicles={[]}
        />,
      );

      expect(screen.queryByTestId(/vehicle-node-/)).not.toBeInTheDocument();
    });

    it("renders multiple vehicles stacked vertically", () => {
      const vehicles: ChargingVehicleFlow[] = [
        mockVehicle,
        {
          id: "vehicle-2",
          name: "Model Y",
          chargePowerW: 11000,
          solarW: 3000,
          gridW: 8000,
        },
      ];

      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData()}
          chargingVehicles={vehicles}
        />,
      );

      expect(screen.getByText("Model 3")).toBeInTheDocument();
      expect(screen.getByText("Model Y")).toBeInTheDocument();
      expect(screen.getByTestId("vehicle-node-vehicle-1")).toBeInTheDocument();
      expect(screen.getByTestId("vehicle-node-vehicle-2")).toBeInTheDocument();
      expect(screen.getAllByTestId("vehicle-silhouette-icon")).toHaveLength(2);
    });
  });
});
