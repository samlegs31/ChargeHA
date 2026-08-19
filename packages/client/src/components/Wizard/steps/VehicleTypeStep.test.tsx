import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { vehicleTypeStep } from "./VehicleTypeStep.tsx";
import { StepNextHarness } from "./test-helpers/StepNextHarness.tsx";

const { mockAdvance, mockDemoMutate, captured, mockVehicleList } = vi
  .hoisted(() => ({
    mockAdvance: vi.fn(),
    mockDemoMutate: vi.fn(),
    captured: { demoOnSuccess: undefined as (() => void) | undefined },
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
    useUtils: vi.fn(() => ({
      vehicle: { list: { invalidate: vi.fn() } },
    })),
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
      },
    },
    vehicle: {
      list: { useQuery: mockVehicleList },
    },
    wizard: {
      demoSetup: {
        useMutation: vi.fn((opts?: { onSuccess?: () => void }) => {
          captured.demoOnSuccess = opts?.onSuccess;
          return {
            mutate: mockDemoMutate,
            isPending: false,
            isError: false,
            error: null,
          };
        }),
      },
    },
  },
}));

const { mockIsDemoMode } = vi.hoisted(() => ({
  mockIsDemoMode: vi.fn(() => false),
}));

vi.mock("../../../lib/featureFlags.ts", async (orig) => {
  const actual = await orig() as typeof import("../../../lib/featureFlags.ts");
  return {
    ...actual,
    demoMode: { ...actual.demoMode, isActive: mockIsDemoMode },
  };
});

describe("VehicleTypeStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDemoMode.mockReturnValue(false);
    mockVehicleList.mockReturnValue({ data: { vehicles: [] } });
    captured.demoOnSuccess = undefined;
    mockDemoMutate.mockImplementation(() => {
      captured.demoOnSuccess?.();
    });
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
