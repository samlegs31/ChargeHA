# Electrical limits and recovery — September 2026

This delivery implements the first reliability phase of the September audit. It
preserves the configured home-battery reserve and leaves new limits disabled
until explicitly configured in **Settings → My cars → Charging limits**.

## Power allocation

Solar allocation uses a shared watt budget, then converts each share using that
vehicle's voltage and phase count. Equal sharing redistributes unused power when
a car reaches its current cap; priority sharing subtracts actual watts from the
remaining budget. Regression tests include mixed single/three-phase vehicles.
Existing solar grace periods remain intentional temporary exceptions to strict
surplus matching; electrical limits are checked after those decisions.

## Optional electrical limits

- **Maximum current per vehicle:** a configured ceiling in amperes. The
  vehicle's own lower maximum still applies. A ceiling below its minimum
  prevents charging rather than being rounded up to the minimum.
- **Maximum grid import:** whole-home active power in kW. Empty disables the
  setting; zero requests no grid import. It is distinct from subscribed kVA and
  does not measure or protect individual phase currents.
- Limits apply to Solar, Smart, Now, schedules and direct current/start
  commands. Home grid regulation excludes vehicles confirmed away from home.
- An enabled grid limit requires recent, valid home energy data. Missing data or
  an unconfirmed home location blocks a direct home start. Controller decisions
  reduce or stop an existing home charge when required.
- Solar still charging the home battery can be reassigned once the enabled
  reserve is reached, including with a zero-import setting. The 80% handoff is
  preserved.

The pure engine applies a final power guard shared with forecasting. A second
check at the command boundary covers direct API commands and reserves additional
power between meter readings. Commands are serialized; a stop cancels older
queued starts. Reductions are not credited again against the same meter sample.
These are feedback controls subject to measurement and command latency, not
instantaneous electrical protection. No automatic values are inferred from a
breaker size or subscription.

## Home and restart behaviour

A connected vehicle can show the detailed waiting reason directly beneath its
status. Away vehicles do not display unrelated home-battery waiting details.
Charging status remains based on vehicle telemetry.

Battery-protected schedule blocks are persisted before commands. A restarted
controller restores a block only for the same active schedule occurrence,
including overnight windows. A later occurrence starts clean. Other controller
runtime timers remain in memory; this change does not claim full restoration of
all runtime state.

## Update recovery

The versioned update script now requires the expected image revision, pins the
image ID and prevents Compose from pulling a different image during startup.
Recovery is installed before stopping or copying data. If the backup fails, the
old container is restarted and no new image is launched. A successful deployment
requires Docker health confirmation. Fake-Docker tests exercise backup failure,
wrong revision and successful pinned-image startup; they run locally and in CI.

## Validation and later work

Tests cover budget conservation over different voltages/phases/caps, direct
commands, zero-import reserve handoff, low-current blocking, missing energy,
stop precedence, schedule recovery and visible UI settings/reasons.

Departure planning, forecast policy consolidation, trace replay, Fleet
Telemetry, iPhone notifications and durable Solar.web import jobs remain
separate delivery phases. This release does not enable those features or
configure external services.
