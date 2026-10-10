function EVSettingsSearch({ onSelect }) {
  const [query, setQuery] = g.useState("");
  const categories = [
    ["cars", "My cars — current limits", "solar solaire 22 a amp amps limit plafond voiture automatic charging"],
    ["home", "Solar & home", "energy energie inverter onduleur battery batterie location maison"],
    ["prediction", "Solar Prediction", "forecast prevision panels panneaux installation"],
    ["electricity", "Electricity price", "tariff tarif price prix cheap heures creuses"],
    ["history", "Charging history", "import historique charge hq wattpilot"],
    ["advanced", "Advanced settings", "regulation grace delay delai system notifications authentication mot de passe"],
  ];
  const normalized = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const matches = categories.filter(([, title, keywords]) => normalized.split(/\s+/).every(word => `${title} ${keywords}`.toLowerCase().includes(word)));
  return t.jsxs("div", { children: [
    t.jsx(P, { type: "search", "aria-label": "Search settings", placeholder: "Search settings…", value: query, onChange: event => setQuery(event.target.value) }),
    normalized && t.jsx("div", { "aria-live": "polite", style: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }, children: matches.length ? matches.map(([page, title]) => t.jsx(w, { size: "1", variant: "soft", onClick: () => { onSelect(page); setQuery(""); }, children: title }, page)) : t.jsx(c, { size: "2", children: "No matching settings" }) }),
  ] });
}
