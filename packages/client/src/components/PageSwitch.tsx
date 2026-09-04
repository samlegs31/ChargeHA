import { lazy, Suspense } from "react";
import { pluginDevComponents } from "@chargeha/plugins/devComponentRegistry";
import type { Page } from "./Layout/AppLayout.tsx";
import { ErrorBoundary } from "./ui/ErrorBoundary.tsx";
import { Dashboard } from "./pages/Dashboard/Dashboard.tsx";

const Stats = lazy(() =>
  import("./pages/Stats/Stats.tsx").then((module) => ({
    default: module.Stats,
  }))
);
const Schedules = lazy(() =>
  import("./pages/Schedules/Schedules.tsx").then((module) => ({
    default: module.Schedules,
  }))
);
const Settings = lazy(() =>
  import("./pages/Settings/Settings.tsx").then((module) => ({
    default: module.Settings,
  }))
);
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
  return (
    <ErrorBoundary label={PAGE_LABELS[page]}>
      <Suspense fallback={null}>{content}</Suspense>
    </ErrorBoundary>
  );
}
