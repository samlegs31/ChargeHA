<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/client/public/ev-solar-logo-dark-exact.webp">
    <img src="packages/client/public/ev-solar-logo-exact.webp" alt="E.V. Solar" width="520">
  </picture>
</p>

# E.V. Solar

**E.V. Solar** is an intelligent EV charging platform built to use as much home solar energy as possible while protecting the home battery and taking advantage of low-cost electricity periods.

It combines live energy data, Tesla charging control, battery rules, schedules and solar forecasting to decide **when the car should charge, how much power it should use, and when charging should pause**.

The project is currently developed around **Tesla + Fronius + home-battery installations**, with a broader goal: become a complete energy assistant able to coordinate the EV, solar production, battery storage, electricity tariffs and future energy forecasts.

> **Current branch:** `main`
>
> **Status:** actively developed and tested in a real home installation using Raspberry Pi + Docker. A more flexible server/VPS architecture is planned for the future.

## What E.V. Solar does today

### ☀️ Solar-first EV charging

E.V. Solar continuously evaluates the solar power that is really available for the car and adjusts Tesla charging accordingly.

It does not simply look at grid export: home-battery discharge is removed from the apparent surplus so the EV does not silently drain the stationary battery while being reported as "solar charging".

### 🔋 Home-battery protection

The home battery remains part of the charging decision.

E.V. Solar can use:

- minimum battery SOC,
- battery charge/discharge power,
- configurable discharge tolerance,
- grace periods before stopping the car,
- solar surplus after battery behaviour is taken into account.

The objective is to **charge the car from genuine excess energy without sacrificing household battery autonomy**.

### 🚗 Tesla smart charging

Tesla Fleet API integration provides:

- vehicle state and SOC,
- plugged-in / home detection,
- charging start and stop,
- charging-current control,
- charging targets and charging status.

### ⚡ Solar and off-peak charging modes

E.V. Solar offers simple operating modes for different needs:

- **STOP** — no automatic charging.
- **CHARGE NOW** — charge immediately at the configured power.
- **SOLAR ONLY** — use available solar excess while respecting home-battery rules.
- **SOLAR + schedule** — use solar normally, then allow scheduled/off-peak charging when required.

Schedules can be configured in 10-minute increments and can include a target vehicle SOC.

### 🏠 Real-time home energy view

The dashboard combines the main power flows in one place:

- PV production,
- grid import/export,
- home consumption,
- home-battery SOC and power,
- EV charging power and state.

### 📊 Charging history and energy attribution

E.V. Solar records charging and energy history so charging sessions can be analysed over time.

The project also includes ChargeHQ-history import foundations for using historical EV charging information without confusing EV-delivered solar energy with total PV production.

### 🌤️ Solar charging forecast

E.V. Solar includes an **informational solar charge forecast** designed to answer practical questions such as:

- How much solar energy may still be available today?
- What SOC could the Tesla reach by the end of the solar day?
- If scheduled charging is enabled, when could the target SOC be reached?

Example:

```text
☀️ Solar end 19:24 · +3.7 kWh · 67% tonight
🌙 Target 80% estimated around 04:32
```

The forecast currently uses:

- site location,
- PV array size, orientation and tilt,
- installation age and panel degradation,
- tilted irradiance forecasts,
- outdoor temperature,
- live Fronius production for correction,
- recent household load,
- Tesla SOC and charging state,
- home-battery state,
- actual E.V. Solar charging rules.

The current implementation uses Open-Meteo with Météo-France forecast data where available.

**Forecasting is deliberately separated from charging control.** A forecast failure cannot start, stop or change vehicle charging.

### 🔔 Notifications

Telegram notifications can report important charging events, errors and target-related information.

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

| Category | Integration | Current use |
| --- | --- | --- |
| Vehicle | **Tesla** | Fleet API, virtual key, SOC, location/home state and charge control |
| Energy | **Fronius local** | PV, grid and home-battery data over the local network |
| Energy | Fronius cloud | Existing inherited support; E.V. Solar-specific Solar.web work is planned |
| Energy | Sigenergy local | Inherited from ChargeHA |
| Energy | Enphase local | Inherited from ChargeHA |
| Notifications | **Telegram** | Charging events, errors and targets |
| Authentication | Local / OIDC | Local hardened authentication plus OIDC support |

## How E.V. Solar makes a charging decision

The controller combines several signals instead of relying on a single measurement:

1. **How much solar is being produced?**
2. **How much power is the house using?**
3. **Is the home battery charging or discharging?**
4. **How much genuine surplus is left for the EV?**
5. **What charging mode is active?**
6. **Is an off-peak/scheduled period active?**
7. **What is the Tesla SOC and requested target?**
8. **Should temporary clouds be tolerated before changing the charge state?**

The charging controller remains the single authority for vehicle commands. Forecasting can inform the user and simulate future behaviour, but it cannot directly control the car.

## Roadmap

E.V. Solar is moving from a solar-aware charging controller toward a broader **intelligent home-energy platform**.

### 🧠 Smarter solar forecasting

Planned improvements include:

- a clearer numerical forecast-confidence score,
- stronger calibration from local production history,
- better use of recent forecast errors,
- inverter-specific efficiency and AC-output limits,
- improved temperature and weather corrections,
- better prediction of the EV SOC achievable from the next solar window.

The goal is not only to predict PV production, but to predict **how much useful energy will actually reach the car**.

### ☁️ Fronius Solar.web integration

A future Solar.web integration is planned so E.V. Solar can retrieve Fronius information without requiring direct LAN access to the inverter.

The intended architecture is suitable for a hosted E.V. Solar service while keeping user credentials and permissions as limited as possible.

### 🔋 More advanced battery strategies

Future battery logic may include:

- smarter reserve targets,
- time-of-day battery priorities,
- forecast-based decisions on whether energy should go to the home battery or the car,
- anticipation of poor-weather days,
- improved coordination between PV, battery and EV demand.

### 💶 Electricity-price optimisation

E.V. Solar is intended to combine solar charging with electricity-price information so it can choose between:

- immediate solar charging,
- waiting for future solar production,
- scheduled off-peak charging,
- future dynamic-price opportunities.

### 🔌 Fronius Wattpilot

Wattpilot integration is planned as a later project so E.V. Solar can coordinate Fronius charging hardware directly alongside Tesla charging control.

### 🌐 Server / VPS deployment

The current installation is local and self-hosted. A future architecture is planned to allow E.V. Solar to run on a low-cost server/VPS, reducing the need for dedicated hardware in the home when cloud-accessible integrations are available.

### 🚙 Broader ecosystem support

Longer-term development can extend the same energy logic to additional EVs, chargers, inverters and energy systems without changing the core principle: **use the cleanest and cheapest available energy while preserving user control**.

### 💾 Backup, recovery and migration

Planned work also includes clearer installation, backup, disaster-recovery and migration tooling so an E.V. Solar installation can be restored reliably.

## Raspberry Pi / Docker

The current E.V. Solar deployment is developed and tested on a 64-bit Raspberry Pi running Debian and Docker.

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

The encryption key is required to decrypt stored Tesla/Fronius secrets. Losing it can make encrypted configuration unusable.

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

Adapt the network binding if LAN access is required. Do not expose the application directly to the public Internet without an appropriate HTTPS/authentication architecture.

## Data and backups

For disaster recovery, keep independent copies of:

1. the Git repository and E.V. Solar version/tag,
2. a known-good exported Docker image,
3. the `chargeha-data` Docker volume,
4. `~/.config/evsolar/encryption_key`,
5. deployment/restoration instructions.

The source repository alone is **not** a complete backup because the database and encryption key contain installation-specific configuration and secrets.

## Project origin and licence

E.V. Solar is a modified fork of **ChargeHA** by `startswithaj`.

Original project:

- https://github.com/startswithaj/ChargeHA

The upstream project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. E.V. Solar remains subject to that licence. See [`LICENSE`](LICENSE).

Changes specific to E.V. Solar are identified through this repository's Git history.

E.V. Solar is not affiliated with or endorsed by Tesla, Fronius, Open-Meteo, Météo-France or ChargeHQ.

---

**E.V. Solar** — intelligent solar EV charging that connects your car, solar production and home battery into one energy strategy.