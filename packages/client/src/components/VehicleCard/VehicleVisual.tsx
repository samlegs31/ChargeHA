import { useState } from "react";
import type { VehicleChargeState } from "@chargeha/shared";
import { VehicleSilhouetteIcon } from "../icons/VehicleSilhouetteIcon.tsx";
import styles from "./VehicleVisual.module.css";

function normalizedKey(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[\s_-]/g, "");
}

export function vehicleImageSource(
  state: Pick<VehicleChargeState, "carType" | "exteriorColor" | "wheelType">,
): string | null {
  const key = [state.carType, state.exteriorColor, state.wheelType]
    .map(normalizedKey)
    .join("/");
  const images: Record<string, string> = {
    "model3/deepblue/stilettorefresh19":
      "/vehicles/model-3-deepblue-sport19.png",
    "modely/pearlwhite/induction20black":
      "/vehicles/model-y-pearlwhite-induction20.png",
  };
  return images[key] ?? null;
}

/** Local illustrative renders. Never infer a model or paint from a VIN/name. */
export function VehicleVisual({ state }: { state: VehicleChargeState }) {
  const source = vehicleImageSource(state);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const showImage = source !== null && failedSource !== source;

  return (
    <div className={styles.visual} data-testid="vehicle-visual">
      <div className={styles.stage}>
        {showImage && (
          <img
            src={source}
            width="1536"
            height="1024"
            alt="Configured vehicle illustration, three-quarter view"
            onError={() => setFailedSource(source)}
            decoding="async"
            draggable={false}
          />
        )}
        {!showImage && (
          <div
            className={styles.fallback}
            role="img"
            aria-label="Vehicle silhouette"
          >
            <VehicleSilhouetteIcon size={240} />
          </div>
        )}
      </div>
    </div>
  );
}
