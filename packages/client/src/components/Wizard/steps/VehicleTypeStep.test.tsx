import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { vehicleTypeStep } from "./VehicleTypeStep.tsx";
import { StepNextHarness } from "./test-helpers/StepNextHarness.tsx";

const { mockAdvance, mockVehicleList } = vi
  .hoisted(() => ({
    mockAdvance: vi.fn(),
    mockVehicleList: vi.fn(() => ({
      data: { vehicles: [] as { adapterType: string }[] },
    })),
  }));

vi.mock("../../../hooks/useWizardState.ts", () => ({
  useWizardState: vi.fn(() => ({
    state: { stepId: "vehicle-type", vehicleType: "", energyType: "" },
    patch: vi.fn(),
    isLoading: false,
  })),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
      },
    },
    vehicle: {
      list: { useQuery: mockVehicleList },
    },
  },
}));

describe("VehicleTypeStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVehicleList.mockReturnValue({ data: { vehicles: [] } });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Tesla as the only production vehicle option", () => {
    renderWithProviders(
      <StepNextHarness def={vehicleTypeStep} onAdvance={mockAdvance} />,
    );

    expect(screen.getByRole("button", { name: /Tesla/ })).toBeInTheDocument();
    expect(screen.getByText(/Tesla Fleet API/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Simulated/ })).not
      .toBeInTheDocument();
    expect(screen.queryByText(/virtual vehicle for testing/)).not
      .toBeInTheDocument();
  });

  it("selecting Tesla commits the selection without naming a next step", () => {
    renderWithProviders(
      <StepNextHarness def={vehicleTypeStep} onAdvance={mockAdvance} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Tesla/ }));

    expect(mockAdvance).toHaveBeenCalledWith({ vehicleType: "tesla" });
  });

  it("Next commits the existing vehicle type when the wizard state has none", async () => {
    mockVehicleList.mockReturnValue({
      data: { vehicles: [{ adapterType: "tesla" }] },
    });
    renderWithProviders(
      <StepNextHarness def={vehicleTypeStep} onAdvance={mockAdvance} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));

    await waitFor(() => {
      expect(mockAdvance).toHaveBeenCalledWith({ vehicleType: "tesla" });
    });
  });
});
