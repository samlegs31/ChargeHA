function EVSettingsSearch({ onSelect }) {
  const lang = evUseLang();
  const fr = lang === "fr";
  const [query, setQuery] = g.useState("");
  const categories = [
    ["cars", "Mes voitures — Charge automatique", "My cars — Automatic charging", "automatic charging charge automatique actif activer desactiver pause stop interrupteur", null, "automatic-charging"],
    ["cars", "Mes voitures — Plafond de courant solaire", "My cars — Solar current limit", "solar solaire 22 22a a amp amps limit plafond voiture friday edith maximum kw", null, "solar-current"],
    ["cars", "Mes voitures — Limites électriques & compteur", "My cars — Electrical & grid limits", "electrical circuit grid import max kw disjoncteur compteur linky 12kva 12 kva 32a securite", null, "electrical-limits"],
    ["cars", "Mes voitures — Priorité & historique véhicule", "My cars — Vehicle priority & history source", "car voitures priorite priority 1 2 ordre chargehq wattpilot solarweb historique", null, "my-cars-list"],
    ["cars", "Mes voitures — Diagnostic & télécharger les logs", "My cars — Diagnostics & download logs", "why limited diagnostic diagnostics reason cause queue age p95 pourquoi limite logs log journal journaux telecharger charger exporter export google drive fichier txt support", "diagnostics", "diagnostics"],
    ["home", "Solaire & maison — Onduleur & compteur", "Solar & home — Energy equipment & inverter", "energy energie inverter onduleur fronius sigenergy compteur meter", null, "energy-equipment"],
    ["home", "Solaire & maison — Adresse & localisation GPS", "Solar & home — Home location & GPS", "location adresse gps domicile maison home latitude longitude", null, "home-location"],
    ["home", "Solaire & maison — Batterie maison & réserve", "Solar & home — Home battery & reserve", "battery batterie reserve priorite priority 90 90% maison", null, "home-battery-basic"],
    ["prediction", "Prévisions solaires — Panneaux & puissance kVA", "Solar forecast — Panels, arrays & grid contract", "forecast prevision panels panneaux installation azimuth orientation tilt inclinaison kwp kva", null, "solar-forecast"],
    ["electricity", "Tarif d'électricité — Prix & heures creuses", "Electricity price — Rates & off-peak hours", "tariff tarif price prix cheap heures creuses heures pleines hp hc off-peak peak eur euro", null, "electricity-tariff"],
    ["history", "Historique — Importer Charge HQ (CSV)", "Charging history — Import Charge HQ", "import historique charge hq chargehq csv", "import-chargehq", "import-chargehq"],
    ["history", "Historique — Importer Wattpilot (Solar.web)", "Charging history — Import Wattpilot", "import historique wattpilot solarweb csv", "import-wattpilot", "import-wattpilot"],
    ["advanced", "Avancé — Régulation solaire, réactivité & quota Tesla", "Advanced — Solar regulation, reactivity & quota", "regulation reactive reactivite rapide equilibree douce vitesse nuages 15s 45s 180s 3min secondes grace delay delai cooldown debounce threshold voltage 230v 0.2kw 5min 1min tesla api quota responsiveness", "solar-regulation", "solar-regulation"],
    ["advanced", "Avancé — Protection batterie maison (décharge)", "Advanced — Home battery discharge protection", "battery batterie discharge decharge tolerance protection watt", "home-battery-advanced", "home-battery-advanced"],
    ["advanced", "Avancé — Système, stockage & fuseau horaire", "Advanced — System, storage & timezone", "system systeme storage stockage retention timezone fuseau horaire europe paris boucle secours fallback cadence fronius 4s", "system-storage", "system-storage"],
    ["advanced", "Avancé — Notifications (Telegram)", "Advanced — Notifications (Telegram)", "notifications alertes alerte telegram bot chat events", "notifications", "notifications"],
    ["advanced", "Avancé — Authentification & mot de passe", "Advanced — Authentication & password", "authentication authentification password mot de passe oidc sso", "authentication", "authentication"],
  ];
  const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const normalized = norm(query).trim();
  const matches = normalized
    ? categories.filter(([, frTitle, enTitle, keywords]) => normalized.split(/\s+/).every(word => norm(`${frTitle} ${enTitle} ${keywords}`).includes(word)))
    : [];
  return t.jsxs("div", { children: [
    t.jsx(P, {
      type: "search",
      "aria-label": fr ? "Rechercher un réglage" : "Search settings",
      placeholder: fr ? "Rechercher un réglage (ex. 22A, disjoncteur, Linky, batterie, logs…)" : "Search settings (e.g. 22A, breaker, battery, tariff, logs…)",
      value: query,
      onChange: event => setQuery(event.target.value),
    }),
    normalized && t.jsx("div", {
      "aria-live": "polite",
      style: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 },
      children: matches.length ? matches.map(([page, frTitle, enTitle, , sectionId, cardId]) => {
        const title = fr ? frTitle : enTitle;
        return t.jsx(w, {
          size: "1",
          variant: "soft",
          onClick: () => {
            onSelect(page, { sectionId, cardId, section: title, focusLabel: title, query: normalized, token: Date.now() });
            setQuery("");
          },
          children: title,
        }, `${page}-${cardId}`);
      }) : t.jsx(c, { size: "2", children: fr ? "Aucun réglage correspondant" : "No matching settings" }),
    }),
  ] });
}
