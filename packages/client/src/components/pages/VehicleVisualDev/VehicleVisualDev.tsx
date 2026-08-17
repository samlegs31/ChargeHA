import { BatteryCharging, CarFront, Database, ShieldCheck, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { useVehicles } from "../../../hooks/useVehicles.ts";
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

  const model = readableModel(state?.carType);
  const visualKey = useMemo(
    () => `tesla__${slugPart(state?.carType)}`,
    [state?.carType],
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

      <div className={styles.grid}>
        <article className={styles.panel}>
          <h2><Database size={18} /> Configuration détectée</h2>
          <DataRow label="Nom" value={state?.vehicleName || vehicle.name} />
          <DataRow label="Modèle / CarType" value={state?.carType ? model : null} />
          <DataRow label="Couleur extérieure" value={null} />
          <DataRow label="Jantes / WheelType" value={null} />
          <DataRow label="Finition / Trim" value={null} />
        </article>

        <article className={styles.panel}>
          <h2><CarFront size={18} /> Mapping visuel</h2>
          <DataRow label="Clé E.V. Solar" value={visualKey} />
          <DataRow label="Adaptateur" value={vehicle.adapterType} />
          <DataRow label="État" value={state?.isOnline ? "En ligne" : "Hors ligne"} />
          <DataRow label="Source modèle" value={state?.carType ? "Tesla vehicle_state" : null} />
        </article>
      </div>

      <div className={styles.notice}>
        <ShieldCheck size={20} />
        <div>
          <strong>Test sans appel Tesla supplémentaire</strong>
          <p>
            Cette page réutilise uniquement les données déjà récupérées par E.V. Solar. Elle ne réveille pas le véhicule et n’utilise aucun endpoint Tesla privé ou non documenté.
          </p>
        </div>
      </div>

      <p className={styles.footnote}>
        Couleur, jantes et finition restent volontairement « Non disponible » tant qu’E.V. Solar ne les reçoit pas proprement. Aucun attribut n’est inventé.
      </p>
    </section>
  );
}
