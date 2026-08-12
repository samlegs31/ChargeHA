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

/**
 * Home intentionally stays focused on live control. Historical / cumulative
 * energy metrics live on the Stats page so the mobile dashboard stays compact.
 */
export function EnergyOverview({ pluginWarnings }: EnergyOverviewProps) {
  const { data: energyData, isLoading: loading } = useEnergyData();
  const realtime = energyData?.realtime ?? null;
  const { vehicles } = useVehicles();
  const chargingVehicles = useChargingVehicleFlows(realtime, vehicles);

  return (
    <>
      <EnergyFlowDiagram
        data={realtime}
        loading={loading}
        chargingVehicles={chargingVehicles}
      />

      {realtime?.pollFailed && (
        <PluginWarningCard
          warning={{
            title: "Energy source offline",
            message: realtime.pollError ??
              "Energy data poll failed — see the Logs page for details.",
          }}
        />
      )}

      {pluginWarnings.map((warning) => (
        <PluginWarningCard key={warning.title} warning={warning} />
      ))}
    </>
  );
}
