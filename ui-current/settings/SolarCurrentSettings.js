// Uses the React, Radix and Settings primitives already shipped in the installed UI.
// 22 A is read from the server; no vehicle identity or default limit is hardcoded.
function Ds({ vehicles }) {
  return t.jsxs(g.Fragment, { children: [
    t.jsx(EVSolarCurrentSettings, { vehicles }),
    t.jsx(EVElectricalSettings, { vehicles }),
  ] });
}

function EVSolarCurrentSettings({ vehicles }) {
  const query = he();
  const mutation = ge();
  const { fields, setField, save, discard, saveStatus, isDirty } = K(query.data, mutation);
  const limits = fields?.vehicleSolarCurrentLimits ?? {};
  const invalid = Object.values(limits).some(value => !Number.isInteger(value) || value < 1 || value > 80);
  const saving = saveStatus.state === "saving";
  const fieldStyle = { border: 0, padding: 0, margin: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 };
  return t.jsx(F, {
    icon: t.jsx(_e, { size: 18 }),
    title: "Solar current limit",
    description: "Maximum current per car while following solar surplus.",
    saveStatus,
    isDirty,
    onSave: !invalid && fields && !query.isError ? save : undefined,
    action: isDirty ? t.jsx(w, { size: "1", variant: "soft", disabled: saving, onClick: discard, children: "Cancel" }) : undefined,
    children: t.jsxs("fieldset", { disabled: saving, style: fieldStyle, children: [
      t.jsx(c, { as: "p", size: "2", children: "Adjust by 1 A. Applies to Solar Only and Solar + Clock outside schedules." }),
      query.isError ? t.jsxs("div", { role: "alert", children: [
        t.jsx(c, { as: "p", size: "2", color: "red", children: "Could not load solar limits. Retry before making changes." }),
        t.jsx(w, { size: "1", onClick: () => query.refetch(), children: "Retry" }),
      ] }) : !fields ? t.jsx(c, { role: "status", size: "2", children: "Loading solar limits…" }) : vehicles.length === 0 ? t.jsx(c, { size: "2", children: "Add a vehicle to set its solar current limit." }) : vehicles.map(vehicle => t.jsx(x, {
        label: `${vehicle.name} — solar maximum`,
        help: "Leave empty to remove this vehicle's solar-only limit.",
        children: t.jsx(I, {
          value: limits[vehicle.id] == null ? "" : String(limits[vehicle.id]),
          "aria-label": `${vehicle.name} solar maximum current`,
          min: 1, max: 80, step: 1, suffix: "A", placeholder: "No limit",
          onChange: value => setField("vehicleSolarCurrentLimits", Rs(limits, vehicle.id, value)),
        }),
      }, vehicle.id)),
      invalid && t.jsx(c, { role: "alert", size: "2", color: "red", children: "Use a whole number from 1 to 80 A, or leave the field empty. Changes have not been saved." }),
      t.jsx(c, { as: "p", size: "1", color: "gray", children: "1–80 A. Below the car’s minimum, solar charging pauses. Available solar and lower electrical limits still apply." }),
      t.jsx(c, { as: "p", size: "1", color: "gray", children: "Charge Now, scheduled charging and manual commands are not capped here. External chargers retain control." }),
    ] }),
  });
}
