import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import type { VehicleWithState } from "@chargeha/shared";
import { trpc } from "../../../trpc.ts";
import { useRouter } from "../../../hooks/useRouter.ts";
import { clearPluginOnboarding } from "../../../hooks/usePluginOnboardingState.ts";

function usePriorityMutation(utils: ReturnType<typeof trpc.useUtils>) {
  const priorityMutationRaw = trpc.vehicle.setPriority.useMutation();
  return useMutation({
    mutationFn: async (updates: Array<{ id: string; priority: number }>) => {
      await Promise.all(
        updates.map(({ id, priority }) =>
          priorityMutationRaw.mutateAsync({ vehicleId: id, priority })
        ),
      );
    },
    onSuccess: () => {
      utils.vehicle.list.invalidate();
    },
  });
}

function computePriorityUpdates(
  vehicles: VehicleWithState[],
  vin: string,
  direction: "up" | "down",
) {
  const sorted = [...vehicles].sort((a, b) => a.priority - b.priority);
  const idx = sorted.findIndex((v) => v.id === vin);
  if (idx < 0) return null;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sorted.length) return null;

  const temp = sorted[idx];
  sorted[idx] = sorted[swapIdx];
  sorted[swapIdx] = temp;

  return sorted
    .map((v, i) => ({ id: v.id, priority: i + 1 }))
    .filter((u, i) => sorted[i].priority !== u.priority);
}

export function useVehicleSettings() {
  const { navigate } = useRouter();

  const utils = trpc.useUtils();
  const vehiclesQuery = trpc.vehicle.list.useQuery(undefined, {
    select: (data) => data.vehicles as VehicleWithState[],
  });

  const vehicles = vehiclesQuery.data ?? [];

  // No onSuccess cache work: RealtimeSync handles vehicles_changed invalidation.
  const deleteMutation = trpc.vehicle.delete.useMutation();
  const priorityMutation = usePriorityMutation(utils);

  const handleDelete = (vin: string) =>
    deleteMutation.mutate({ vehicleId: vin });

  const handleMovePriority = (vin: string, direction: "up" | "down") => {
    const updates = computePriorityUpdates(vehicles, vin, direction);
    if (!updates || updates.length === 0) return;
    priorityMutation.mutate(updates);
  };

  const vehiclePluginsQuery = trpc.vehicle.getPlugins.useQuery();
  const vehiclePlugins = vehiclePluginsQuery.data ?? [];

  const handleStartOnboarding = useCallback((pluginId: string) => {
    clearPluginOnboarding(pluginId);
    navigate({ type: "pluginSetup", pluginId });
  }, [navigate]);

  const mutations = [deleteMutation, priorityMutation];
  const displayError = vehiclesQuery.error?.message ??
    mutations.find((m) => m.error)?.error?.message ?? null;

  return {
    vehicles,
    loading: vehiclesQuery.isPending,
    loadFailed: vehiclesQuery.isError,
    error: displayError,
    handleDelete,
    handleMovePriority,
    vehiclePlugins,
    handleStartOnboarding,
  };
}
