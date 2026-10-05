# Overseer

The overseer is a safety watchdog that monitors the charge controller's decision
logs for signs of oscillation — rapid start/stop cycling that could damage
vehicle charging hardware or the electrical system. It runs independently from
the controller on its own timer.

Source: `packages/server/src/services/Overseer.ts`

## How it works

Every **60 seconds**, the overseer:

1. Queries `controller_logs` for all `start` and `stop` actions from the last
   **60 minutes**, ignoring any transitions before the last trip (so re-enabling
   charging doesn't immediately re-trip on the same history)
2. Groups those rows by vehicle ID (ordered by timestamp)
3. Counts **transitions** — each time the action flips between `start` and
   `stop`
4. If any vehicle exceeds **3 transitions** in the window, the overseer trips

### What counts as a transition

Only `start` and `stop` log entries are queried. Other actions (`adjust_amps`,
`none`) are ignored entirely.

A transition is when consecutive entries for the same vehicle alternate:

- `start` → `stop` = 1 transition
- `stop` → `start` = 1 transition
- `start` → `start` = 0 transitions (duplicate, no change)
- `stop` → `stop` = 0 transitions (duplicate, no change)

So a sequence of `start, stop, start, stop` = 3 transitions, which is within the
limit. Six alternating entries ending in `stop` give 5 transitions and trigger a
trip; a sequence ending in `start` waits for the safety gate below.

### Safety gate

The overseer only trips when the last logged action for the vehicle is `stop`.
If the vehicle is mid-charge (last action is `start`), it waits for the
controller to stop it naturally, then trips on the next check cycle. The safety
latch still makes the engine stop an active solar-mode charge if that logged
stop did not actually stop the vehicle.

## What happens when it trips

The overseer writes three config values to the database. It never writes
`charging_enabled`: the **Automatic charging** switch belongs to the user.

1. **`charging_disabled_reason` = `"safety_trip"`** — Persists the safety state
   independently from the dismissible alert. The decision engine checks this
   first and stops active `auto` and `vacation` charges, including a charge
   restarted outside E.V. Solar after the trip. Explicit `charge_now` remains
   under manual control and explicit `stop` remains absolute.

2. **`oscillation_trip_at`** — Timestamp of the trip. On subsequent checks, the
   overseer ignores transitions before this time, so re-enabling charging
   doesn't immediately re-trip.

3. **`system_alert`** — A JSON payload stored in the config table:
   ```json
   {
     "message": "Automatic charging suspended: Model 3 had 3 start/stop cycles in 60 minutes, which may indicate oscillation. Your Automatic charging setting is unchanged. Review the cause, then reset the safety stop in Settings.",
     "timestamp": "2026-03-02T10:30:00.000Z",
     "vehicleId": "LRW3E7EK...",
     "vehicleName": "Model 3"
   }
   ```

The overseer emits a `safety_trip` event on the `TypedEventEmitter` and logs an
error with the vehicle name, ID, and cycle count. `NotificationListener`
subscribes to `safety_trip` and forwards it to `NotificationService` for user
delivery — the overseer itself never calls `NotificationService` directly.

Only one trip is processed per check cycle (it stops after the first vehicle
that exceeds the threshold).

For databases created before `charging_disabled_reason` existed, a disabled
controller with an existing `oscillation_trip_at` marker is conservatively
treated as a safety trip. The next explicit enable or disable writes the new
reason and ends this compatibility inference.

## Recovery

Two independent actions are available to the user:

1. **Reset safety stop** — After reviewing the cause, use the dedicated button
   under Settings → My cars → Automatic charging. This calls
   `trpc.config.charging.resetSafetyStop` and clears the safety latch and its
   message. The switch keeps its current value: an enabled controller resumes,
   while a controller voluntarily disabled by the user stays disabled. The trip
   timestamp remains stored so the same history cannot immediately trip again.

2. **Dismiss the alert message** — This clears only `system_alert`. The safety
   latch stays active and the Dashboard still shows “Safety stop active”.

Explicitly turning Automatic charging on and saving also acknowledges a safety
stop, preserving compatibility with older installations. Existing switches that
were already turned off by an older Overseer stay off after the update until
explicitly enabled by the user.

## Dashboard alert banner

When `system_alert` is set, the Dashboard shows a red-accented card at the very
top (above the energy overview) with:

- An alert triangle icon
- The alert message and a "Safety Alert" heading
- A "Dismiss" button

The Dashboard polls for the alert every 30 seconds via
`trpc.config.systemAlert.useQuery`.

## Architecture

The overseer is fully decoupled from the charge controller:

- The **controller** writes log entries to `controller_logs` as part of its
  normal operation
- The **overseer** reads those log entries on its own schedule
- They share no in-memory state
- The overseer's only side effects are writing config values and sending a
  notification

This means the overseer would still catch oscillation even if the controller was
restarted during an oscillation event, since it reads from persisted logs.

## Constants

| Constant            | Value         | Description                                   |
| ------------------- | ------------- | --------------------------------------------- |
| `CHECK_INTERVAL_MS` | `60000` (60s) | How often the overseer runs its check         |
| `WINDOW_MINUTES`    | `60`          | Rolling window to look back for state changes |
| `MAX_TRANSITIONS`   | `3`           | Maximum allowed transitions before tripping   |
