import {
  BatteryCharging,
  CarFront,
  Database,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import styles from "./TeslaVehicleVisualDev.module.css";

type VisualConfig = {
  carType: string | null;
  exteriorColor: string | null;
  wheelType: string | null;
  trim: string | null;
  roofColor: string | null;
  spoilerType: string | null;
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

function VisualHero(
  {
    vehicleName,
    batteryLevel,
    chargeLimit,
    model,
  }: {
    vehicleName: string;
    batteryLevel: number | null;
    chargeLimit: number | null;
    model: string;
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
      <div className={styles.visualStage} aria-label="E.V. Solar vehicle preview">
        <div className={styles.glow} />
        <CarFront className={styles.carIcon} strokeWidth={1.35} />
        <span className={styles.visualBadge}>{model}</span>
      </div>
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
  const visualKey = config
    ? `tesla__${slugPart(config.carType)}__${slugPart(config.exteriorColor)}__${slugPart(config.wheelType)}`
    : null;
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
        <DataRow
          label="Source"
          value={config ? "Fleet API · vehicle_config" : null}
        />
      </article>
    </div>
  );
}

function SafetyNotice() {
  return (
    <div className={styles.notice}>
      <ShieldCheck size={20} />
      <div>
        <strong>No private vehicle render is used</strong>
        <p>
          The POC only reads documented Fleet API configuration data. Missing values
          remain marked as unavailable instead of being guessed.
        </p>
      </div>
    </div>
  );
}

export function TeslaVehicleVisualDev() {
  const vehiclesQuery = trpc.vehicle.list.useQuery();
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
      />
      <ProbePanel
        pending={configProbe.isPending}
        onTest={() => configProbe.mutate({ vin: vehicle.id })}
        errorMessage={errorMessage}
      />
      <ConfigPanels adapterType={vehicle.adapterType} config={config} />
      <SafetyNotice />
    </section>
  );
}
