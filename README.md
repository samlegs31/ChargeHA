<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/client/public/ev-solar-logo-dark-exact.webp">
    <img src="packages/client/public/ev-solar-logo-exact.webp" alt="E.V. Solar" width="520">
  </picture>
</p>

# E.V. Solar

**E.V. Solar** is an intelligent EV charging platform built to use as much home
solar energy as possible while protecting the home battery and taking advantage
of low-cost electricity periods.

It combines live home-energy data, Tesla charging control, battery protection,
schedules and solar forecasting to decide **when the car should charge, how much
power it should use, and when charging should pause**.

> [!IMPORTANT]
> **Development status — Raspberry Pi only**
>
> E.V. Solar is currently **under active development** and is **only developed,
> deployed and validated on a 64-bit Raspberry Pi running Docker**.
>
> The current reference installation is based on a **Fronius GEN24 inverter +
> BYD Battery-Box Premium HVS home battery**. The main development system uses a
> **Fronius Primo GEN24 6.0 Plus with a BYD HVS 7.7**.
>
> Other integrations inherited from ChargeHA may still exist in the codebase,
> but they are **not currently considered part of the validated E.V. Solar
> setup**.
>
> E.V. Solar is not yet a finished consumer product. Expect frequent changes
> while the charging logic, forecasting, history, user interface and deployment
> model continue to evolve.

## Latest updates — August 2026

Recent development has focused on making E.V. Solar simpler to understand while
improving the quality of its charging predictions.

- **Simplified home dashboard** with a cleaner, mobile-first interface.
- **Redesigned live energy flows** showing the real source and destination of
  solar, battery, grid and EV power.
- **Predictive multi-vehicle home view** with one primary vehicle and quick
  access to additional cars.
- **Tesla charge-limit control** directly from E.V. Solar when the vehicle is
  connected.
- **Local and explainable charging forecast** with expected solar energy,
  predicted vehicle SOC and forecast-confidence indication.
- **Dedicated Solar Prediction settings** separated from advanced system
  settings.
- **Home-equipment modelling** including inverter limits, battery
  capacity/power/efficiency and subscribed grid power.
- Built-in reference equipment profile for **GEN24 6.0 + BYD HVS 7.7**.
- **Off-peak tariff windows included in charging forecasts**.
- **Simplified Stats and Settings**, including a more compact mobile
  presentation.
- **Updated Smart Charge / Schedule wording** so charging targets and scheduled
  behaviour are easier to understand.
- Charging-history tools now include migration/import foundations for historical
  EV data, including **Solar.web home/Wattpilot history** and ChargeHQ sources.

## What E.V. Solar does today

### ☀️ Solar-first EV charging

E.V. Solar continuously evaluates the solar power that is genuinely available
for the car and adjusts Tesla charging accordingly.

It does not simply look at grid export. Home-battery discharge is removed from
the apparent solar surplus so the EV does not silently drain the stationary
battery while being reported as "solar charging".

### 🔋 Home-battery protection

The home battery is part of every charging decision.

E.V. Solar can use:

- minimum home-battery SOC,
- battery charge/discharge power,
- configurable discharge tolerance,
- grace periods before stopping the car,
- genuine solar surplus after battery behaviour is taken into account.

The objective is to **charge the car from real excess solar energy without
sacrificing household battery autonomy**.

The currently validated battery environment is **BYD Battery-Box Premium HVS
connected to a Fronius GEN24 installation**.

### 🚗 Tesla smart charging

Tesla Fleet API integration provides:

- vehicle state and SOC,
- plugged-in and home detection,
- charging start and stop,
- charging-current control,
- charge-limit control,
- charging targets and charging status.

### ⚡ Simple charging modes

E.V. Solar keeps the main charging choices intentionally simple:

- **STOP** — no automatic charging.
- **CHARGE NOW** — charge immediately at the configured power.
- **SOLAR ONLY** — use available solar excess while respecting home-battery
  rules.
- **SOLAR + schedule / Smart Charge** — use solar normally, then allow
  scheduled/off-peak charging when required.

Schedules can use off-peak electricity periods and a target vehicle SOC.

### 🏠 Real-time home energy view

The dashboard combines the main power flows in one place:

- PV production,
- grid import/export,
- home consumption,
- home-battery SOC and power,
- EV charging power and state.

The current energy-flow interface is designed to make the source of EV charging
immediately understandable: **solar, grid or a mixture of both**.

### 🚙 Multi-vehicle home

E.V. Solar supports more than one Tesla in the home view.

A primary vehicle remains the focus of the dashboard while additional vehicles
stay accessible through a compact secondary-car view. The user can quickly
switch which car is shown as the main vehicle.

### 📊 Charging history and energy attribution

E.V. Solar records charging and energy history so charging sessions can be
analysed over time.

History tooling includes support for importing older charging data without
confusing EV-delivered solar energy with total PV production. Current migration
work includes ChargeHQ history and one-time **Solar.web home/Wattpilot archive
import**.

Historical import is separate from the active real-time energy source.

### 🌤️ Solar charging forecast

E.V. Solar includes an **informational charging forecast** designed to answer
practical questions such as:

- How much useful solar energy may still reach the car today?
- What SOC could the Tesla reach by the end of the solar day?
- How reliable is the current estimate?
- If Smart Charge is enabled, when could the target SOC be reached?

The forecast currently uses information such as:

- site location,
- PV array size, orientation and tilt,
- installation age and panel degradation,
- tilted irradiance forecasts,
- outdoor temperature,
- live Fronius production for correction,
- recent household load,
- Tesla SOC and charging state,
- home-battery state,
- inverter AC output limit,
- battery usable capacity and power limits,
- battery round-trip efficiency,
- subscribed grid power,
- configured electricity tariff and off-peak windows,
- actual E.V. Solar charging rules.

A dedicated **Solar Prediction** settings page allows the installation
parameters used by the prediction engine to be reviewed and adjusted.

The reference profile currently includes:

```text
Fronius Primo GEN24 6.0 Plus
BYD Battery-Box Premium HVS 7.7
```

The current weather implementation uses Open-Meteo with Météo-France forecast
data where available.

**Forecasting is deliberately separated from charging control.** A forecast
failure cannot directly start, stop or change vehicle charging.

### 🔔 Notifications

Telegram notifications can report important charging events, errors and
target-related information.

### 🔐 Self-hosted and security-focused

E.V. Solar is designed to keep control of the installation in the user's hands.

The current deployment includes:

- Argon2id local authentication,
- minimum password-length enforcement,
- secure session cookies,
- escalating brute-force delay,
- AES-256-GCM encryption for stored secrets,
- Docker secret support for the encryption key,
- non-root container execution,
- read-only root filesystem,
- dropped Linux capabilities,
- `no-new-privileges`,
- restricted temporary filesystem,
- hardened trusted-proxy handling,
- OIDC HTTPS/SSRF protections,
- loopback-bound Tesla HTTP proxy.

## Current integrations

| Category          | Integration                       | E.V. Solar status                                                                                          |
| ----------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Vehicle           | **Tesla**                         | Active development and real-world use through Fleet API, virtual key, SOC, home state and charging control |
| Inverter / energy | **Fronius GEN24 local**           | **Current validated real-time energy source**                                                              |
| Home battery      | **BYD Battery-Box Premium HVS**   | **Current validated battery platform with Fronius GEN24**                                                  |
| History           | **Fronius Solar.web / Wattpilot** | One-time historical home-EV archive import; not the primary real-time source                               |
| History           | ChargeHQ                          | Historical EV charging import/migration support                                                            |
| Energy            | Sigenergy local                   | Inherited from ChargeHA; not part of the current validated E.V. Solar setup                                |
| Energy            | Enphase local                     | Inherited from ChargeHA; not part of the current validated E.V. Solar setup                                |
| Notifications     | **Telegram**                      | Charging events, errors and target information                                                             |
| Authentication    | Local / OIDC                      | Hardened local authentication plus OIDC support                                                            |

## How E.V. Solar makes a charging decision

The controller combines several signals instead of relying on a single
measurement:

1. **How much solar is being produced?**
2. **How much power is the house using?**
3. **Is the BYD home battery charging or discharging?**
4. **How much genuine surplus is left for the EV?**
5. **What charging mode is active?**
6. **Is a scheduled/off-peak period active?**
7. **What is the Tesla SOC and requested target?**
8. **Should temporary clouds be tolerated before changing the charge state?**

The charging controller remains the single authority for vehicle commands.
Forecasting can inform the user and simulate future behaviour, but it cannot
directly control the car.

## Roadmap

E.V. Solar is moving from a solar-aware charging controller toward a broader
**intelligent home-energy platform**, but development remains focused first on
making the Raspberry Pi + Fronius GEN24 + BYD HVS setup reliable and easy to
use.

### 🧠 Smarter solar forecasting

Planned improvements include:

- stronger calibration from local production history,
- better use of recent forecast errors,
- improved inverter and weather modelling,
- better prediction of the EV SOC achievable from the next solar window,
- continued improvement of forecast-confidence scoring.

The goal is not only to predict PV production, but to predict **how much useful
energy will actually reach the car**.

### ☁️ Fronius Solar.web

Solar.web is already used for historical import work. A broader future
integration may allow more Fronius information to be retrieved without requiring
direct LAN access to the inverter.

For now, the validated live-energy architecture remains **local Fronius GEN24 →
Raspberry Pi → E.V. Solar**.

### 🔋 More advanced battery strategies

Future battery logic may include:

- smarter reserve targets,
- time-of-day battery priorities,
- forecast-based decisions on whether energy should go to the home battery or
  the car,
- anticipation of poor-weather days,
- improved coordination between PV, battery and EV demand.

### 💶 Electricity-price optimisation

E.V. Solar is intended to combine solar charging with electricity-price
information so it can choose between:

- immediate solar charging,
- waiting for future solar production,
- scheduled off-peak charging,
- future dynamic-price opportunities.

### 🔌 Fronius Wattpilot

Solar.web/Wattpilot history import is already part of the migration tooling.
Deeper Wattpilot control remains a later development goal.

### 🌐 Server / VPS deployment

**Server/VPS deployment is not currently supported.**

E.V. Solar is presently a Raspberry Pi application. A future architecture may
allow a low-cost hosted deployment when the required cloud-accessible energy
integrations are mature enough.

### 🚙 Broader ecosystem support

Longer-term development can extend the same energy logic to additional EVs,
chargers, inverters and energy systems without changing the core principle:
**use the cleanest and cheapest available energy while preserving user
control**.

### 💾 Backup, recovery and migration

Planned work also includes clearer installation, backup, disaster-recovery and
migration tooling so an E.V. Solar installation can be restored reliably.

## Raspberry Pi / Docker

E.V. Solar is currently developed and tested on a **64-bit Raspberry Pi running
Debian and Docker**.

At this stage, this is the **only supported deployment target for the E.V. Solar
development build**.

Build from the repository root:

```bash
DOCKER_BUILDKIT=1 docker build \
  --network=host \
  -f docker/Dockerfile \
  -t evsolar:local \
  .
```

Generate and **permanently keep** an encryption key:

```bash
mkdir -p ~/.config/evsolar
openssl rand -base64 32 > ~/.config/evsolar/encryption_key
chmod 600 ~/.config/evsolar/encryption_key
```

The encryption key is required to decrypt stored Tesla/Fronius secrets. Losing
it can make encrypted configuration unusable.

A hardened container can then use:

```bash
docker run -d \
  --name chargeha \
  --restart unless-stopped \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 256 \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -e ENCRYPTION_KEY_FILE=/run/secrets/evsolar_encryption_key \
  -v "$HOME/.config/evsolar/encryption_key:/run/secrets/evsolar_encryption_key:ro" \
  -v chargeha-data:/app/data \
  -p 127.0.0.1:8000:8000 \
  evsolar:local
```

Adapt the network binding if LAN access is required. Do not expose the
application directly to the public Internet without an appropriate
HTTPS/authentication architecture.

## Data and backups

For disaster recovery, keep independent copies of:

1. the Git repository and E.V. Solar version/tag,
2. a known-good exported Docker image,
3. the `chargeha-data` Docker volume,
4. `~/.config/evsolar/encryption_key`,
5. deployment/restoration instructions.

The source repository alone is **not** a complete backup because the database
and encryption key contain installation-specific configuration and secrets.

## Project origin and licence

E.V. Solar is a modified fork of **ChargeHA** by `startswithaj`.

Original project:

- https://github.com/startswithaj/ChargeHA

The upstream project is licensed under the **GNU Affero General Public License
v3.0 (AGPL-3.0)**. E.V. Solar remains subject to that licence. See
[`LICENSE`](LICENSE).

Changes specific to E.V. Solar are identified through this repository's Git
history.

E.V. Solar is not affiliated with or endorsed by Tesla, Fronius, BYD,
Open-Meteo, Météo-France or ChargeHQ.

---

**E.V. Solar** — intelligent solar EV charging for Raspberry Pi, Fronius GEN24,
BYD HVS and Tesla.
