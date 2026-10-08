// Integrated into the verified deployed entry bundle using its existing React
// and tRPC bindings. No historical client source is rebuilt or substituted.
function EVExternalChargingControl({ vehicleId, lastUpdated }) {
  const query = m.config.externalCharging.get.useQuery({ vehicleId }, {
    staleTime: 15000,
    refetchInterval: 30000,
    retry: 1,
  });
  const utils = m.useUtils();
  const [editing, setEditing] = h.useState(false);
  const [choice, setChoice] = h.useState("external");
  const mutation = m.config.externalCharging.set.useMutation({
    onSuccess: async () => {
      await utils.config.externalCharging.get.invalidate({ vehicleId });
      setEditing(false);
    },
  });
  const id = h.useId();
  const buttonStyle = {
    cursor: "pointer",
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid var(--gray-7)",
    background: "var(--gray-3)",
    color: "var(--gray-12)",
    font: "inherit",
    fontSize: 12,
  };
  const external = query.data?.external;
  return s.jsxs("section", {
    "aria-label": "Charging control",
    "data-testid": "external-charging-control",
    style: {
      margin: "8px 0 12px",
      padding: 12,
      borderRadius: 12,
      border: "1px solid var(--cyan-7)",
      background: "var(--cyan-2)",
      color: "var(--gray-12)",
    },
    children: [
      s.jsx(EVDataAge, { lastUpdated }),
      s.jsxs("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        },
        children: [
          s.jsx("strong", {
            style: { fontSize: 13 },
            children: query.isError
              ? "Charging control unavailable"
              : query.data?.label ?? "Loading charging control…",
          }),
          !editing && query.data &&
          s.jsx("button", {
            type: "button",
            style: buttonStyle,
            onClick: () => {
              setChoice(external ? "external" : "evsolar");
              mutation.reset();
              setEditing(true);
            },
            children: "Edit",
          }),
        ],
      }),
      query.data && s.jsx("p", {
        style: { fontSize: 12, margin: "6px 0 0", lineHeight: 1.5 },
        children: external
          ? "No automatic Tesla wake-ups or charging commands. Vehicle data may be out of date while the car is asleep."
          : "E.V. Solar manages charging automatically according to the selected mode.",
      }),
      query.isError &&
      s.jsx("button", {
        type: "button",
        style: buttonStyle,
        onClick: () => query.refetch(),
        children: "Retry",
      }),
      editing && s.jsxs("form", {
        onSubmit: (event) => {
          event.preventDefault();
          mutation.mutate({ vehicleId, external: choice === "external" });
        },
        style: { marginTop: 12 },
        children: [
          s.jsx("label", {
            htmlFor: id,
            style: { display: "block", fontSize: 12, marginBottom: 6 },
            children: "Charging controlled by",
          }),
          s.jsxs("select", {
            id,
            value: choice,
            disabled: mutation.isPending,
            onChange: (event) => setChoice(event.target.value),
            style: { ...buttonStyle, width: "100%", fontSize: 14 },
            children: [
              s.jsx("option", {
                value: "external",
                children: "External charger (Fronius, etc.)",
              }),
              s.jsx("option", { value: "evsolar", children: "E.V. Solar" }),
            ],
          }),
          choice === "evsolar" && external &&
          s.jsx("p", {
            style: { fontSize: 12, lineHeight: 1.5 },
            children:
              "Saving will allow E.V. Solar to wake this car and control its charging automatically again.",
          }),
          s.jsxs("div", {
            style: { display: "flex", gap: 8, marginTop: 10 },
            children: [
              s.jsx("button", {
                type: "submit",
                disabled: mutation.isPending,
                style: buttonStyle,
                children: mutation.isPending
                  ? "Saving…"
                  : "Save",
              }),
              s.jsx("button", {
                type: "button",
                disabled: mutation.isPending,
                style: buttonStyle,
                onClick: () => setEditing(false),
                children: "Cancel",
              }),
            ],
          }),
          mutation.isError &&
          s.jsx("p", {
            role: "alert",
            style: { color: "var(--red-11)", fontSize: 12 },
            children:
              "Could not confirm that your setting was saved. Please try again.",
          }),
        ],
      }),
    ],
  });
}

function EVDataAge({lastUpdated}) {
  const [now, setNow] = h.useState(Date.now);
  h.useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const parsed = Date.parse(lastUpdated || "");
  const valid = Number.isFinite(parsed) && parsed <= now + 60000;
  const minutes = valid ? Math.max(0, Math.floor((now - parsed) / 60000)) : null;
  const age = minutes === null ? "No vehicle data available" : minutes < 1 ? "Last updated just now" : minutes < 60 ? `Last updated ${minutes} min ago` : minutes < 1440 ? `Last updated ${Math.floor(minutes / 60)} h ago` : `Last updated ${Math.floor(minutes / 1440)} d ago`;
  return s.jsx("span", {style:{display:"block",fontSize:11,opacity:0.8,marginBottom:4}, title:valid ? new Date(parsed).toLocaleString() : undefined, children:age + (minutes !== null && minutes >= 2 ? " · Data may be out of date" : "")});
}
function EVChargingMode({vehicleId, mode, compact=false}) {
  const query = m.config.externalCharging.get.useQuery({vehicleId},{staleTime:15000,refetchInterval:30000,retry:1});
  if (!query.data) return s.jsx("span",{style:{fontSize:11},children:query.isError ? "Charging control unavailable" : "Loading charging control…"});
  if (query.data.external) return s.jsx("span", {className:compact ? x.compactMode : undefined,style:{fontSize:11,color:"var(--cyan-11)",whiteSpace:"normal",maxWidth:"100%"},children:"Controlled by an external charger"});
  return compact ? s.jsx("span",{className:x.compactMode,children:de[mode]}) : s.jsx(qa,{mode});
}
function EVManagedModes({vehicleId, children}) {
  const query = m.config.externalCharging.get.useQuery({vehicleId},{staleTime:15000,refetchInterval:30000,retry:1});
  return query.data && !query.data.external ? children : null;
}
