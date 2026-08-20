import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { VehicleSettings } from "./VehicleSettings.tsx";
import {
  pluginSettingsComponents,
  vehiclePluginSteps,
} from "@chargeha/plugins/componentRegistry";

const { makeHookReturn, hookRef } = vi.hoisted(() => {
  const make = (overrides: Record<string, unknown> = {}) => ({
    vehicles: [] as Array<{
      id: string;
      name: string;
      adapterType: string;
      priority: number;
    }>,
    loading: false,
    loadFailed: false,
    error: null as string | null,
    handleDelete: vi.fn(),
    handleMovePriority: vi.fn(),
    handleHomeChargingSource: vi.fn(),
    homeSourcePending: false,
    vehiclePlugins: [] as Array<{
      id: string;
      displayName: string;
      configured: boolean;
      settingsComponentKey?: string;
    }>,
    handleStartOnboarding: vi.fn(),
    ...overrides,
  });
  return {
    makeHookReturn: make,
    hookRef: { current: make() },
  };
});

vi.mock("./useVehicleSettings.ts", () => ({
  useVehicleSettings: () => hookRef.current,
}));

vi.mock("./SettingsLayout.tsx", () => ({
  SettingsSection: (
    { children, title }: { children: React.ReactNode; title: string },
  ) => (
    <div data-testid="settings-section">
      <h3>{title}</h3>
      {children}
    </div>
  ),
  SettingsRow: (
    { children, label }: { children: React.ReactNode; label: string },
  ) => (
    <div>
      <label>{label}</label>
      {children}
    </div>
  ),
}));

const { mockChargingMutate } = vi.hoisted(() => ({
  mockChargingMutate: vi.fn(),
}));
vi.mock("../../../hooks/useSectionConfig.ts", () => ({
  useChargingConfig: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
  useChargingConfigMutation: vi.fn(() => ({
    mutate: mockChargingMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    saveStatus: { state: "idle", tick: 0 },
  })),
}));

vi.mock("@chargeha/plugins/componentRegistry", () => ({
  pluginSettingsComponents: {} as Record<string, React.FC>,
  vehiclePluginSteps: {} as Record<string, unknown[]>,
  vehiclePluginOptions: [] as Array<{ id: string; demoAvailable?: boolean }>,
}));

describe("VehicleSettings", () => {
  beforeEach(() => {
    hookRef.current = makeHookReturn();
  });

  afterEach(() => {
    cleanup();
    Object.keys(pluginSettingsComponents).forEach((key) => {
      delete (pluginSettingsComponents as Record<string, unknown>)[key];
    });
    Object.keys(vehiclePluginSteps).forEach((key) => {
      delete (vehiclePluginSteps as Record<string, unknown>)[key];
    });
  });

  it("renders loading state", () => {
    hookRef.current = makeHookReturn({ loading: true });
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByText("Loading cars...")).toBeInTheDocument();
  });

  it("renders empty state when no vehicles", () => {
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByText("No cars connected yet.")).toBeInTheDocument();
  });

  it("renders load failed message", () => {
    hookRef.current = makeHookReturn({ loadFailed: true });
    renderWithProviders(<VehicleSettings />);
    expect(
      screen.getByText(/Could not load cars/),
    ).toBeInTheDocument();
  });

  it("renders error card when error present", () => {
    hookRef.current = makeHookReturn({ error: "Something went wrong" });
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders vehicle list", () => {
    hookRef.current = makeHookReturn({
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
      ],
    });
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByText("Model 3")).toBeInTheDocument();
    expect(screen.getByText("VIN1")).toBeInTheDocument();
    expect(screen.getByText("tesla")).toBeInTheDocument();
    expect(screen.getByText("Old home charges")).toBeInTheDocument();
  });

  it("renders car-order controls when multiple vehicles", () => {
    hookRef.current = makeHookReturn({
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
        { id: "VIN2", name: "Model Y", adapterType: "tesla", priority: 2 },
      ],
    });
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByText("Car #1")).toBeInTheDocument();
    expect(screen.getByText("Car #2")).toBeInTheDocument();
    expect(
      screen.getByText(/Use the arrows to choose which car is #1/),
    ).toBeInTheDocument();
  });

  it("does not render car order for single vehicle", () => {
    hookRef.current = makeHookReturn({
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
      ],
    });
    renderWithProviders(<VehicleSettings />);
    expect(screen.queryByText("Car #1")).not.toBeInTheDocument();
  });

  it("calls handleDelete when delete button clicked", () => {
    const handleDelete = vi.fn();
    hookRef.current = makeHookReturn({
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
      ],
      handleDelete,
    });
    renderWithProviders(<VehicleSettings />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Model 3" }));

    expect(handleDelete).toHaveBeenCalledWith("VIN1");
  });

  it("calls handleMovePriority when order button clicked", () => {
    const handleMovePriority = vi.fn();
    hookRef.current = makeHookReturn({
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
        { id: "VIN2", name: "Model Y", adapterType: "tesla", priority: 2 },
      ],
      handleMovePriority,
    });
    renderWithProviders(<VehicleSettings />);

    fireEvent.click(screen.getByRole("button", { name: "Move Model 3 down" }));

    expect(handleMovePriority).toHaveBeenCalledWith("VIN1", "down");
  });

  it("does not expose simulated vehicle controls", () => {
    renderWithProviders(<VehicleSettings />);
    expect(screen.queryByText("Simulated Vehicle")).not.toBeInTheDocument();
    expect(screen.queryByText("Add Simulated Vehicle")).not.toBeInTheDocument();
  });

  it("renders unconfigured plugin with connect button", () => {
    const handleStartOnboarding = vi.fn();
    (vehiclePluginSteps as Record<string, unknown[]>)["tesla"] = [
      { id: "step1" },
    ];
    hookRef.current = makeHookReturn({
      vehiclePlugins: [
        { id: "tesla", displayName: "Tesla", configured: false },
      ],
      handleStartOnboarding,
    });
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByText("Tesla")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Connect Tesla/));
    expect(handleStartOnboarding).toHaveBeenCalledWith("tesla");
  });

  it("does not render connect button for configured plugins", () => {
    hookRef.current = makeHookReturn({
      vehiclePlugins: [
        { id: "tesla", displayName: "Tesla", configured: true },
      ],
    });
    renderWithProviders(<VehicleSettings />);
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
  });

  it("renders plugin settings component for configured plugin", () => {
    const MockPluginSettings = () => (
      <div data-testid="plugin-settings">Plugin Settings</div>
    );
    (pluginSettingsComponents as Record<string, React.FC>)["teslaSettings"] =
      MockPluginSettings;
    hookRef.current = makeHookReturn({
      vehiclePlugins: [
        {
          id: "tesla",
          displayName: "Tesla",
          configured: true,
          settingsComponentKey: "teslaSettings",
        },
      ],
    });
    renderWithProviders(<VehicleSettings />);
    expect(screen.getByTestId("plugin-settings")).toBeInTheDocument();
  });
});
