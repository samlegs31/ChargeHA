import { pluginDevComponents } from "@chargeha/plugins/componentRegistry";
import type { Page } from "./Layout/AppLayout.tsx";
import { ErrorBoundary } from "./ui/ErrorBoundary.tsx";
import { Dashboard } from "./pages/Dashboard/Dashboard.tsx";
import { Stats } from "./pages/Stats/Stats.tsx";
import { Schedules } from "./pages/Schedules/Schedules.tsx";
import { Settings } from "./pages/Settings/Settings.tsx";

const VehicleVisualDev = pluginDevComponents["vehicle-visual"];

const PAGE_LABELS: Record<Page, string> = {
  dashboard: "Dashboard",
  stats: "Stats",
  schedules: "Schedules",
  settings: "Settings",
  simulator: "Dashboard",
  vehicleVisualDev: "Vehicle visual POC",
};

export function renderPage(page: Page, onNavigate: (p: Page) => void) {
  const dashboard = () => (
    <Dashboard onNavigateSettings={() => onNavigate("settings")} />
  );
  const pages: Record<Page, () => React.JSX.Element> = {
    dashboard,
    stats: () => <Stats />,
    schedules: () => (
      <Schedules onNavigateSettings={() => onNavigate("settings")} />
    ),
    settings: () => <Settings />,
    simulator: dashboard,
    vehicleVisualDev: () => <VehicleVisualDev />,
  };
  const content = pages[page]();
  return <ErrorBoundary label={PAGE_LABELS[page]}>{content}</ErrorBoundary>;
}
