// Uses the React, Radix and Settings primitives already shipped in the installed UI.
// 22 A is read from the server; no vehicle identity or default limit is hardcoded.
function Ds({ vehicles }) {
  return t.jsxs(g.Fragment, { children: [
    t.jsx(EVSolarCurrentSettings, { vehicles }),
    t.jsx(EVElectricalSettings, { vehicles }),
  ] });
}

function EVSolarCurrentSettings({ vehicles }) {
  const lang = evUseLang();
  const fr = lang === "fr";
  const query = he();
  const mutation = ge();
  const { fields, setField, save, discard, saveStatus, isDirty } = K(query.data, mutation);
  const limits = fields?.vehicleSolarCurrentLimits ?? {};
  const invalid = Object.values(limits).some(value => !Number.isInteger(value) || value < 1 || value > 80);
  const saving = saveStatus.state === "saving";
  const fieldStyle = { border: 0, padding: 0, margin: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 };
  return t.jsx(F, {
    cardId: "solar-current",
    icon: t.jsx(_e, { size: 18 }),
    title: fr ? "Plafond de courant solaire (par voiture)" : "Solar current limit (per car)",
    description: fr
      ? "Courant maximal envoyé au véhicule pendant qu'il suit votre surplus solaire."
      : "Maximum current per car while following solar surplus.",
    scopes: ["solar"],
    guide: fr
      ? "Limite la puissance uniquement lorsque E.V. Solar suit vos panneaux (mode Solaire pur, ou Solaire + Heures creuses en dehors des plages programmées). Pratique pour garder de la marge pour la maison ou la batterie domestique sans brider vos recharges de nuit."
      : "Caps charging speed only while tracking solar panels (Solar Only, or Solar + Off-Peak outside scheduled windows). Keeps headroom for the home without slowing down overnight scheduled charges.",
    example: fr
      ? "Exemple : 22 A en monophasé 230 V ≈ 5,0 kW max au soleil. Laissez vide pour monter jusqu'au maximum électrique/voiture."
      : "Example: 22 A at 230 V single-phase ≈ 5.0 kW max on solar. Leave empty to allow up to the electrical and vehicle limits.",
    saveStatus,
    isDirty,
    onSave: !invalid && fields && !query.isError ? save : undefined,
    action: isDirty ? t.jsx(w, { size: "1", variant: "soft", disabled: saving, onClick: discard, children: fr ? "Annuler" : "Cancel" }) : undefined,
    children: t.jsxs("fieldset", { disabled: saving, style: fieldStyle, children: [
      t.jsx(c, { as: "p", size: "2", children: fr
        ? "Réglage par palier de 1 A. S'applique en Solaire pur et en Solaire + Heures creuses (hors plages programmées)."
        : "Adjust by 1 A. Applies to Solar Only and Solar + Off-Peak outside schedules." }),
      query.isError ? t.jsxs("div", { role: "alert", children: [
        t.jsx(c, { as: "p", size: "2", color: "red", children: fr
          ? "Impossible de charger les plafonds solaires. Réessayez avant de modifier."
          : "Could not load solar limits. Retry before making changes." }),
        t.jsx(w, { size: "1", onClick: () => query.refetch(), children: fr ? "Réessayer" : "Retry" }),
      ] }) : !fields ? t.jsx(c, { role: "status", size: "2", children: fr ? "Chargement des plafonds solaires…" : "Loading solar limits…" }) : vehicles.length === 0 ? t.jsx(c, { size: "2", children: fr ? "Ajoutez un véhicule pour définir son plafond de courant solaire." : "Add a vehicle to set its solar current limit." }) : vehicles.map(vehicle => t.jsx(x, {
        label: fr ? `${vehicle.name} — plafond solaire` : `${vehicle.name} — solar maximum`,
        help: fr ? "Laissez vide pour supprimer le plafond solaire de ce véhicule." : "Leave empty to remove this vehicle's solar-only limit.",
        children: t.jsx(I, {
          value: limits[vehicle.id] == null ? "" : String(limits[vehicle.id]),
          "aria-label": fr ? `${vehicle.name} courant maximal solaire` : `${vehicle.name} solar maximum current`,
          min: 1, max: 80, step: 1, suffix: "A", placeholder: fr ? "Sans limite" : "No limit",
          onChange: value => setField("vehicleSolarCurrentLimits", Rs(limits, vehicle.id, value)),
        }),
      }, vehicle.id)),
      invalid && t.jsx(c, { role: "alert", size: "2", color: "red", children: fr
        ? "Indiquez un nombre entier entre 1 et 80 A, ou laissez vide. Modifications non enregistrées."
        : "Use a whole number from 1 to 80 A, or leave the field empty. Changes have not been saved." }),
      t.jsx(c, { as: "p", size: "1", color: "gray", children: fr
        ? "1–80 A. Si la production disponible passe sous le minimum accepté par la voiture, la charge solaire se met en pause."
        : "1–80 A. Below the car’s minimum, solar charging pauses. Available solar and lower electrical limits still apply." }),
      t.jsx(c, { as: "p", size: "1", color: "gray", children: fr
        ? "Les modes Charge immédiate, Programmes et les commandes manuelles ne sont pas bridés ici. Les chargeurs externes gardent la main."
        : "Charge Now, scheduled charging and manual commands are not capped here. External chargers retain control." }),
    ] }),
  });
}
