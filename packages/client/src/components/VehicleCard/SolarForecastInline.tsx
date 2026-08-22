import { CloudSun, Info, MoonStar, SunMedium } from "lucide-react";
import { Text } from "@radix-ui/themes";
import type { VehicleMode } from "@chargeha/shared";
import type {
  SolarChargeForecast,
  SolarChargeForecastResult,
} from "@chargeha/shared/forecast";
import styles from "./SolarForecastInline.module.css";

function formatTime(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone || undefined,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

function ForecastStatus({ text }: { text: string }) {
  return (
    <div data-testid="solar-forecast-inline" className={styles.statusPanel}>
      <CloudSun size={23} aria-hidden="true" />
      <div>
        <Text size="1" color="gray" weight="bold">Charging forecast</Text>
        <Text size="2">{text}</Text>
      </div>
    </div>
  );
}

function unavailableStatus(data: SolarChargeForecastResult): string | null {
  if (data.available) return null;
  if (data.reason === "not_configured") {
    return "Set up the solar forecast in Settings";
  }
  if (
    data.reason === "weather_unavailable" ||
    data.reason === "energy_unavailable"
  ) {
    return "Solar forecast temporarily unavailable";
  }
  return null;
}

function solarForecastTitle(data: SolarChargeForecast): string {
  if (data.solarEndAt) {
    return `About ${Math.round(data.socAtSolarEnd)}% from today's sun`;
  }
  return `About ${Math.round(data.socAtSolarEnd)}% this evening`;
}

function solarForecastDetail(data: SolarChargeForecast): string {
  if (!data.solarEndAt || data.solarChargeRemainingKwh <= 0.05) {
    return "No more useful solar is expected today.";
  }
  return `${
    data.solarChargeRemainingKwh.toFixed(1)
  } kWh of solar charging expected by ${
    formatTime(data.solarEndAt, data.timezone)
  }.`;
}

function scheduleForecastText(
  mode: VehicleMode,
  data: SolarChargeForecast,
): string | null {
  if (mode !== "auto" || data.schedule === null) return null;

  const schedule = data.schedule;
  const targetReached = data.finalSoc >= schedule.targetPercent - 0.05;
  if (targetReached) {
    return `Then ${schedule.targetPercent}% expected around ${
      formatTime(schedule.expectedFinishAt ?? schedule.endAt, data.timezone)
    }`;
  }
  return `By ${formatTime(schedule.endAt, data.timezone)}: about ${
    Math.round(data.finalSoc)
  }% expected`;
}

function confidenceText(data: SolarChargeForecast): string {
  if (data.confidence === "high") return "High confidence";
  if (data.confidence === "medium") return "Medium confidence";
  return "Low confidence";
}

export function SolarForecastInline({
  mode,
  data,
  isLoading,
  isError,
}: {
  mode: VehicleMode;
  data: SolarChargeForecastResult | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) {
    return <ForecastStatus text="Checking today's solar…" />;
  }
  if (isError || !data) return null;

  const unavailableText = unavailableStatus(data);
  if (!data.available) {
    return unavailableText ? <ForecastStatus text={unavailableText} /> : null;
  }

  const title = solarForecastTitle(data);
  const detail = solarForecastDetail(data);
  const scheduleText = scheduleForecastText(mode, data);

  return (
    <div
      data-testid="solar-forecast-inline"
      className={styles.panel}
      aria-label="Local and explainable charging forecast"
    >
      <div className={styles.header}>
        <div>
          <Text size="1" color="gray" weight="bold">Charging forecast</Text>
          <Text size="1" color="gray">Local estimate</Text>
        </div>
        <span className={styles.confidence}>{confidenceText(data)}</span>
      </div>

      <div className={styles.solarSummary}>
        <span className={styles.solarIcon} aria-hidden="true">
          <SunMedium size={25} />
        </span>
        <div>
          <Text size="3" weight="bold">{title}</Text>
          <Text size="2" color="gray">{detail}</Text>
        </div>
      </div>

      {scheduleText && (
        <div className={styles.scheduleRow}>
          <MoonStar size={19} aria-hidden="true" />
          <Text size="2" weight="medium">{scheduleText}</Text>
        </div>
      )}

      <div className={styles.explanation}>
        <Info size={16} aria-hidden="true" />
        <Text size="1" color="gray">
          Based on your solar production, vehicle level and saved schedule.
        </Text>
      </div>
    </div>
  );
}
