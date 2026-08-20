import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { inverterTypeStep } from "./InverterTypeStep.tsx";
import { StepNextHarness } from "./test-helpers/StepNextHarness.tsx";

const { mockMutate, mockAdvance, mockEquipmentGet } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockAdvance: vi.fn(),
  mockEquipmentGet: vi.fn(() => ({
    data: {} as { energyAdapterType?: string },
    isLoading: false,
    error: null,
  })),
}));

vi.mock("../../../hooks/useWizardState.ts", () => ({
  useWizardState: vi.fn(() => ({
    state: { stepId: "inverter-type", vehicleType: "", energyType: "" },
    patch: vi.fn(),
    isLoading: false,
  })),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useUtils: vi.fn(() => ({
      config: {
        equipment: { get: { invalidate: vi.fn() } },
      },
    })),
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
      },
    },
    config: {
      equipment: {
        get: {
          useQuery: mockEquipmentGet,
        },
        set: {
          useMutation: vi.fn(() => ({
            mutate: mockMutate,
            mutateAsync: vi.fn(),
            isPending: false,
            isSuccess: false,
            isError: false,
            error: null,
            data: undefined,
            reset: vi.fn(),
          })),
        },
      },
    },
  },
}));

describe("InverterTypeStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEquipmentGet.mockReturnValue({
      data: {},
      isLoading: false,
      error: null,
    });
    mockMutate.mockImplementation(
      (_input: unknown, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      },
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Fronius Local, Solar.web Account and None/Skip", () => {
    renderWithProviders(
      <StepNextHarness def={inverterTypeStep} onAdvance={mockAdvance} />,
    );

    expect(screen.getByText("Fronius (Local)")).toBeInTheDocument();
    expect(
      screen.getByText("Fronius (Solar.web Account)"),
    ).toBeInTheDocument();
    expect(screen.getByText("None / Skip")).toBeInTheDocument();
  });

  it("selecting None persists an empty adapter type and advances", async () => {
    renderWithProviders(
      <StepNextHarness def={inverterTypeStep} onAdvance={mockAdvance} />,
    );

    fireEvent.click(screen.getByText("None / Skip"));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        { energyAdapterType: "" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    expect(mockAdvance).toHaveBeenCalledWith({ energyType: "" });
  });

  it.each<[string, string]>([
    ["Fronius (Local)", "fronius_local"],
    ["Fronius (Solar.web Account)", "fronius_cloud"],
  ])(
    "selecting %s persists adapter %s and commits it without naming a next step",
    async (label, adapterType) => {
      renderWithProviders(
        <StepNextHarness def={inverterTypeStep} onAdvance={mockAdvance} />,
      );

      fireEvent.click(screen.getByText(label));

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          { energyAdapterType: adapterType },
          expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
      });

      expect(mockAdvance).toHaveBeenCalledWith({ energyType: adapterType });
    },
  );

  it("Next commits the saved adapter type when the wizard state has none", async () => {
    mockEquipmentGet.mockReturnValue({
      data: { energyAdapterType: "fronius_local" },
      isLoading: false,
      error: null,
    });
    renderWithProviders(
      <StepNextHarness def={inverterTypeStep} onAdvance={mockAdvance} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));

    await waitFor(() => {
      expect(mockAdvance).toHaveBeenCalledWith({ energyType: "fronius_local" });
    });
  });

  it("does not advance when persisting the adapter fails", () => {
    mockMutate.mockImplementation(() => {});
    renderWithProviders(
      <StepNextHarness def={inverterTypeStep} onAdvance={mockAdvance} />,
    );

    fireEvent.click(screen.getByText("Fronius (Local)"));

    expect(mockMutate).toHaveBeenCalled();
    expect(mockAdvance).not.toHaveBeenCalled();
  });
});
