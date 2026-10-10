// Mount on first use, then preserve drafts on subsequent collapses.
// Reuse the installed Settings button, text and chevron components.
function EVSettingsSection({ title, children }) {
  const [open, setOpen] = g.useState(false);
  const [visited, setVisited] = g.useState(false);
  const id = g.useId();
  return t.jsxs("section", { children: [
    t.jsxs(w, {
      variant: "soft", size: "2", "aria-expanded": open, "aria-controls": id,
      onClick: () => { setVisited(true); setOpen(value => !value); },
      children: [t.jsx(open ? Mt : Dt, { size: 14 }), title],
    }),
    t.jsx("div", { id, hidden: !open, style: { marginTop: 16 }, children: visited ? children : null }),
  ] });
}
