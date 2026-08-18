import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useVehicleSettings } from "./useVehicleSettings.ts";

const {
  mockDeleteMutate,
  mockPriorityMutateAsync,
  mockInvalidateVehicleList,
  mockNavigate,
  mockClearPluginOnboarding,
  c,
  m,
} = vi.hoisted(() => ({
  mockDeleteMutate: vi.fn(),
  mockPriorityMutateAsync: vi.fn(),
  mockInvalidateVehicleList: vi.fn(),
  mockNavigate: vi.fn(),
  mockClearPluginOnboarding: vi.fn(),
  c: {
    priorityMutationOpts: {} as {
      mutationFn?: (
        updates: Array<{ id: string; priority: number }>,
      ) => Promise<void>;
      onSuccess?: () => void;
    },
  },
  m: {
    vehiclesData: undefined as unknown,
    vehiclesPending: false,
    vehiclesError: null as { message: string } | null,
    vehiclesIsError: false,
    pluginsData: undefined as unknown[] | undefined,
    deleteError: null as { message: string } | null,
    priorityError: null as { message: string } | null,
  },
}));

vi.mock("../../../hooks/useRouter.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../hooks/useRouter.ts")
  >();
  return {
    ...actual,
    useRouter: () => ({ navigate: mockNavigate }),
  };
});

vi.mock("../../../hooks/usePluginOnboardingState.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../hooks/usePluginOnboardingState.ts")
  >();
  return {
    ...actual,
    clearPluginOnboarding: mockClearPluginOnboarding,
  };
});

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useUtils: () => ({
      vehicle: {
        list: { invalidate: mockInvalidateVehicleList },
      },
    }),
    vehicle: {
      list: {
        useQuery: vi.fn((
          _input: unknown,
          opts?: { select?: (data: unknown) => unknown },
        ) => ({
          data: (() => {
            if (!m.vehiclesData) return undefined;
            return opts?.select ? opts.select(m.vehiclesData) : m.vehiclesData;
          })(),
          isPending: m.vehiclesPending,
          isError: m.vehiclesIsError,
          error: m.vehiclesError,
        })),
      },
      delete: {
        useMutation: vi.fn(() => ({
          mutate: mockDeleteMutate,
          error: m.deleteError,
        })),
      },
      setPriority: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockPriorityMutateAsync,
        })),
      },
      getPlugins: {
        useQuery: vi.fn(() => ({
          data: m.pluginsData,
        })),
      },
    },
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: vi.fn((opts: {
      mutationFn: (
        updates: Array<{ id: string; priority: number }>,
      ) => Promise<void>;
      onSuccess?: () => void;
    }) => {
      c.priorityMutationOpts = opts;
      return {
        mutate: vi.fn((updates: Array<{ id: string; priority: number }>) => {
          void opts.mutationFn(updates);
        }),
        error: m.priorityError,
      };
    }),
  };
});

describe("useVehicleSettings", () => {
  beforeEach(() => {
    m.vehiclesData = undefined;
    m.vehiclesPending = false;
    m.vehiclesError = null;
    m.vehiclesIsError = false;
    m.pluginsData = undefined;
    m.deleteError = null;
    m.priorityError = null;
    c.priorityMutationOpts = {};
    mockDeleteMutate.mockClear();
    mockPriorityMutateAsync.mockClear();
    mockInvalidateVehicleList.mockClear();
    mockNavigate.mockClear();
    mockClearPluginOnboarding.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("returns loading state when vehicles query is pending", () => {
    m.vehiclesPending = true;
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.loading).toBe(true);
  });

  it("returns empty vehicles when no data", () => {
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.vehicles).toEqual([]);
  });

  it("returns vehicles from query", () => {
    m.vehiclesData = {
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
      ],
    };
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.vehicles[0].id).toBe("VIN1");
  });

  it("handleDelete calls delete mutation", () => {
    const { result } = renderHook(() => useVehicleSettings());
    result.current.handleDelete("VIN1");
    expect(mockDeleteMutate).toHaveBeenCalledWith({ vehicleId: "VIN1" });
  });

  it("handleMovePriority swaps vehicles up via priority mutationFn", () => {
    m.vehiclesData = {
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
        { id: "VIN2", name: "Model Y", adapterType: "tesla", priority: 2 },
      ],
    };
    const { result } = renderHook(() => useVehicleSettings());
    result.current.handleMovePriority("VIN2", "up");
    expect(mockPriorityMutateAsync).toHaveBeenCalled();
  });

  it.each<[string, string, "up" | "down"]>([
    ["invalid vin", "NONEXISTENT", "up"],
    ["first vehicle up", "VIN1", "up"],
    ["last vehicle down", "VIN2", "down"],
  ])("handleMovePriority ignores %s", (_label, vin, direction) => {
    m.vehiclesData = {
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
        { id: "VIN2", name: "Model Y", adapterType: "tesla", priority: 2 },
      ],
    };
    const { result } = renderHook(() => useVehicleSettings());
    result.current.handleMovePriority(vin, direction);
    expect(mockPriorityMutateAsync).not.toHaveBeenCalled();
  });

  it("returns loadFailed when query errors", () => {
    m.vehiclesIsError = true;
    m.vehiclesError = { message: "Network error" };
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.loadFailed).toBe(true);
  });

  it("returns display error from vehicle query", () => {
    m.vehiclesError = { message: "Network error" };
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.error).toBe("Network error");
  });

  it("returns vehiclePlugins from query", () => {
    m.pluginsData = [
      { id: "tesla", displayName: "Tesla", configured: true },
    ];
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.vehiclePlugins).toHaveLength(1);
  });

  it("returns empty vehiclePlugins when no data", () => {
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.vehiclePlugins).toEqual([]);
  });

  it("handleStartOnboarding clears state and navigates to setup route", () => {
    const { result } = renderHook(() => useVehicleSettings());

    result.current.handleStartOnboarding("tesla");

    expect(mockClearPluginOnboarding).toHaveBeenCalledWith("tesla");
    expect(mockNavigate).toHaveBeenCalledWith({
      type: "pluginSetup",
      pluginId: "tesla",
    });
  });
});
