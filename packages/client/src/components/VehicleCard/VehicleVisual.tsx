import { useState } from "react";
import type { VehicleChargeState } from "@chargeha/shared";
import { VehicleSilhouetteIcon } from "../icons/VehicleSilhouetteIcon.tsx";
import styles from "./VehicleVisual.module.css";

const MODELS: Record<string, string> = {
  modely: "Model Y",
  model3: "Model 3",
  models: "Model S",
  modelx: "Model X",
  cybertruck: "Cybertruck",
};

function modelKey(value?: string | null) {
  return (value ?? "").toLowerCase().replace(/[\s_-]/g, "");
}

export function vehicleModelLabel(value?: string | null) {
  return MODELS[modelKey(value)] ?? value ?? "Electric vehicle";
}

export function vehicleImageSource(
  state: Pick<VehicleChargeState, "carType" | "exteriorColor" | "wheelType">,
) {
  const key = [state.carType, state.exteriorColor, state.wheelType].map(
    modelKey,
  ).join("/");
  const images: Record<string, string> = {
    "model3/deepblue/stilettorefresh19":
      "/vehicles/model-3-deepblue-sport19.png",
    "modely/pearlwhite/induction20black":
      "/vehicles/model-y-pearlwhite-induction20.png",
  };
  return images[key] ?? null;
}

function readableConfig(value?: string | null) {
  const labels: Record<string, string> = {
    DeepBlue: "Deep Blue",
    PearlWhite: "Pearl White",
    StilettoRefresh19: "19″ Sport",
    Induction20Black: "20″ Induction",
  };
  if (value && labels[value]) return labels[value];
  return value?.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

/** Local illustrative renders. Never infer a model or paint from a vehicle name. */
export function VehicleVisual({ state }: { state: VehicleChargeState }) {
  const source = vehicleImageSource(state);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const showImage = source !== null && failedSource !== source;
  const configuration = [
    readableConfig(state.exteriorColor),
    readableConfig(state.wheelType),
  ].filter(Boolean).join(" · ");

  return (
    <div className={styles.visual} data-testid="vehicle-visual">
      <div className={styles.stage}>
        {showImage && (
          <img
            src={source}
            width="1536"
            height="1024"
            alt={`${
              vehicleModelLabel(state.carType)
            } illustration, three-quarter view`}
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
      <div className={styles.caption}>
        <span>{configuration}</span>
        {showImage && <span>Illustration</span>}
      </div>
    </div>
  );
}

export function VehicleThumbnail({ state }: { state: VehicleChargeState }) {
  const source = vehicleImageSource(state);
  const [failed, setFailed] = useState<string | null>(null);
  if (!source || source === failed) return <VehicleSilhouetteIcon size={46} />;
  return (
    <img
      src={source}
      width="96"
      height="64"
      alt=""
      onError={() => setFailed(source)}
      decoding="async"
      className={styles.thumbnail}
    />
  );
}
