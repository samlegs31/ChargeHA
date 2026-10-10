# Installed Settings: editable solar current ceiling

This is a scoped modification of the installed Settings chunk, explicitly requested
by the user. It preserves the current React/Radix design and reuses its typed
charging queries and mutations. It does not reconstruct the missing full frontend.

- `SolarCurrentSettings.js`: solar-only card, integer inputs, validation, cancel,
  load errors and saving states. Values come from `vehicleSolarCurrentLimits`.
- `ElectricalSettings.js`: existing general limits card with clearer labels.
- `Settings.original.js`: exact installed reference, verified against the original
  manifest and `patch.json`; not an alternative frontend.
- `patch.py`: replaces the unique original limits component, preserving the rest
  of the chunk byte for byte. Run from any directory with Python 3.
- `preview.py`: generates an ignored local fixture using the shipped React/Radix
  widgets, the real draft/save handling, and mock data instead of production.
- `check.cjs`: browser interaction tests with Playwright. Only localhost is allowed.

```sh
python3 ui-current/settings/patch.py
python3 ui-current/settings/preview.py
python3 -m http.server 8778 --bind 127.0.0.1
# In another terminal, with Node, Playwright and a Chromium browser installed:
BROWSER_PATH=/path/to/browser node ui-current/settings/check.cjs
```

The integrity checker permits only the reviewed SHA256 of this exact Settings
asset. Other installed frontend files remain protected, and the original
`current/manifest.json` stays untouched. Regenerating a changed component requires
review, tests, an explicit new approved hash and a new candidate manifest.

Browser coverage: initial server value, 1 A arrows, cancel without write, save,
reload persistence, decimal/out-of-range rejection, API failure/retry, empty value
removal, preserving another vehicle, query failure/retry, desktop and mobile layout.
Production vehicle settings are never edited by this fixture. It is a component
integration test, not an authenticated end-to-end test against real vehicles.
