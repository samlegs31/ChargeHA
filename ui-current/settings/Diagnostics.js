// Read cached backend diagnostics only. No vehicle commands.
function EVRegulationDiagnostics() {
  const lang = evUseLang();
  const fr = lang === "fr";
  const sectionOpen = g.useContext(EVSectionOpenContext);
  const query = v.health.regulation.useQuery(undefined, {
    staleTime: 4000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchInterval: sectionOpen ? 5000 : false,
  });
  const data = query.data;
  const age = value => value == null ? (fr ? "Inconnu" : "Unknown") : `${Math.round(value / 1000)} s`;
  const amps = value => value == null ? (fr ? "Inconnu" : "Unknown") : `${value} A`;
  const reasons = {
    power_limit: fr ? "Limité par la puissance électrique ou le compteur réseau" : "Limited by electrical or grid power limit",
    solar_tracking: fr ? "Suit le surplus solaire disponible" : "Following available solar",
    schedule: fr ? "Charge programmée active" : "Scheduled charging is active",
    blockout: fr ? "En pause : plage d'interdiction active" : "Paused during a no-charge period",
    charge_now: fr ? "Charge manuelle active" : "Manual charging is active",
    vacation: fr ? "Mode Solaire pur actif" : "Solar Only mode is active",
    mode_stop: fr ? "Arrêt : mode réglé sur Arrêt" : "Stopped — mode set to Stop",
    battery_priority: fr ? "La batterie maison est prioritaire" : "Home battery has priority",
    grace_period: fr ? "Solaire faible : délai de tolérance au courant minimal (peut soutirer du réseau)" : "Low solar: minimum-current grace period may use grid power",
    cooldown: fr ? "Délai d'attente avant redémarrage solaire" : "Waiting before restarting",
    no_solar: fr ? "Surplus solaire insuffisant pour démarrer" : "Not enough solar surplus",
    energy_unavailable: fr ? "Données d'énergie indisponibles" : "Energy data unavailable",
    vehicle_unavailable: fr ? "Données du véhicule indisponibles" : "Vehicle data unavailable",
    charging_disabled: fr ? "La charge automatique est désactivée" : "Automatic charging is off",
    battery_at_limit: fr ? "Batterie du véhicule à la limite de charge" : "Vehicle battery at charge limit",
    not_plugged_in: fr ? "Véhicule non branché" : "Vehicle not plugged in",
    away_from_home: fr ? "Hors domicile — automatisation suspendue" : "Away from home — automation suspended",
    no_state: fr ? "État du véhicule indisponible" : "Vehicle state unavailable",
    idle: fr ? "En veille / aucune charge requise" : "Idle — no charging needed",
    home_location_not_confirmed: fr ? "Adresse du domicile non confirmée" : "Home location not confirmed",
  };
  return t.jsx(F, {
    cardId: "diagnostics",
    icon: t.jsx(_e, { size: 18 }),
    title: fr ? "Diagnostic de régulation" : "Charging diagnostics",
    description: fr
      ? "Observations en cache. Actualiser ne réveille pas la voiture. L'intensité demandée peut différer du courant mesuré."
      : "Cached observations. Refresh does not wake the car. Requested current is not measured current.",
    scopes: ["readonly"],
    guide: fr
      ? "Permet de comprendre immédiatement pourquoi un véhicule ne charge pas au maximum (plafond solaire, compteur réseau, réserve batterie maison ou attente de stabilisation)."
      : "Explains in real time why charging is limited or paused (solar ceiling, grid guard, home battery priority, or command stabilisation).",
    action: t.jsx(w, { size: "1", variant: "soft", disabled: query.isFetching, onClick: () => query.refetch(), children: fr ? "Actualiser" : "Refresh" }),
    children: query.isError ? t.jsx(c, { role: "alert", color: "red", children: fr ? "Diagnostic indisponible. Actualisez pour réessayer." : "Diagnostics unavailable. Refresh to retry." }) : !data ? t.jsx(c, { role: "status", children: fr ? "Chargement du diagnostic…" : "Loading diagnostics…" }) : t.jsxs(g.Fragment, { children: [
      t.jsx(c, { as: "p", size: "2", children: fr
        ? `Charge automatique : ${data.chargingEnabled ? "Activée" : "Désactivée"}. Mesure d'énergie : il y a ${age(data.energyAgeMs)}${data.energyStale ? " — obsolète ou indisponible" : ""}.`
        : `Automatic charging: ${data.chargingEnabled ? "On" : "Off"}. Energy reading: ${age(data.energyAgeMs)} old${data.energyStale ? " — stale or unavailable" : ""}.` }),
      t.jsx(c, { as: "p", size: "2", children: fr
        ? `Puissance réseau totale : ${data.gridPowerW == null ? "Inconnue" : `${data.gridPowerW} W (positif = import réseau)`}. Inclut toute la maison.`
        : `Grid power: ${data.gridPowerW == null ? "Unknown" : `${data.gridPowerW} W (positive = import)`}. This includes the whole home.` }),
      data.vehicles.map(vehicle => {
        const limitText = vehicle.effectiveLimitLabel
          ? evTrBackend(vehicle.effectiveLimitLabel, lang)
          : (vehicle.effectiveLimitAmps == null ? (fr ? "Inconnue" : "Unknown") : amps(vehicle.effectiveLimitAmps));
        return t.jsxs("div", { children: [
          t.jsx(c, { as: "p", weight: "bold", children: vehicle.name }),
          t.jsx(c, { as: "p", size: "2", children: vehicle.external
            ? (fr ? "Contrôlé par un chargeur externe" : "Controlled by an external charger")
            : reasons[vehicle.reason] ?? (vehicle.reason ? vehicle.reason.replaceAll("_", " ") : (fr ? "Aucune décision du contrôleur pour l'instant" : "No controller decision yet")) }),
          t.jsx(c, { as: "p", size: "2", "data-testid": `effective-limit-${vehicle.id}`, children: `${fr ? "Limite effective" : "Effective limit"} : ${limitText}` }),
          t.jsx(c, { as: "p", size: "2", children: fr
            ? `Demandé : ${amps(vehicle.requestedAmps)} · Mesuré : ${amps(vehicle.actualAmps)} · File de commandes : ${vehicle.commandInFlight ? "En cours" : "Inactive"} (${vehicle.commandQueueDepth ?? 0})`
            : `Requested: ${amps(vehicle.requestedAmps)} · Measured: ${amps(vehicle.actualAmps)} · Command queue: ${vehicle.commandInFlight ? "In flight" : "Idle"} (${vehicle.commandQueueDepth ?? 0})` }),
          t.jsx(c, { as: "p", size: "1", color: "gray", children: fr
            ? `Relevé véhicule : il y a ${age(vehicle.telemetryAgeMs)} · Décision : il y a ${age(vehicle.decisionAgeMs)}`
            : `Vehicle reading: ${age(vehicle.telemetryAgeMs)} old · Decision: ${age(vehicle.decisionAgeMs)} old` }),
          t.jsx(c, { as: "p", size: "1", color: "gray", children: fr
            ? `Plafond solaire configuré : ${vehicle.solarLimitAmps == null ? "Aucun" : amps(vehicle.solarLimitAmps)}. Les limites électriques inférieures et le surplus disponible s'appliquent toujours.`
            : `Configured solar ceiling: ${vehicle.solarLimitAmps == null ? "None" : amps(vehicle.solarLimitAmps)}. Lower electrical limits and available surplus still apply.` }),
        ] }, vehicle.id);
      }),
      t.jsx(c, { as: "p", size: "1", color: "gray", children: fr
        ? `Latence contrôleur (p95) : ${data.controller.p95Ms == null ? "Inconnue" : `${Math.round(data.controller.p95Ms)} ms`}. Échecs de commandes : ${data.commands.failures}/${data.commands.count} séquences depuis le démarrage (p95 sur 128 cycles max).`
        : `Controller p95: ${data.controller.p95Ms == null ? "Unknown" : `${Math.round(data.controller.p95Ms)} ms`}. Command failures: ${data.commands.failures}/${data.commands.count} command sequences since server start. p95 uses at most 128 recent cycles.` }),
    ] }),
  });
}
