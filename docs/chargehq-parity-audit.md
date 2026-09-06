# E.V. Solar vs Charge HQ — functional parity audit

Audit date: 2026-09-06  
Baseline: `main` at `0b38c33`  
Audit branch: `feat/chargehq-parity-audit`

## Legend

- ✅ Present: production implementation covers the Charge HQ capability.
- 🟠 Partial: useful implementation exists, but not full parity or not exposed cleanly.
- ❌ Missing: no production implementation found.
- 🚀 E.V. Solar advantage: E.V. Solar already goes materially beyond Charge HQ.

## Dashboard and manual control

| Capability | Status | E.V. Solar implementation / gap |
| --- | --- | --- |
| Live charging state and power | ✅ | Vehicle card exposes charging state, kW, current, energy added and time remaining. |
| Live home / solar / grid / battery flows | ✅ | Dashboard energy overview and energy flow components consume live energy telemetry. |
| Stop mode | ✅ | Explicit `stop` mode has absolute precedence. |
| Solar + off-peak mode | 🚀 | `auto` combines real solar surplus outside schedules with scheduled/off-peak charging. |
| Solar-only mode | ✅ | `vacation` is the user-facing Solar mode and uses real excess solar. |
| Charge Now | ✅ | Explicit `charge_now` mode bypasses normal automation. |
| Manual current adjustment | ✅ | Current can be changed from the vehicle card while using Charge Now. |
| User-defined maximum charging current | ❌ | Hardware-reported `chargeAmpsMax` is respected, but there is no separate user safety cap equivalent to Charge HQ Max Charge Amps. |
| Dedicated default charging current | 🟠 | Schedules and live/manual current exist, but there is no dedicated global Default Charge Amps setting. |
| Exact decision explanation on Home | 🟠 | The engine emits structured `reason` + human-readable `detail`; Home mainly maps the reason to simplified messages and does not yet fully surface the detail. |

## Solar regulation

| Capability | Status | E.V. Solar implementation / gap |
| --- | --- | --- |
| Excess-solar tracking | ✅ | `SolarAllocator` derives usable surplus from grid flow, EV power and battery flow. |
| Solar Only | ✅ | Native user mode. |
| Solar + Grid fallback | 🟠 | The shared engine supports `solar_grid`, but the primary Smart UX intentionally uses Solar + off-peak instead of continuous grid fallback. |
| Solar margin | ✅ | Positive and negative `solarMarginKw` supported and exposed in Settings. |
| Minimum solar generation | ✅ | Configurable `minSolarGenerationKw`. |
| Minimum excess solar | ✅ | Configurable optional `minExcessSolarKw`. |
| Anti-cloud stop delay | ✅ | Configurable grace period, default 6 minutes. |
| Anti-cloud restart delay | ✅ | Configurable cooldown period, default 15 minutes. |
| Small-current-change debounce | 🚀 | Additional amp threshold + settle-time protection reduces Tesla API traffic and current oscillation. |
| Excess vs gross solar reference | ✅ | Engine supports both references; user Solar modes intentionally favor real excess. |
| EV charger excluded from consumption meter | ✅ | `consumptionExcludesCharging` supported. |
| Negative-consumption auto-detection | ❌ | No Charge HQ-style automatic negative-consumption mode was found. |
| Total inverter AC power cap | 🟠 | Solar forecast explicitly caps PV using inverter AC max; live control primarily relies on measured real excess rather than a separate runtime inverter-cap rule. |
| Single/three-phase awareness | ✅ | Voltage and phase count are used in watt-to-amp conversion, with live phase information where available. |
| Automatic 1-phase / 3-phase switching | ❌ | Not implemented. |

## Home battery management

| Capability | Status | E.V. Solar implementation / gap |
| --- | --- | --- |
| Home battery power and SOC | ✅ | Energy adapters expose battery power/SOC to the controller. |
| Battery priority | ✅ | `batteryPriorityEnabled` reserves solar for the home battery. |
| Battery priority SOC limit | ✅ | `batteryPriorityLimit` controls the reserve handoff point. |
| Start EV solar charge once reserve is reached | 🚀 | Dedicated reserve handoff logic and regression tests are present. |
| Prevent EV from draining home battery | 🚀 | Battery discharge tolerance + grace logic protects the home battery. |
| Schedule lock / safe battery handoff | 🚀 | Active scheduled charging can be suppressed when excessive home-battery discharge is detected. |
| EV-priority SOC limit | ❌ | No Charge HQ-style EV Priority Charge Limit was found. |
| Time-scheduled battery-vs-EV priority | ❌ | Priority cannot yet be scheduled by time period. |

## Schedules and tariffs

| Capability | Status | E.V. Solar implementation / gap |
| --- | --- | --- |
| Weekly schedules | ✅ | Days, start/end time, vehicle/global scope and enable state are supported. |
| Overnight schedules | ✅ | Correct previous-day handling for schedules crossing midnight. |
| Current per schedule | ✅ | `chargeAmps` per charge schedule. |
| SOC limit per schedule | ✅ | `chargeLimitPct` per charge schedule. |
| Do-not-charge blockout | ✅ | Native `blockout` schedule type. |
| Rule precedence | ✅ | Explicit modes, blockouts, schedules, solar and safety checks have deterministic precedence. |
| Static tariff / off-peak windows | ✅ | Tariff periods and rate-per-kWh storage are implemented. |
| One-off dated schedule | ❌ | Schedule schema is weekday-based; no one-time calendar date was found. |
| Temporary pause until next occurrence | 🟠 | A schedule can be disabled/enabled, but there is no pause-once semantic. |
| Departure-time target | ❌ | No departure-time planner was found. |
| Solar tracking inside a fixed charge schedule | ❌ | Charge schedules currently request their configured current rather than varying it with solar. |
| Dynamic market price trigger | ❌ | No Charge HQ-style Always Charge / Do Not Charge price thresholds. |
| Renewable-grid percentage trigger | ❌ | Not implemented. |
| Runtime subscribed-power limiter | ❌ | Subscribed kVA is modeled in solar forecast simulation, but is not yet a hard real-time controller limit. |

## Tesla, location and multi-EV

| Capability | Status | E.V. Solar implementation / gap |
| --- | --- | --- |
| Tesla Fleet API | ✅ | Official Fleet API integration, virtual-key flow and proxy support are present. |
| Live Tesla charging telemetry | ✅ | Charge state includes requested/actual current, voltage, phases, power, SOC, limit, energy and location. |
| Tesla Fleet Telemetry push stream | ❌ | Current adapter reads Fleet API `vehicle_data`; no persistent Tesla Fleet Telemetry stream was found. |
| Direct Tesla control independent of charger brand | ✅ | Commands target the Tesla vehicle itself. |
| Home location guard | 🚀 | Automation fails closed: only `isHome === true` permits automated home charging. |
| Away-from-home charging protection | 🚀 | Away charging is excluded from home automation and tracked separately in statistics. |
| External/manual control detection | 🟠 | Manual current changes and external charging transitions are detected, but there is no explicit Charge HQ-style paused-until-resume control state. |
| Optional override of external control | ❌ | No dedicated user setting equivalent to Charge HQ Override non-Charge HQ Control. |
| Multiple Tesla selection | 🚀 | Multiple Tesla vehicles can be configured in one installation. |
| Simultaneous multi-EV solar allocation | 🚀 | Shared allocator supports simultaneous eligible EVs with equal allocation or priority waterfall. This is a major advantage over Charge HQ. |

## History, attribution and costs

| Capability | Status | E.V. Solar implementation / gap |
| --- | --- | --- |
| Day / Month / Year views | ✅ | Native stats periods. |
| Total/all-years view | 🚀 | Additional total view exists. |
| 15-minute detail | 🚀 | Day stats support 15-minute resolution. |
| Solar / battery / grid attribution | ✅ | EV charging energy is split by source. |
| Home vs away attribution | ✅ | Separate home and away charging totals. |
| Self-Powered % | ✅ | Backend already calculated `(solar + home battery) / home charging`; this audit branch fixes the Stats UI to display that real KPI. |
| Grid charging cost | ✅ | EV grid cost is calculated. |
| Solar savings | ✅ | EV solar savings are calculated. |
| Tariff breakdown | ✅ | Cost can be broken down by configured tariff period. |
| Cost per kilometre | ❌ | No distance-normalised charging cost KPI found. |
| CSV data export | ❌ | No production CSV export endpoint/UI was found. |
| Historical migration/import tooling | 🚀 | Project includes Charge HQ migration and Solar.web history-import workflows in addition to native recording. |

## Integrations and platform

| Capability | Status | E.V. Solar implementation / gap |
| --- | --- | --- |
| Fronius Solar.web / cloud energy | ✅ | Dedicated Fronius Cloud adapter. |
| Fronius local | ✅ | Dedicated Fronius Local adapter also exists. |
| Home battery through Fronius | ✅ | Fronius energy data maps battery charge/discharge power and SOC into the shared energy model. |
| Enphase local | ✅ | Dedicated energy plugin. |
| Sigenergy local | ✅ | Dedicated energy plugin. |
| OCPP charger control | ❌ | No OCPP vehicle/charger-control plugin found. |
| Non-Tesla production vehicle control | ❌ | Vehicle plugins currently consist of Tesla and the simulator. |
| Generic push energy API | ❌ | No Charge HQ-style user Push API energy source found. |
| Web application | ✅ | Native web client/server architecture. |
| Household/multi-user account model | 🟠 | Authentication supports deployment access, but no dedicated household role/share model equivalent was identified. |

## Forecasting, intelligence and safety

| Capability | Status | E.V. Solar implementation / gap |
| --- | --- | --- |
| Solar forecast | 🚀 | Multi-provider forecast with inverter modelling. |
| Forecast uncertainty | 🚀 | P10/P50/P90 scenarios are simulated. |
| Learning from real production | 🚀 | Prediction model learns from historical/live production and provider performance. |
| Battery-aware forecast simulation | 🚀 | Capacity, charge/discharge limits, efficiency and SOC are modeled. |
| Tariff/schedule-aware forecast simulation | 🚀 | Forecast simulates schedules and tariffs. |
| Subscribed-power-aware forecast simulation | 🚀 | Forecast can model subscribed kVA even though runtime protection is not yet enforced. |
| Forecast-driven real-time control | 🟠 | Forecast is sophisticated but remains primarily advisory/simulation; it is not yet a full real-time decision layer. |
| Stale/missing energy fail-safe | 🚀 | Controller detects missing/stale/invalid telemetry, degrades safely and requires valid recovery samples. |
| Safe restart after interruption | 🚀 | Dedicated safe-start/resume logic and regression tests exist. |

## Priority gaps after this audit

### P0 — safety and control

1. Add a user-configurable **Max Charge Amps** cap and enforce it in Charge Now, schedules and solar allocation.
2. Add a hard **subscribed-power / grid-import limiter** to the real-time controller; forecast-only modelling is not enough for installation protection.
3. Keep strict home-location fail-closed behaviour and add regression coverage whenever Tesla location handling changes.

### P1 — explainability and optimisation

1. Surface the engine's numeric/human-readable decision `detail` on Home without adding a hidden menu.
2. Add an opt-in forecast-aware advisory/control layer, preserving deterministic safety and manual override precedence.
3. Add a one-off schedule / departure-target model rather than overloading weekly schedules.

### P2 — data portability and ecosystem

1. Add CSV export at 15-minute/day/month resolution.
2. Add cost-per-km once reliable vehicle distance data is available.
3. Consider OCPP and a generic energy Push API only after the Tesla/Fronius/BYD core is stable.

## Changes made by this audit branch

- Stats now displays the backend's true EV `selfPoweredPercent`, including both direct solar and home-battery energy.
- Stats copy now explains the self-powered energy quantity explicitly.
- Regression coverage verifies that home-battery charging contributes to the displayed percentage.

The high-risk controller changes above are deliberately separated from the KPI/UI fix so they can receive focused engine tests before merge.
