function EVSettingsSearch({ onSelect }) {
  const [query, setQuery] = g.useState("");
  const categories = [
    ["cars", "My cars — Solar current limit", "solar solaire 22 22a a amp amps limit plafond voiture f.r.i.d.a.y friday maximum", null, "Solar current limit"],
    ["cars", "My cars — Electrical & grid limits", "electrical circuit grid import max kw disjoncteur compteur", null, "Electrical limits"],
    ["cars", "My cars — Why is charging limited?", "why limited diagnostic diagnostics reason cause queue age", "Why is charging limited?", "Charging diagnostics"],
    ["home", "Solar & home — Battery & inverter", "energy energie inverter onduleur battery batterie reserve location maison", null, "Home battery"],
    ["prediction", "Solar forecast", "forecast prevision panels panneaux installation azimuth tilt kwp", null, "Solar forecast"],
    ["electricity", "Electricity price", "tariff tarif price prix cheap heures creuses off-peak peak", null, "Tariff periods"],
    ["history", "Charging history — Charge HQ / Wattpilot", "import historique charge hq wattpilot solar.web csv", "Import from Charge HQ", "Import"],
    ["advanced", "Advanced — Solar regulation & debounce", "regulation grace delay delai cooldown debounce threshold voltage", "Solar regulation", "Solar charging"],
    ["advanced", "Advanced — Home battery protection", "battery batterie discharge tolerance protection", "Home battery protection", "Home battery — advanced"],
    ["advanced", "Advanced — System, Notifications & Auth", "system storage retention timezone notifications telegram authentication password oidc", "System and storage", "System"],
  ];
  const normalized = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const matches = categories.filter(([, title, keywords]) => normalized.split(/\s+/).every(word => `${title} ${keywords}`.toLowerCase().includes(word)));
  return t.jsxs("div", { children: [
    t.jsx(P, { type: "search", "aria-label": "Search settings", placeholder: "Search settings…", value: query, onChange: event => setQuery(event.target.value) }),
    normalized && t.jsx("div", { "aria-live": "polite", style: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }, children: matches.length ? matches.map(([page, title, , section, focusLabel]) => t.jsx(w, { size: "1", variant: "soft", onClick: () => { onSelect(page, { section, focusLabel, query: normalized, token: Date.now() }); setQuery(""); }, children: title }, `${page}-${title}`)) : t.jsx(c, { size: "2", children: "No matching settings" }) }),
  ] });
}
