import { AlertTriangle } from "lucide-react";
import { Card, Text } from "@radix-ui/themes";
import { useEnergyData } from "../../../hooks/useEnergyData.ts";
import { useVehicles } from "../../../hooks/useVehicles.ts";
import { EnergyFlowDiagram } from "../../EnergyFlowDiagram/EnergyFlowDiagram.tsx";
import { useChargingVehicleFlows } from "./energyHelpers.ts";

interface PluginWarning {
  title: string;
  message: string;
}

interface EnergyOverviewProps {
  pluginWarnings: PluginWarning[];
}

function PluginWarningCard({ warning }: { warning: PluginWarning }) {
  return (
    <Card style={{ borderLeft: "3px solid var(--orange-9)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AlertTriangle
          size={20}
          style={{ color: "var(--orange-9)", flexShrink: 0 }}
        />
        <div>
          <Text size="2" weight="bold" style={{ display: "block" }}>
            {warning.title}
          </Text>
          <Text size="2" color="gray">{warning.message}</Text>
        </div>
      </div>
    </Card>
  );
}

function energySummary(
  solarW: number,
  batteryW: number,
  gridW: number,
  solarToCarsW: number,
): string {
  const activeW = 100;

  if (solarW > activeW) {
    if (solarToCarsW > activeW) {
      return "Solar is powering the home and charging your car.";
    }
    if (batteryW < -activeW) {
      return "Solar is powering the home and charging the home battery.";
    }
    if (gridW < -activeW) {
      return "Solar is covering the home and sending surplus to the grid.";
    }
    return "Solar is powering your home.";
  }

  if (batteryW > activeW && gridW <= activeW) {
    return "The home is running mainly from the battery.";
  }
  if (gridW > activeW) {
    return "The home is currently using electricity from the grid.";
  }
  return "Home energy is balanced.";
}

function currentEnergySummary(
  hasRealtime: boolean,
  solarW: number,
  batteryW: number,
  gridW: number,
  solarToCarsW: number,
): string | null {
  if (!hasRealtime) return null;
  return energySummary(solarW, batteryW, gridW, solarToCarsW);
}

/**
 * Home intentionally stays focused on live control. Historical / cumulative
 * energy metrics live on the Stats page so the mobile dashboard stays compact.
 */
export function EnergyOverview({ pluginWarnings }: EnergyOverviewProps) {
  const { data: energyData, isLoading: loading } = useEnergyData();
  const realtime = energyData?.realtime ?? null;
  const { vehicles } = useVehicles();
  const chargingVehicles = useChargingVehicleFlows(realtime, vehicles);
  const solarToCarsW = chargingVehicles.reduce(
    (total, vehicle) => total + Math.max(0, vehicle.solarW),
    0,
  );
  const summary = currentEnergySummary(
    realtime !== null,
    realtime?.solarProductionW ?? 0,
    realtime?.batteryPowerW ?? 0,
    realtime?.gridPowerW ?? 0,
    solarToCarsW,
  );

  return (
    <>
      {summary && !realtime?.pollFailed && (
        <div style={{ padding: "8px 4px 4px" }}>
          <Text size="3" weight="medium">{summary}</Text>
        </div>
      )}

      <EnergyFlowDiagram
        data={realtime}
        loading={loading}
        chargingVehicles={chargingVehicles}
      />

      {realtime?.pollFailed && (
        <PluginWarningCard
          warning={{
            title: "Energy data unavailable",
            message: realtime.pollError ??
              "E.V. Solar cannot read home energy data right now. It will keep trying automatically.",
          }}
        />
      )}

      {pluginWarnings.map((warning) => (
        <PluginWarningCard key={warning.title} warning={warning} />
      ))}
    </>
  );
}
