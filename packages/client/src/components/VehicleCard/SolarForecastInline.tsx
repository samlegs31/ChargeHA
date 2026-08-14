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
    return (
      <div data-testid="solar-forecast-inline" style={{ ...rowStyle, marginTop: 6 }}>
        <SunMedium size={13} style={{ color: "var(--yellow-10)", flexShrink: 0 }} />
        <Text size="1" color="gray">Calculating today's solar forecast…</Text>
      </div>
    );
  }

  if (isError || !data) return null;

  if (!data.available) {
    if (data.reason === "not_configured") {
      return (
        <div data-testid="solar-forecast-inline" style={{ ...rowStyle, marginTop: 6 }}>
          <SunMedium size={13} style={{ color: "var(--yellow-10)", flexShrink: 0 }} />
          <Text size="1" color="gray">Solar forecast: configure in Settings</Text>
        </div>
      );
    }
    if (data.reason === "weather_unavailable" || data.reason === "energy_unavailable") {
      return (
        <div data-testid="solar-forecast-inline" style={{ ...rowStyle, marginTop: 6 }}>
          <SunMedium size={13} style={{ color: "var(--yellow-10)", flexShrink: 0 }} />
          <Text size="1" color="gray">Solar forecast temporarily unavailable</Text>
        </div>
      );
    }
    return null;
  }

  const solarEnd = data.solarEndAt
    ? formatTime(data.solarEndAt, data.timezone)
    : null;
  const solarText = solarEnd
    ? `Solar ends ${solarEnd} · +${data.solarChargeRemainingKwh.toFixed(1)} kWh to car · ${Math.round(data.socAtSolarEnd)}% tonight`
    : `No more solar charging expected today · ${Math.round(data.socAtSolarEnd)}% tonight`;

  const schedule = mode === "auto" ? data.schedule : null;
  const targetReached = schedule !== null &&
    data.finalSoc >= schedule.targetPercent - 0.05;
  const scheduleText = schedule === null
    ? null
    : targetReached
    ? `Target ${schedule.targetPercent}% around ${formatTime(schedule.expectedFinishAt ?? schedule.endAt, data.timezone)}`
    : `Schedule to ${formatTime(schedule.endAt, data.timezone)} · ${Math.round(data.finalSoc)}% expected`;

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
