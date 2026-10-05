// The original Settings chunk provides these existing React/Radix bindings.
// Only this component is replaced; the rest of the premium UI stays intact.
function si() {
  const { data: charging, isLoading } = v.config.charging.get.useQuery(
    undefined,
    { refetchInterval: 5000 },
  );
  const saveMutation = ge();
  const utils = v.useUtils();
  const form = K(charging, saveMutation);
  const [resetError, setResetError] = g.useState(null);
  const reset = v.config.charging.resetSafetyStop.useMutation({
    onSuccess: async () => {
      setResetError(null);
      await Promise.all([
        utils.config.charging.get.invalidate(),
        utils.config.systemAlert.invalidate(),
      ]);
    },
    onError: (error) =>
      setResetError(
        error instanceof Error
          ? error.message
          : "Unable to reset the safety stop",
      ),
  });
  const safetyTripActive = charging?.chargingDisabledReason === "safety_trip";
  const unsavedSwitchChange = charging !== undefined &&
    form.fields?.chargingEnabled !== charging.chargingEnabled;
  if (isLoading) {
    return t.jsx(c, {
      size: "2",
      color: "gray",
      children: "Loading charging...",
    });
  }
  return t.jsx(F, {
    icon: t.jsx(pe, { size: 18 }),
    title: "Automatic charging",
    description: "Turn E.V. Solar automatic charging on or off.",
    saveStatus: form.saveStatus,
    isDirty: form.isDirty,
    onSave: form.save,
    children: t.jsxs(t.Fragment, {
      children: [
        t.jsx(x, {
          label: "Automatic charging",
          help:
            "Off pauses automatic start, stop and current changes. Your other settings are kept.",
          children: t.jsx(N, {
            size: "2",
            checked: form.fields?.chargingEnabled ?? true,
            onCheckedChange: (enabled) =>
              form.setField("chargingEnabled", enabled),
          }),
        }),
        safetyTripActive && t.jsx(x, {
          label: "Safety stop active",
          help: unsavedSwitchChange
            ? "Save your Automatic charging change before resetting the safety stop."
            : "Charging is suspended after repeated start/stop cycles. Review the cause, then reset the safety stop. This keeps your Automatic charging setting.",
          children: t.jsx(w, {
            type: "button",
            size: "2",
            variant: "soft",
            color: "orange",
            disabled: reset.isPending || unsavedSwitchChange,
            loading: reset.isPending,
            onClick: () => {
              setResetError(null);
              reset.mutate();
            },
            children: "Reset safety stop",
          }),
        }),
        resetError && t.jsx(c, {
          role: "alert",
          size: "2",
          color: "red",
          style: { display: "block", marginTop: 8 },
          children: resetError,
        }),
      ],
    }),
  });
}
