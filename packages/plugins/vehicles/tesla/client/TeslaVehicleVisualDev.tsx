import { useState } from "react";
import {
  BatteryCharging,
  CarFront,
  Database,
  Loader2,
  Rotate3D,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import styles from "./TeslaVehicleVisualDev.module.css";

type VisualProvider = {
  provider: string | null;
  imageUrl: string | null;
  spinBaseUrl: string | null;
  paintCode: string | null;
  modelYear: number | null;
  note: string;
};

type VisualConfig = {
  carType: string | null;
  exteriorColor: string | null;
  wheelType: string | null;
  trim: string | null;
  roofColor: string | null;
  spoilerType: string | null;
  visual: VisualProvider;
};

function readableModel(carType?: string | null): string {
  if (!carType) return "Not tested";
  const normalized = carType.toLowerCase().replace(/[\s_-]/g, "");
  const labels: Record<string, string> = {
    models: "Model S",
    model3: "Model 3",
    modelx: "Model X",
    modely: "Model Y",
    cybertruck: "Cybertruck",
  };
  return labels[normalized] ?? carType;
}

function slugPart(value?: string | null): string {
  if (!value) return "unknown";
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "unknown";
}

function visualMappingKey(config: VisualConfig | null): string | null {
  if (!config) return null;
  return [
    "tesla",
    slugPart(config.carType),
    slugPart(config.exteriorColor),
    slugPart(config.wheelType),
  ].join("__");
}

function DataRow(
  { label, value }: { label: string; value?: string | number | null },
) {
  const available = value !== null && value !== undefined && value !== "";
  return (
    <div className={styles.dataRow}>
      <span>{label}</span>
      <strong className={available ? undefined : styles.unavailable}>
        {available ? value : "Not available"}
      </strong>
    </div>
  );
}

function spinImageUrl(baseUrl: string | null | undefined, frame: number) {
  return baseUrl ? `${baseUrl}&angle=${200 + frame}` : null;
}

function availableImageUrl(
  preferredUrl: string | null,
  staticUrl: string | null,
  failedUrls: string[],
): string | null {
  if (preferredUrl && !failedUrls.includes(preferredUrl)) return preferredUrl;
  if (staticUrl && !failedUrls.includes(staticUrl)) return staticUrl;
  return null;
}

function VehiclePreview(
  { model, visual }: { model: string; visual: VisualProvider | null },
) {
  const [spinFrame, setSpinFrame] = useState(0);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const staticUrl = visual?.imageUrl ?? null;
  const spinUrl = spinImageUrl(visual?.spinBaseUrl, spinFrame);
  const imageUrl = availableImageUrl(spinUrl ?? staticUrl, staticUrl, failedUrls);
  const is360 = visual?.spinBaseUrl !== null && visual?.spinBaseUrl !== undefined;

  const markFailed = () => {
    if (!imageUrl || failedUrls.includes(imageUrl)) return;
    setFailedUrls((urls) => [...urls, imageUrl]);
  };

  return (
    <div className={styles.visualStage} aria-label="E.V. Solar vehicle preview">
      <div className={styles.glow} />
      <CarFront className={styles.carIcon} strokeWidth={1.35} />
      {imageUrl && (
        <img
          className={styles.vehicleRender}
          src={imageUrl}
          alt={`${model} vehicle render`}
          onError={markFailed}
          draggable={false}
        />
      )}
      <span className={styles.visualBadge}>
        {is360 ? "360° · " : ""}{visual?.provider ?? "Local fallback"}
      </span>
      {is360 && imageUrl && (
        <label className={styles.spinControl}>
          <span><Rotate3D size={15} /> Rotate vehicle</span>
          <input
            type="range"
            min="0"
            max="31"
            step="1"
            value={spinFrame}
            onChange={(event) => setSpinFrame(Number(event.currentTarget.value))}
            aria-label="Rotate vehicle 360 degrees"
          />
        </label>
      )}
    </div>
  );
}

function VisualHero(
  {
    vehicleName,
    batteryLevel,
    chargeLimit,
    model,
    visual,
  }: {
    vehicleName: string;
    batteryLevel: number | null;
    chargeLimit: number | null;
    model: string;
    visual: VisualProvider | null;
  },
) {
  const batteryLabel = batteryLevel === null ? "—" : `${batteryLevel} %`;
  const limitLabel = chargeLimit === null ? "Not available" : `${chargeLimit} %`;
  const batteryWidth = Math.max(0, Math.min(100, batteryLevel ?? 0));
  return (
    <div className={styles.hero}>
      <div className={styles.identity}>
        <div className={styles.brandMark}>T</div>
        <div>
          <p className={styles.eyebrow}>TESLA</p>
          <h1>{vehicleName}</h1>
          <p className={styles.model}>{model}</p>
        </div>
      </div>
      <VehiclePreview model={model} visual={visual} />
      <div className={styles.socBlock}>
        <div>
          <span>Vehicle battery</span>
          <strong>{batteryLabel}</strong>
        </div>
        <BatteryCharging size={25} />
      </div>
      <div className={styles.batteryTrack} aria-hidden="true">
        <span style={{ width: `${batteryWidth}%` }} />
      </div>
      <div className={styles.limitLine}>
        <span>Charge limit</span>
        <strong>{limitLabel}</strong>
      </div>
    </div>
  );
}

function ProbePanel(
  {
    pending,
    onTest,
    errorMessage,
  }: {
    pending: boolean;
    onTest: () => void;
    errorMessage: string | null;
  },
) {
  const buttonLabel = pending ? "Reading configuration…" : "Test vehicle_config";
  return (
    <div className={styles.probePanel}>
      <div>
        <strong>Official Fleet API configuration</strong>
        <p>
          Manual one-shot read. It does not send a wake command and does not poll in
          the background.
        </p>
      </div>
      <Button onClick={onTest} disabled={pending}>
        {pending && <Loader2 size={15} className={styles.spinner} />}
        {buttonLabel}
      </Button>
      {errorMessage && <div className={styles.probeError}>{errorMessage}</div>}
    </div>
  );
}

function ConfigPanels(
  {
    adapterType,
    config,
  }: {
    adapterType: string;
    config: VisualConfig | null;
  },
) {
  const visualKey = visualMappingKey(config);
  return (
    <div className={styles.grid}>
      <article className={styles.panel}>
        <h2><Database size={18} /> Detected configuration</h2>
        <DataRow label="Model / CarType" value={config?.carType} />
        <DataRow label="Exterior color" value={config?.exteriorColor} />
        <DataRow label="Wheels / WheelType" value={config?.wheelType} />
        <DataRow label="Trim" value={config?.trim} />
        <DataRow label="Roof" value={config?.roofColor} />
        <DataRow label="Spoiler" value={config?.spoilerType} />
      </article>
      <article className={styles.panel}>
        <h2><CarFront size={18} /> Visual mapping</h2>
        <DataRow label="E.V. Solar key" value={visualKey} />
        <DataRow label="Adapter" value={adapterType} />
        <DataRow label="Render provider" value={config?.visual.provider} />
        <DataRow label="Tesla paint code" value={config?.visual.paintCode} />
        <DataRow label="Model year" value={config?.visual.modelYear} />
        <DataRow
          label="360° spin"
          value={config?.visual.spinBaseUrl ? "Enabled" : "Not enabled"}
        />
        <DataRow label="Provider note" value={config?.visual.note} />
      </article>
    </div>
  );
}

function SafetyNotice({ provider }: { provider?: string | null }) {
  return (
    <div className={styles.notice}>
      <ShieldCheck size={20} />
      <div>
        <strong>{provider ? "Licensed visual provider enabled" : "Safe fallback active"}</strong>
        <p>
          E.V. Solar does not use Tesla private app assets. External renders are loaded
          directly from the configured licensed CDN; the local vehicle icon remains as
          a fallback if no provider is configured or an image cannot be served.
        </p>
      </div>
    </div>
  );
}

export function TeslaVehicleVisualDev() {
  const vehiclesQuery = trpc.plugin.vehicle.tesla.listVehicles.useQuery();
  const configProbe = trpc.plugin.vehicle.tesla.vehicleVisualConfig.useMutation();
  const vehicles = vehiclesQuery.data?.vehicles ?? [];
  const vehicle = vehicles.find((item) => item.adapterType === "tesla");

  if (vehiclesQuery.isLoading) {
    return <div className={styles.stateMessage}>Loading vehicle data…</div>;
  }
  if (vehiclesQuery.error) {
    return (
      <div className={styles.stateMessage}>
        Unable to load vehicles: {vehiclesQuery.error.message}
      </div>
    );
  }
  if (!vehicle) {
    return <div className={styles.stateMessage}>No Tesla vehicle is configured.</div>;
  }

  const config = configProbe.data ?? null;
  const state = vehicle.state;
  const model = readableModel(config?.carType);
  const errorMessage = configProbe.error?.message ?? null;
  return (
    <section className={styles.page}>
      <div className={styles.kicker}><Sparkles size={15} /> POC · Vehicle visual</div>
      <VisualHero
        vehicleName={state?.vehicleName || vehicle.name}
        batteryLevel={state?.batteryLevel ?? null}
        chargeLimit={state?.chargeLimit ?? null}
        model={model}
        visual={config?.visual ?? null}
      />
      <ProbePanel
        pending={configProbe.isPending}
        onTest={() => configProbe.mutate({ vin: vehicle.id })}
        errorMessage={errorMessage}
      />
      <ConfigPanels adapterType={vehicle.adapterType} config={config} />
      <SafetyNotice provider={config?.visual.provider} />
    </section>
  );
}
