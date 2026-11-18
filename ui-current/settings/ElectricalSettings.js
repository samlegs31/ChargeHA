function EVElectricalSettings({ vehicles: e }) {
  const lang = evUseLang();
  const fr = lang === "fr";
  const s = he();
  const r = ge();
  const { fields: a, setField: i, save: n, saveStatus: o, isDirty: l } = K(s.data, r);
  if (!a) return null;
  const d = a.vehicleCurrentLimits ?? {};
  return t.jsxs(F, {
    cardId: "electrical-limits",
    icon: t.jsx(_e, { size: 18 }),
    title: fr ? "Limites électriques et compteur — tous modes" : "Electrical limits — all modes",
    description: fr
      ? "Plafonds de sécurité appliqués dans tous les modes (solaire, programmes et commandes manuelles)."
      : "Limits for every charging mode, including schedules and manual commands.",
    scopes: ["safety"],
    guide: fr
      ? "Protège votre installation électrique quoi qu'il arrive : l'intensité par voiture ne dépasse jamais le maximum fixé ici, et le plafond réseau ralentit ou coupe la charge si la maison + la voiture approchent votre abonnement."
      : "Protects your installation in every mode: per-car current never exceeds your circuit rating, and the grid limit throttles or pauses charging if total home consumption approaches your contract limit.",
    example: fr
      ? "Exemple : contrat Linky 12 kVA → réglez l'import max sur 12 kW (≈ 52 A en 230 V) et le max voiture sur 32 A pour une prise/borne 7,4 kW."
      : "Example: 12 kVA utility contract → set grid import guard to 12 kW (≈ 52 A) and car max current to 32 A on a 7.4 kW wallbox.",
    onSave: n,
    saveStatus: o,
    isDirty: l,
    children: [
      e.map(u => t.jsx(x, {
        label: fr ? `${u.name} — intensité max (tous modes)` : `${u.name} maximum current — all modes`,
        help: fr
          ? "Limite matérielle du circuit ou de la borne. Vide = utilise le maximum annoncé par la voiture."
          : "Circuit limit. Empty uses the maximum reported by the car.",
        children: t.jsx(I, {
          value: d[u.id] == null ? "" : String(d[u.id]),
          "aria-label": fr ? `${u.name} intensité maximale tous modes` : `${u.name} maximum current — all modes`,
          min: 1, max: 80, step: 1, suffix: "A",
          placeholder: fr ? "Max véhicule (ex. 32)" : "Maximum charging current per vehicle",
          onChange: h => i("vehicleCurrentLimits", Rs(d, u.id, h)),
        }),
      }, u.id)),
      t.jsx(x, {
        label: fr ? "Puissance max soutirée du réseau (compteur)" : "Maximum power drawn from the grid",
        help: fr
          ? "Inclut toute la consommation de la maison. La charge ralentit ou se met en pause près de ce seuil. Vide = désactivé ; 0 = interdit tout import volontaire."
          : "Includes home consumption. Charging slows or pauses at this limit. Empty disables it; 0 prevents intentional import.",
        children: t.jsx(I, {
          value: a.maxGridImportKw == null ? "" : String(a.maxGridImportKw),
          "aria-label": fr ? "Puissance max soutirée du réseau" : "Maximum grid import",
          min: 0, max: 100, step: .1, suffix: "kW",
          placeholder: fr ? "Désactivé" : "Disabled",
          onChange: u => i("maxGridImportKw", u === "" ? null : Number(u)),
        }),
      }),
      t.jsx(EVSettingWarn, {
        title: fr ? "Sécurité électrique :" : "Electrical safety:",
        children: fr
          ? "la limite réseau dépend des mesures récentes de votre compteur. C'est une limite logicielle : elle ne remplace pas un disjoncteur ni les protections phase par phase."
          : "the grid limit requires fresh home energy readings. It is a software control limit, not a replacement for circuit protection or a per-phase breaker rating.",
      }),
    ],
  });
}
