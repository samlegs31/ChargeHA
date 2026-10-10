# Installed Settings: simpler navigation and solar current ceiling

This is a scoped modification of the installed Settings chunk, explicitly requested
by the user. It preserves the current React/Radix design and reuses its typed
charging queries and mutations. It does not reconstruct the missing full frontend.

- `SolarCurrentSettings.js`: solar-only card, integer inputs, validation, cancel,
  load errors and saving states. Values come from `vehicleSolarCurrentLimits`.
- `ElectricalSettings.js`: existing general limits card with clearer labels.
- `Settings.original.js`: exact installed reference, verified against the original
  manifest and `patch.json`; not an alternative frontend.
- `Sections.js`: accessible sections using installed buttons and chevrons; children
  stay mounted so collapsing a section does not discard edits.
- `simplification.json`: exact, unique replacements for shorter help across Settings
  and grouped Advanced/history pages. Authentication warnings and handlers stay intact.
- `patch.py`: reproduces both scoped changes against the pinned original chunk.
  Unmatched or ambiguous anchors fail closed. Run with Python 3.
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

The six categories and existing design remain. Advanced options and history imports
start collapsed; each card retains its own Save action. Current limits remain
visible under My cars, with separate solar and all-mode limits. Help is shorter
across cars, energy, forecast, battery, tariffs and regulation. Negative solar margin,
grid use during grace, zero-solar stop and three-phase configuration remain explained.

Additional browser coverage exercises the actual Advanced/history compositions with
stub card contents: all seven sections, keyboard activation, aria-expanded, retention
of unsaved input through collapse/reopen, and mobile layout. Those stubs do not test
real authentication, imports or provider adapters. Complete frontend reconstruction
remains unavailable. No production installation is performed by these tools.

Validation of this simplification: browser checks passed; candidate integrity and
12 Python tests passed; backend format/lint/type checks passed; server/shared/plugin
suite passed (202 tests, 2,149 steps). Original pinned-version verification remains
expected to fail for the explicitly modified candidate. Production UI deployment
stays pending after the earlier automatic approval refusal; no Raspberry files or
saved vehicle settings were changed during this simplification.
