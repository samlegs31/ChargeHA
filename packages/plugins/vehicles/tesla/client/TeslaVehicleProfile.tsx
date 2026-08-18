import { useEffect, useId, useMemo, useState } from "react";
import { trpc } from "./trpc.ts";
import {
  resolveTeslaVisualSpec,
  type TeslaVisualConfig,
} from "./TeslaVehicleVisualCatalog.ts";
import { TeslaVehicleSilhouette } from "./TeslaVehicleSilhouette.tsx";

interface TeslaVehicleProfileProps {
  vehicleId: string;
  isOnline?: boolean;
}

const CACHE_PREFIX = "evsolar:tesla-visual:";
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

type CachedVisualConfig = {
  savedAt: number;
  config: TeslaVisualConfig;
};

function readCachedConfig(vehicleId: string): TeslaVisualConfig | null {
  if (!("localStorage" in globalThis)) return null;
  try {
    const raw = globalThis.localStorage.getItem(`${CACHE_PREFIX}${vehicleId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedVisualConfig;
    if (Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) return null;
    return parsed.config;
  } catch (error) {
    console.debug("Unable to read cached Tesla visual config", error);
    return null;
  }
}

function writeCachedConfig(vehicleId: string, config: TeslaVisualConfig): void {
  if (!("localStorage" in globalThis)) return;
  try {
    const payload: CachedVisualConfig = { savedAt: Date.now(), config };
    globalThis.localStorage.setItem(`${CACHE_PREFIX}${vehicleId}`, JSON.stringify(payload));
  } catch (error) {
    console.debug("Unable to cache Tesla visual config", error);
  }
}

export function TeslaVehicleProfile(
  { vehicleId, isOnline = true }: TeslaVehicleProfileProps,
) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [cachedConfig, setCachedConfig] = useState<TeslaVisualConfig | null>(() =>
    readCachedConfig(vehicleId)
  );
  const configQuery = trpc.plugin.vehicle.tesla.vehicleVisualConfigAuto.useQuery(
    { vin: vehicleId },
    {
      enabled: isOnline,
      retry: false,
      staleTime: 24 * 60 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

  useEffect(() => {
    if (!configQuery.data) return;
    setCachedConfig(configQuery.data);
    writeCachedConfig(vehicleId, configQuery.data);
  }, [configQuery.data, vehicleId]);

  const config = configQuery.data ?? cachedConfig;
  const spec = useMemo(
    () => resolveTeslaVisualSpec(vehicleId, config),
    [vehicleId, config],
  );

  return <TeslaVehicleSilhouette spec={spec} idPrefix={`tesla-${id}`} />;
}
