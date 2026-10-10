// Keep children mounted when closed: unsaved edits and query state survive.
// Reuse the installed Settings button, text and chevron components.
function EVSettingsSection({ title, children }) {
  const [open, setOpen] = g.useState(false);
  const id = g.useId();
  return t.jsxs("section", { children: [
    t.jsxs(w, {
      variant: "soft", size: "2", "aria-expanded": open, "aria-controls": id,
      onClick: () => setOpen(value => !value),
      children: [t.jsx(open ? Mt : Dt, { size: 14 }), title],
    }),
    t.jsx("div", { id, hidden: !open, style: { marginTop: 16 }, children }),
  ] });
}
