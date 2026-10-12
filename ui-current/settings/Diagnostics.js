// Read cached backend diagnostics only. No polling and no vehicle commands.
function EVRegulationDiagnostics() {
  const query = v.health.regulation.useQuery(undefined, { staleTime: 15000, retry: 1, refetchOnWindowFocus: false });
  const data = query.data;
  const age = value => value == null ? "Unknown" : `${Math.round(value / 1000)} s`;
  const amps = value => value == null ? "Unknown" : `${value} A`;
  const reasons = {
    solar_tracking: "Following available solar",
    grace_period: "Low solar: minimum-current grace period may use grid power",
    cooldown: "Waiting before restarting",
    vehicle_unavailable: "Vehicle data unavailable",
    charging_disabled: "Automatic charging is off",
    charge_now: "Charge Now is active",
    schedule: "Scheduled charging is active",
    battery_priority: "Home battery has priority",
  };
  return t.jsx(F, { icon: t.jsx(_e, { size: 18 }), title: "Charging diagnostics",
    description: "Cached observations. Refresh does not wake the car. Requested current is not measured current.",
    action: t.jsx(w, { size: "1", variant: "soft", disabled: query.isFetching, onClick: () => query.refetch(), children: "Refresh" }),
    children: query.isError ? t.jsx(c, { role: "alert", color: "red", children: "Diagnostics unavailable. Refresh to retry." }) : !data ? t.jsx(c, { role: "status", children: "Loading diagnostics…" }) : t.jsxs(g.Fragment, { children: [
      t.jsx(c, { as: "p", size: "2", children: `Automatic charging: ${data.chargingEnabled ? "On" : "Off"}. Energy reading: ${age(data.energyAgeMs)} old${data.energyStale ? " — stale or unavailable" : ""}.` }),
      t.jsx(c, { as: "p", size: "2", children: `Grid power: ${data.gridPowerW == null ? "Unknown" : `${data.gridPowerW} W (positive = import)`}. This includes the whole home.` }),
      data.vehicles.map(vehicle => t.jsxs("div", { children: [
        t.jsx(c, { as: "p", weight: "bold", children: vehicle.name }),
        t.jsx(c, { as: "p", size: "2", children: vehicle.external ? "Controlled by an external charger" : reasons[vehicle.reason] ?? (vehicle.reason ? vehicle.reason.replaceAll("_", " ") : "No controller decision yet") }),
        t.jsx(c, { as: "p", size: "2", children: `Requested: ${amps(vehicle.requestedAmps)} · Measured: ${amps(vehicle.actualAmps)}` }),
        t.jsx(c, { as: "p", size: "1", color: "gray", children: `Vehicle reading: ${age(vehicle.telemetryAgeMs)} old · Decision: ${age(vehicle.decisionAgeMs)} old` }),
        t.jsx(c, { as: "p", size: "1", color: "gray", children: `Configured solar ceiling: ${vehicle.solarLimitAmps == null ? "None" : amps(vehicle.solarLimitAmps)}. Lower electrical limits and available surplus still apply.` }),
      ] }, vehicle.id)),
      t.jsx(c, { as: "p", size: "1", color: "gray", children: `Controller p95: ${data.controller.p95Ms == null ? "Unknown" : `${Math.round(data.controller.p95Ms)} ms`}. Command failures: ${data.commands.failures}/${data.commands.count} command sequences since server start. p95 uses at most 128 recent cycles.` }),
    ] }),
  });
}
