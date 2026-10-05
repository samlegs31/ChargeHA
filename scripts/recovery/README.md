# Restore the exact Raspberry version with Automatic charging + Reset

The October 5 update replaced the locally built premium interface with `main`.
The Raspberry's pre-update image is `evsolar:rollback-20261005-204734`, also
tagged `evsolar:safety-hotfix-20260916-114155-14287e1c`:

```
sha256:54862f48b17099a0cb8ebd33118ccfcb0d47ac3e28b94f079853260f12840c36
```

This recovery uses that exact local image. It preserves the September emergency
STOP, forced controller STOP, measured-amperage correction, direction-based
amperage debounce, vehicle manager, forecasts, integrations and complete UI.

The correction keeps `charging_enabled` under user control. Oscillation writes
an independent `safety_trip` latch before requesting the existing emergency
STOP. The engine stops automatic charging while that latch is active. Failed
STOP requests retain the latch and report the failure. Reset clears the latch
and alert without changing the switch or deleting the trip timestamp. Legacy
OFF preferences remain OFF until the user explicitly enables them.

The original React source for the premium UI is unavailable. Two pinned compiled
components are replaced using the readable functions in this directory:
Automatic charging in Settings, and the Dashboard safety banner. All original
69 visual assets are checked and retained byte for byte. A copy of the complete
asset graph is served under a new URL so cached chunks cannot mix React/tRPC
providers from different builds. Existing vehicle and energy components and
CSS are preserved.

`prepare.py` checks SHA-256 fingerprints of the exact saved files before making
changes. The deploy script builds and checks the corrected runtime before
stopping the current service. It then makes a consistent database backup,
preserves volume, encryption key and all port bindings, and restores the
previous image/data automatically if startup or health checks fail. It does not
pull `latest` or change the normal source checkout.

Run `scripts/restore-exact-evsolar.sh` from the reviewed recovery checkout on the
Raspberry. The image is created locally because the exact base image is only
available there. The script reports the corrected image, health, backup and
rollback tag. Reload the web app after successful completion.

Validation:

- `python3 scripts/recovery/check.py`: actual corrected Overseer, engine,
  ConfigService, ChargeController configuration and Reset router regressions in
  an isolated checkout.
- `python3 scripts/recovery/deployment.test.py`: fake-Docker failure/success
  tests covering fingerprint/extraction/build/backup/start/health failures,
  port preservation, pinned images and data rollback.
- The deployment additionally runs an offline type check and prepares the
  cached production graph against the exact saved runtime before replacing the
  live container.
