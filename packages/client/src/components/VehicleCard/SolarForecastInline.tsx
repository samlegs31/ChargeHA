import { MoonStar, SunMedium } from "lucide-react";
import { Text } from "@radix-ui/themes";
import type { VehicleMode } from "@chargeha/shared";
import type { SolarChargeForecastResult } from "@chargeha/shared/forecast";

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
  gap: 6,
  minWidth: 0,
};

function ForecastStatus({ text }: { text: string }) {
  return (
    <div data-testid="solar-forecast-inline" style={{ ...rowStyle, marginTop: 6 }}>
      <SunMedium size={13} style={{ color: "var(--yellow-10)", flexShrink: 0 }} />
      <Text size="1" color="gray">{text}</Text>
    </div>
  );
}

function unavailableStatus(data: SolarChargeForecastResult): string | null {
  if (data.available) return null;
  if (data.reason === "not_configured") {
    return "Solar forecast: configure in Settings";
  }
  if (data.reason === "weather_unavailable" || data.reason === "energy_unavailable") {
    return "Solar forecast temporarily unavailable";
  }
  return null;
}

function solarForecastText(data: SolarChargeForecastResult): string {
  if (data.solarEndAt) {
    return `Solar ends ${formatTime(data.solarEndAt, data.timezone)} · +${
      data.solarChargeRemainingKwh.toFixed(1)
    } kWh to car · ${Math.round(data.socAtSolarEnd)}% tonight`;
  }
  return `No more solar charging expected today · ${Math.round(data.socAtSolarEnd)}% tonight`;
}

function scheduleForecastText(
  mode: VehicleMode,
  data: SolarChargeForecastResult,
): string | null {
  if (mode !== "auto" || data.schedule === null) return null;

  const schedule = data.schedule;
  const targetReached = data.finalSoc >= schedule.targetPercent - 0.05;
  if (targetReached) {
    return `Target ${schedule.targetPercent}% around ${
      formatTime(schedule.expectedFinishAt ?? schedule.endAt, data.timezone)
    }`;
  }
  return `Schedule to ${formatTime(schedule.endAt, data.timezone)} · ${
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
    return <ForecastStatus text="Calculating today's solar forecast…" />;
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
        marginTop: 6,
        marginBottom: 2,
        paddingLeft: 20,
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <div style={rowStyle}>
        <SunMedium size={13} style={{ color: "var(--yellow-10)", flexShrink: 0 }} />
        <Text size="1" color="gray" style={{ lineHeight: 1.35 }}>
          {solarText}
        </Text>
      </div>
      {scheduleText && (
        <div style={rowStyle}>
          <MoonStar size={13} style={{ color: "var(--blue-9)", flexShrink: 0 }} />
          <Text size="1" color="gray" style={{ lineHeight: 1.35 }}>
            {scheduleText}
          </Text>
        </div>
      )}
    </div>
  );
}
