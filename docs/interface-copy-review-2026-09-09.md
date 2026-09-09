# Interface copy review — 9 September 2026

Reviewed the current Home redesign on `design/premium-home-2026`, starting at
`9554b95`. The interface remains in English.

## Scope and decisions

| Area                      | Changes                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home and vehicle cards    | Distinguish scheduled charging from off-peak tariffs; use energy data rather than solar data for an unavailable reading. Keep actionable connection errors and charging reasons.                                              |
| Charging forecast         | Describe the predicted final battery level without attributing the entire level to today's sun. Remove the redundant local-estimate label.                                                                                    |
| Settings navigation       | Standardise Solar forecast, Electricity tariff and Electrical limits. Remove the instruction to choose a category and the duplicated history help card.                                                                       |
| Solar and home battery    | Shorten margins, thresholds, grace periods and reserve explanations. Retain zero-production stopping, negative-margin grid import, reserve gating and discharge protection.                                                   |
| Cars and imports          | Replace “old charges” with charging history; identify priority explicitly; remove the repeated selected-source readout. Describe historical imports as energy rather than detailed sessions.                                  |
| Electricity and equipment | Clarify that subscribed power in the forecast does not limit live charging. Retain circuit-limit, fresh-data, tariff replacement and credential warnings.                                                                     |
| Schedules and simulator   | Use Solar + Off-Peak, Solar Only, Charge Now and Stop consistently. Explain that schedules may run outside tariff off-peak hours and that Charge Now bypasses no-charge periods.                                              |
| Stats                     | Shorten headings and remove explanations already conveyed by the legend and per-car heading. Use All time for the period selector. Retain the solar-plus-home-battery definition of self-powered charging.                    |
| Setup and authentication  | Replace legacy product branding in visible copy, shorten the welcome screen and success messages, retain setup requirements and access warnings. A paired key no longer claims that commands have been verified.              |
| Notifications             | Align mode names, explain Stop's unplug reset, remove the unconditional full-rate and zero-grid claims, and distinguish charging started outside the app from charging away from home. Preserve event IDs and delivery rules. |
| Diagnostics and links     | Clarify log-tab labels. Keep raw errors, IDs and technical data needed for troubleshooting. Correct the version link to this fork's commit history.                                                                           |
| README                    | Align the mode table and schedule explanation with the interface. Preserve upstream attribution and licence links. Historical audit documents remain historical records.                                                      |

## Editorial rules

- Prefer a short label and one useful explanation over repeated introductions.
- Describe what the setting actually controls, including limits and exceptions.
- Keep mode labels stable across Home, schedules, simulator and notifications.
- Preserve accessibility labels, destructive-action explanations, security
  warnings and diagnostic information.
- Keep technical identifiers, routes, configuration keys and event names intact.

## Validation

- Deno 2.9.6 formatting and lint checks pass; `git diff --check` passes.
- Existing assertions were updated for revised visible copy. No controller,
  allocation, tariff-calculation or notification-dispatch logic was changed.
- Full local test/build validation is blocked: the environment refused npm
  dependency downloads (`Connection not allowed by ruleset`). No local test or
  rendered-preview success is claimed. GitHub CI must validate this revision.
