// Mount on first use, then preserve drafts on subsequent collapses.
// Reuse the installed Settings button, text and chevron components.
function EVSettingsSection({ title, children }) {
  const [open, setOpen] = g.useState(false);
  const [visited, setVisited] = g.useState(false);
  const id = g.useId();
  const pageCtx = g.useContext(EVSettingsPageContext);
  g.useEffect(() => {
    const targetSection = pageCtx?.activeSearch?.section;
    if (targetSection && title.toLowerCase().includes(targetSection.toLowerCase())) {
      setVisited(true);
      setOpen(true);
    }
  }, [pageCtx?.activeSearch?.token, pageCtx?.activeSearch?.section, title]);
  return t.jsxs("section", { "data-settings-section": title, children: [
    t.jsxs(w, {
      variant: "soft", size: "2", "aria-expanded": open, "aria-controls": id,
      onClick: () => { setVisited(true); setOpen(value => !value); },
      children: [t.jsx(open ? Mt : Dt, { size: 14 }), title],
    }),
    t.jsx("div", {
      id,
      hidden: !open,
      style: { marginTop: 16 },
      children: t.jsx(EVSectionOpenContext.Provider, { value: open, children: visited ? children : null }),
    }),
  ] });
}
