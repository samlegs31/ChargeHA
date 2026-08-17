import {
  BatteryCharging,
  CarFront,
  Database,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo } from "react";
import { useVehicles } from "../../../hooks/useVehicles.ts";
import { trpc } from "../../../trpc.ts";
import styles from "./VehicleVisualDev.module.css";

function readableModel(carType?: string | null): string {
  if (!carType) return "Non disponible";
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

function DataRow({ label, value }: { label: string; value?: string | number | null }) {
  const available = value !== null && value !== undefined && value !== "";
  return (
    <div className={styles.dataRow}>
      <span>{label}</span>
      <strong className={available ? undefined : styles.unavailable}>
        {available ? value : "Non disponible"}
      </strong>
    </div>
  );
}

export function VehicleVisualDev() {
  const { vehicles, loading, error } = useVehicles();
  const vehicle = vehicles.find((item) => item.adapterType === "tesla") ?? vehicles[0];
  const state = vehicle?.state;
  const configProbe = trpc.plugin.vehicle.tesla.vehicleVisualConfig.useMutation();
  const config = configProbe.data;

  const model = readableModel(config?.carType);
  const visualKey = useMemo(
    () => [
      "tesla",
      slugPart(config?.carType),
      slugPart(config?.exteriorColor),
      slugPart(config?.wheelType),
      slugPart(config?.trim),
    ].join("__"),
    [config?.carType, config?.exteriorColor, config?.wheelType, config?.trim],
  );

  if (loading) {
    return <div className={styles.stateMessage}>Chargement des données véhicule…</div>;
  }

  if (error) {
    return <div className={styles.stateMessage}>Impossible de charger les véhicules : {error}</div>;
  }

  if (!vehicle) {
    return <div className={styles.stateMessage}>Aucun véhicule configuré.</div>;
  }

  const isTesla = vehicle.adapterType === "tesla";
  const runProbe = () => {
    if (!isTesla || configProbe.isPending) return;
    configProbe.mutate({ vin: vehicle.id });
  };

  return (
    <section className={styles.page}>
      <div className={styles.kicker}><Sparkles size={15} /> POC · Vehicle visual</div>
      <div className={styles.hero}>
        <div className={styles.identity}>
          <div className={styles.brandMark}>T</div>
          <div>
            <p className={styles.eyebrow}>TESLA</p>
            <h1>{state?.vehicleName || vehicle.name}</h1>
            <p className={styles.model}>{model}</p>
          </div>
        </div>

        <div className={styles.visualStage} aria-label="Aperçu visuel E.V. Solar du véhicule">
          <div className={styles.glow} />
          <CarFront className={styles.carIcon} strokeWidth={1.35} />
          <span className={styles.visualBadge}>{model}</span>
        </div>

        <div className={styles.socBlock}>
          <div>
            <span>Batterie véhicule</span>
            <strong>{state ? `${state.batteryLevel} %` : "—"}</strong>
          </div>
          <BatteryCharging size={25} />
        </div>
        <div className={styles.batteryTrack} aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, state?.batteryLevel ?? 0))}%` }} />
        </div>
        <div className={styles.limitLine}>
          <span>Limite de charge</span>
          <strong>{state ? `${state.chargeLimit} %` : "Non disponible"}</strong>
        </div>
      </div>

      <div className={styles.probeBar}>
        <div>
          <strong>Configuration Tesla officielle</strong>
          <span>1 lecture manuelle de vehicle_config · aucun wake_up</span>
        </div>
        <button
          type="button"
          className={styles.probeButton}
          onClick={runProbe}
          disabled={!isTesla || configProbe.isPending}
        >
          {configProbe.isPending
            ? <><Loader2 size={16} className={styles.spinner} /> Lecture…</>
            : <><RefreshCw size={16} /> Tester</>}
        </button>
      </div>

      {configProbe.error && (
        <div className={styles.probeError}>
          Tesla n’a pas fourni la configuration : {configProbe.error.message}
          <span>Si le véhicule dort, réessaye lorsqu’il sera naturellement en ligne.</span>
        </div>
      )}

      <div className={styles.grid}>
        <article className={styles.panel}>
          <h2><Database size={18} /> Configuration détectée</h2>
          <DataRow label="Nom" value={state?.vehicleName || vehicle.name} />
          <DataRow label="Modèle / CarType" value={config?.carType ? model : null} />
          <DataRow label="Couleur extérieure" value={config?.exteriorColor} />
          <DataRow label="Jantes / WheelType" value={config?.wheelType} />
          <DataRow label="Finition / Trim" value={config?.trim} />
          <DataRow label="Toit" value={config?.roofColor} />
          <DataRow label="Spoiler" value={config?.spoilerType} />
        </article>

        <article className={styles.panel}>
          <h2><CarFront size={18} /> Mapping visuel</h2>
          <DataRow label="Clé E.V. Solar" value={config ? visualKey : null} />
          <DataRow label="Adaptateur" value={vehicle.adapterType} />
          <DataRow label="État" value={state?.isOnline ? "En ligne" : "Hors ligne"} />
          <DataRow label="Source" value={config ? "Tesla Fleet API · vehicle_config" : null} />
        </article>
      </div>

      <div className={styles.notice}>
        <ShieldCheck size={20} />
        <div>
          <strong>POC volontairement sans maquette 3D Tesla privée</strong>
          <p>
            Le bouton utilise uniquement l’endpoint Fleet API vehicle_config documenté. Aucun wake_up n’est envoyé et aucune image interne de l’app Tesla n’est appelée. Les valeurs absentes restent « Non disponible ».
          </p>
        </div>
      </div>

      <p className={styles.footnote}>
        Si le test renvoie correctement modèle, couleur, jantes et finition, l’étape suivante sera de relier cette clé de configuration à un rendu E.V. Solar mis en cache.
      </p>
    </section>
  );
}
