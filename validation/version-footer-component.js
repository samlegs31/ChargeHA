function EvsolarVersion() {
  const [version, setVersion] = h.useState(null);
  h.useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch("/version", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(value => {
        if (!controller.signal.aborted && value &&
            /^20\d{2}\.\d{2}\.\d{2}(?:\.[1-9]\d*)?$/.test(value.version) &&
            /^[0-9a-f]{7,40}$/.test(value.revision)) setVersion(value);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);
  return s.jsx("span", {
    title: version ? "Server version · " + version.revision : "Release identity unavailable",
    children: version ? "v" + version.version : "Version unavailable"
  });
}
