// Mount on first use, then preserve drafts on subsequent collapses.
// Reuse the installed Settings button, text and chevron components.
function EVSettingsSection({ sectionId, title, badge, summary, children }) {
  const [open, setOpen] = g.useState(false);
  const [visited, setVisited] = g.useState(false);
  const id = g.useId();
  const pageCtx = g.useContext(EVSettingsPageContext);
  g.useEffect(() => {
    const targetSection = pageCtx?.activeSearch?.section;
    const targetId = pageCtx?.activeSearch?.sectionId;
    if (
      (targetId && sectionId && targetId === sectionId) ||
      (targetSection && title.toLowerCase().includes(targetSection.toLowerCase()))
    ) {
      setVisited(true);
      setOpen(true);
    }
  }, [pageCtx?.activeSearch?.token, pageCtx?.activeSearch?.section, pageCtx?.activeSearch?.sectionId, sectionId, title]);
  return t.jsxs("section", { "data-settings-section": title, "data-settings-section-id": sectionId || undefined, children: [
    t.jsxs("div", {
      className: "ev-section-header",
      children: [
        t.jsxs("div", {
          className: "ev-section-meta",
          children: [
            t.jsxs(w, {
              variant: "soft", size: "2", "aria-expanded": open, "aria-controls": id,
              onClick: () => { setVisited(true); setOpen(value => !value); },
              children: [t.jsx(open ? Mt : Dt, { size: 14 }), title],
            }),
            badge && t.jsx(EVScopeBadges, { scopes: Array.isArray(badge) ? badge : [badge] }),
          ],
        }),
        summary && t.jsx("div", { className: "ev-section-summary", children: summary }),
      ],
    }),
    t.jsx("div", {
      id,
      hidden: !open,
      style: { marginTop: 16 },
      children: t.jsx(EVSectionOpenContext.Provider, { value: open, children: visited ? children : null }),
    }),
  ] });
}
