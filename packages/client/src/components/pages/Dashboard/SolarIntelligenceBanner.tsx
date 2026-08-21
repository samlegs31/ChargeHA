import { ShieldCheck, Sparkles } from "lucide-react";
import type {
  EnergyData,
  VehicleChargeState,
  VehicleMode,
} from "@chargeha/shared";
import { kwValue } from "../../../utils/Format.ts";
import styles from "./SolarIntelligenceBanner.module.css";

interface VehicleSignal {
  mode: VehicleMode | string;
  state: VehicleChargeState | null;
}

interface SolarRecommendation {
  title: string;
  reason: string;
  tone: "solar" | "smart" | "quiet";
}

const ACTIVE_POWER_W = 250;

function primaryVehicle(vehicles: VehicleSignal[]): VehicleSignal | null {
  return vehicles.find((vehicle) => vehicle.state?.isPluggedIn) ??
    vehicles.find((vehicle) => vehicle.state?.isOnline) ??
    vehicles[0] ??
    null;
}

function smartWatchingReason(solarW: number): string {
  if (solarW > ACTIVE_POWER_W) {
    return `Your panels are producing ${
      kwValue(solarW)
    } and E.V. Solar will act when surplus is available.`;
  }
  return "E.V. Solar is monitoring the home and will act when cleaner energy is available.";
}

function buildPluggedRecommendation(
  data: EnergyData,
  state: VehicleChargeState,
  mode: VehicleMode | string,
): SolarRecommendation {
  const solarW = Math.max(0, data.solarProductionW);
  const gridW = data.gridPowerW;

  if (mode === "stop") {
    return {
      title: "Smart Charge can take over",
      reason: "The car is plugged in, but charging is currently paused.",
      tone: "smart",
    };
  }

  if (mode === "charge_now" && gridW > ACTIVE_POWER_W) {
    return {
      title: "Smart Charge could reduce grid use",
      reason: `Charge Now is active while the home imports ${kwValue(gridW)}.`,
      tone: "smart",
    };
  }

  if (mode === "vacation") {
    return {
      title: "Solar-only charging is active",
      reason: solarW > ACTIVE_POWER_W
        ? `Your panels are currently producing ${kwValue(solarW)}.`
        : "The car will wait until enough solar is available.",
      tone: "solar",
    };
  }

  if (
    state.isCharging && solarW > ACTIVE_POWER_W && gridW <= ACTIVE_POWER_W
  ) {
    return {
      title: "Smart Charge is using your solar",
      reason: `Your panels are producing ${
        kwValue(solarW)
      } while the car charges.`,
      tone: "solar",
    };
  }

  if (state.isCharging && gridW > ACTIVE_POWER_W) {
    return {
      title: "The grid is supporting this charge",
      reason: `The home is importing ${
        kwValue(gridW)
      }; Smart Charge will adjust when cleaner energy is available.`,
      tone: "smart",
    };
  }

  if (gridW < -ACTIVE_POWER_W) {
    return {
      title: "Solar surplus is ready for your car",
      reason: `${
        kwValue(Math.abs(gridW))
      } is being exported, so Smart Charge can use cleaner energy.`,
      tone: "solar",
    };
  }

  if (gridW > ACTIVE_POWER_W) {
    return {
      title: "Waiting now can avoid grid energy",
      reason: `The home is importing ${
        kwValue(gridW)
      }; Smart Charge will keep watching for a better moment.`,
      tone: "smart",
    };
  }

  return {
    title: "Smart Charge is watching your solar",
    reason: smartWatchingReason(solarW),
    tone: "smart",
  };
}

/**
 * Deliberately deterministic: every recommendation is derived on-device from
 * live energy and vehicle state, so the explanation always matches the advice.
 */
export function buildSolarRecommendation(
  data: EnergyData | null,
  vehicles: VehicleSignal[],
): SolarRecommendation {
  const vehicle = primaryVehicle(vehicles);

  if (!vehicle) {
    return {
      title: "Connect a vehicle to unlock smart charging",
      reason: "A vehicle is needed before a charging plan can be recommended.",
      tone: "quiet",
    };
  }

  if (!data || data.pollFailed) {
    return {
      title: "Waiting for live solar data",
      reason:
        "Recommendations resume automatically when energy data reconnects.",
      tone: "quiet",
    };
  }

  if (!vehicle.state) {
    return {
      title: "Waiting for the vehicle to wake",
      reason:
        "A fresh battery and connection state are needed before choosing a charge window.",
      tone: "quiet",
    };
  }

  if (!vehicle.state.isPluggedIn) {
    return {
      title: "Plug in when convenient",
      reason:
        "Smart Charge can plan the next charge as soon as the car is connected.",
      tone: "smart",
    };
  }
  return buildPluggedRecommendation(data, vehicle.state, vehicle.mode);
}

export function SolarIntelligenceBanner(
  { data, vehicles }: { data: EnergyData | null; vehicles: VehicleSignal[] },
) {
  const recommendation = buildSolarRecommendation(data, vehicles);

  return (
    <section
      className={styles.banner}
      data-tone={recommendation.tone}
      aria-labelledby="solar-intelligence-title"
    >
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.icon} aria-hidden="true">
        <Sparkles size={24} />
      </div>
      <div className={styles.copy}>
        <div className={styles.eyebrow} id="solar-intelligence-title">
          Solar Intelligence
        </div>
        <div className={styles.title}>{recommendation.title}</div>
        <div className={styles.reason}>
          <strong>Why:</strong> {recommendation.reason}
        </div>
        <div className={styles.localNote}>
          <ShieldCheck size={15} aria-hidden="true" />
          Calculated locally from live energy and vehicle data.
        </div>
      </div>
    </section>
  );
}
