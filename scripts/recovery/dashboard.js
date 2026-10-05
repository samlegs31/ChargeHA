// Existing bindings and the original car/energy components are reused.
function oo({ onNavigateSettings }) {
  const { addToast } = O();
  const { data: energy } = Ee();
  const utils = m.useUtils();
  const { data: alertRaw } = m.config.systemAlert.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const { data: charging } = m.config.charging.get.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const alert = h.useMemo(() => {
    if (!alertRaw) return null;
    try {
      return JSON.parse(alertRaw);
    } catch {
      return null;
    }
  }, [alertRaw]);
  const safetyTripActive = charging?.chargingDisabledReason === "safety_trip";
  const dismiss = m.config.dismissSystemAlert.useMutation({
    onSuccess: () => utils.config.systemAlert.invalidate(),
    onError: (error) =>
      addToast(
        error instanceof Error ? error.message : "Failed to dismiss alert",
        "error",
      ),
  });
  const { data: pluginWarnings } = m.health.pluginWarnings.useQuery();
  return s.jsxs("div", {
    className: St.dashboard,
    children: [
      (alert || safetyTripActive) && s.jsx(D, {
        style: { borderLeft: "3px solid var(--red-9)" },
        children: s.jsxs("div", {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          },
          children: [
            s.jsx(X, {
              size: 20,
              style: { color: "var(--red-9)", flexShrink: 0 },
            }),
            s.jsxs("div", {
              style: { flex: 1 },
              children: [
                s.jsx(f, {
                  size: "2",
                  weight: "bold",
                  style: { display: "block" },
                  children: safetyTripActive
                    ? "Safety stop active"
                    : "Safety Alert",
                }),
                s.jsx(f, {
                  size: "2",
                  color: "gray",
                  children: alert?.message ??
                    "Automatic charging is suspended. Review the cause, then use Reset safety stop in Settings → My cars. Your Automatic charging setting is unchanged.",
                }),
              ],
            }),
            safetyTripActive && s.jsx($, {
              variant: "soft",
              color: "orange",
              size: "2",
              onClick: onNavigateSettings,
              children: "Open Settings",
            }),
            alert && s.jsx($, {
              variant: "soft",
              color: "red",
              size: "2",
              onClick: () => dismiss.mutate(),
              children: "Dismiss",
            }),
          ],
        }),
      }),
      s.jsx(ro, { onNavigateSettings }),
      s.jsx(Gr, { pluginWarnings: pluginWarnings ?? [] }),
      s.jsx(co, { at: energy?.lastUpdated ?? null }),
    ],
  });
}
