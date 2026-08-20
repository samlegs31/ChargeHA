import { MoonStar, SunMedium } from "lucide-react";
import { Text } from "@radix-ui/themes";
import type { VehicleMode } from "@chargeha/shared";
import type {
  SolarChargeForecast,
  SolarChargeForecastResult,
} from "@chargeha/shared/forecast";

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

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  minWidth: 0,
};

function ForecastStatus({ text }: { text: string }) {
  return (
    <div data-testid="solar-forecast-inline" style={{ ...rowStyle, marginTop: 7 }}>
      <SunMedium size={14} style={{ color: "var(--yellow-10)", flexShrink: 0 }} />
      <Text size="2" color="gray">{text}</Text>
    </div>
  );
}

function unavailableStatus(data: SolarChargeForecastResult): string | null {
  if (data.available) return null;
  if (data.reason === "not_configured") {
    return "Set up the solar forecast in Settings";
  }
  if (data.reason === "weather_unavailable" || data.reason === "energy_unavailable") {
    return "Solar forecast temporarily unavailable";
  }
  return null;
}

function solarForecastText(data: SolarChargeForecast): string {
  if (data.solarEndAt) {
    return `With today's sun: about ${Math.round(data.socAtSolarEnd)}% this evening`;
  }
  return `No more solar expected today · about ${Math.round(data.socAtSolarEnd)}% this evening`;
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

  const solarText = solarForecastText(data);
  const scheduleText = scheduleForecastText(mode, data);

  return (
    <div
      data-testid="solar-forecast-inline"
      style={{
        marginTop: 8,
        marginBottom: 2,
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      <div style={rowStyle}>
        <SunMedium size={14} style={{ color: "var(--yellow-10)", flexShrink: 0 }} />
        <Text size="2" color="gray" style={{ lineHeight: 1.4 }}>
          {solarText}
        </Text>
      </div>
      {scheduleText && (
        <div style={rowStyle}>
          <MoonStar size={14} style={{ color: "var(--blue-9)", flexShrink: 0 }} />
          <Text size="2" color="gray" style={{ lineHeight: 1.4 }}>
            {scheduleText}
          </Text>
        </div>
      )}
    </div>
  );
}
