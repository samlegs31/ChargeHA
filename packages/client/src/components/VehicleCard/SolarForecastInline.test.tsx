import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import type { SolarChargeForecastResult } from "@chargeha/shared/forecast";
import { SolarForecastInline } from "./SolarForecastInline.tsx";

describe("SolarForecastInline", () => {
  const baseForecast: SolarChargeForecastResult = {
    available: true,
    vehicleId: "vin-123",
    mode: "vacation",
    generatedAt: "2026-08-14T17:00:00.000Z",
    timezone: "Europe/Paris",
    pvRemainingKwh: 5.8,
    solarChargeRemainingKwh: 3.7,
    solarEndAt: "2026-08-14T17:24:00.000Z",
    socAtSolarEnd: 67,
    finalSoc: 67,
    finalAt: "2026-08-14T17:24:00.000Z",
    schedule: null,
    confidence: "high",
  };

  afterEach(cleanup);

  it("describes the expected evening SOC without technical kWh", () => {
    renderWithProviders(
      <SolarForecastInline
        mode="vacation"
        data={baseForecast}
        isLoading={false}
        isError={false}
      />,
    );

    expect(screen.getByText("With today's sun: about 67% this evening"))
      .toBeInTheDocument();
    expect(screen.queryByText(/kWh/)).not.toBeInTheDocument();
  });

  it("describes the next Smart target in plain language", () => {
    const data: SolarChargeForecastResult = {
      ...baseForecast,
      mode: "auto",
      finalSoc: 80,
      finalAt: "2026-08-15T02:32:00.000Z",
      schedule: {
        startAt: "2026-08-14T23:10:00.000Z",
        endAt: "2026-08-15T04:40:00.000Z",
        amps: 16,
        targetPercent: 80,
        expectedFinishAt: "2026-08-15T02:32:00.000Z",
      },
    };

    renderWithProviders(
      <SolarForecastInline
        mode="auto"
        data={data}
        isLoading={false}
        isError={false}
      />,
    );

    expect(screen.getByText(/Then 80% expected around/)).toBeInTheDocument();
  });

  it("shows the projected SOC when the schedule cannot reach target", () => {
    const data: SolarChargeForecastResult = {
      ...baseForecast,
      mode: "auto",
      finalSoc: 71,
      schedule: {
        startAt: "2026-08-14T23:10:00.000Z",
        endAt: "2026-08-15T04:40:00.000Z",
        amps: 16,
        targetPercent: 80,
        expectedFinishAt: null,
      },
    };

    renderWithProviders(
      <SolarForecastInline
        mode="auto"
        data={data}
        isLoading={false}
        isError={false}
      />,
    );

    expect(screen.getByText(/about 71% expected/)).toBeInTheDocument();
  });

  it("uses simple loading copy", () => {
    renderWithProviders(
      <SolarForecastInline
        mode="auto"
        data={undefined}
        isLoading
        isError={false}
      />,
    );
    expect(screen.getByText("Checking today's solar…")).toBeInTheDocument();
  });
});
