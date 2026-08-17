<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/client/public/ev-solar-logo-dark-exact.webp">
    <img src="packages/client/public/ev-solar-logo-exact.webp" alt="E.V. Solar" width="520">
  </picture>
</p>

# E.V. Solar

**E.V. Solar** is a self-hosted solar-aware EV charging controller focused on Tesla + Fronius home installations.

It is based on [ChargeHA](https://github.com/startswithaj/ChargeHA) and extends it with a charging model designed around solar self-consumption, home-battery protection, tariff schedules, battery-to-car attribution, and same-day solar charge forecasting.

> **Current branch:** `main`
>
> **Status:** personal/home deployment, actively developed and validated on Raspberry Pi + Docker.

## Main features

- **Tesla Fleet API integration** — vehicle state, SOC, plug/home detection, charging start/stop and current control.
- **Fronius local integration** — direct LAN power-flow data for PV production, grid import/export and home-battery SOC/power.
- **Home-battery aware charging** — EV charging avoids consuming energy discharged from the home battery when operating from solar.
- **Battery protection** — configurable minimum home-battery SOC, tolerated discharge power and grace period before stopping EV charging.
- **10-minute schedules** — schedule start/end times can be configured in 10-minute increments.
- **Real-time dashboard** — solar, grid, home battery and EV charging flows.
- **Battery-to-car attribution** — charging statistics distinguish energy coming from solar, the home battery and the grid.
- **Historical statistics** — charging and energy attribution over time.
- **Telegram notifications** — charging events, errors and battery target notifications.
- **Responsive interface** — mobile-friendly UI with automatic light/dark theme.
- **Local-first design** — Fronius communication stays on the LAN; the application is self-hosted.

## Charging modes

E.V. Solar exposes four simple operating modes:

### STOP

No automatic charging. Schedules are ignored.

### CHARGE NOW

Starts charging immediately at the configured maximum current. Schedules and solar control are ignored.

### SOLAR ONLY

Charges only from usable solar excess.

E.V. Solar subtracts home-battery discharge from the apparent export before deciding how much solar is actually available for the car. This prevents a Tesla from being charged by draining the stationary battery while the UI still appears to show solar charging.

If solar briefly drops because of clouds, configurable grace/cooldown logic avoids unnecessary rapid start/stop cycles.

### SOLAR + 🕒

Combines solar charging with scheduled charging.

- **Outside a schedule:** behaves like `SOLAR ONLY`.
- **During an active schedule:** charges at the configured scheduled amperage.
- Home-battery discharge is intentionally ignored for the EV charging decision during the schedule, allowing cheap/off-peak grid charging when desired.
- A schedule target SOC can stop charging before the end of the time window.

This is useful for installations where daytime charging should follow PV production while a night/off-peak window guarantees a minimum morning SOC.

## Solar forecast

E.V. Solar v2 includes an **informational charge forecast** displayed directly in the vehicle card when the car is plugged in at home and the active mode is `SOLAR ONLY` or `SOLAR + 🕒`.

Example:

```text
☀️ Solar end 19:24 · +3.7 kWh · 67% tonight
🌙 Target 80% estimated around 04:32
```

The forecast is intentionally isolated from charge control: **it cannot start, stop or change vehicle charging.**

It uses:

- site location,
- installation date,
- one or more PV arrays,
- kWp per array,
- azimuth and tilt,
- automatic average PV degradation of **0.5%/year**,
- 15-minute tilted irradiance forecast data,
- live Fronius production for correction,
- local Tesla charging history,
- current Tesla SOC/state,
- current household and battery state,
- the real E.V. Solar controller rules for simulation.

The weather/irradiance provider used by the current implementation is Open-Meteo with Météo-France forecast data where available.

Forecast failures are non-critical and never affect the charging controller.

## Fronius battery conventions

E.V. Solar normalises Fronius data internally so that:

- `gridPowerW > 0` = grid import,
- `gridPowerW < 0` = grid export,
- `batteryPowerW > 0` = home-battery discharge,
- `batteryPowerW < 0` = home-battery charging.

For solar allocation, home-battery discharge is excluded from usable PV surplus.

## Security

The E.V. Solar deployment has been hardened for a private home server:

- Argon2id local authentication,
- minimum password length enforcement,
- session cookies with `HttpOnly` and `SameSite=Lax`,
- escalating brute-force delay,
- AES-256-GCM encryption for stored secrets,
- encryption key provided as a read-only Docker secret file,
- non-root container (`1000:1000`),
- read-only root filesystem,
- all Linux capabilities dropped,
- `no-new-privileges`,
- PID limit,
- restricted temporary filesystem,
- loopback + LAN-only application exposure in the recommended Raspberry Pi deployment,
- hardened trusted-proxy handling,
- OIDC HTTPS/SSRF protections,
- Tesla HTTP proxy bound to loopback.

The persistent SQLite database is stored in the Docker volume `chargeha-data` and must be backed up together with the encryption key.

## Supported integrations

| Category | Integration | Notes |
| --- | --- | --- |
| Vehicle | **Tesla** | Fleet API, virtual key, charge control, SOC/location/home state |
| Energy | **Fronius local** | PV, grid and home-battery data directly over LAN |
| Energy | Fronius cloud | Inherited from ChargeHA |
| Energy | Sigenergy local | Inherited from ChargeHA |
| Energy | Enphase local | Inherited from ChargeHA |
| Notifications | **Telegram** | Charging, errors and target notifications |
| Authentication | Local / OIDC | Local hardened auth plus OIDC support |

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

For disaster recovery, keep independent copies of all of the following:

1. the Git repository and E.V. Solar version/tag,
2. a known-good exported Docker image,
3. the `chargeha-data` Docker volume,
4. `~/.config/evsolar/encryption_key`,
5. deployment/restoration instructions.

The source repository alone is **not** a complete backup because the database and encryption key contain installation-specific configuration and secrets.

## Architecture notes

E.V. Solar deliberately keeps forecast logic separate from charge-control decisions. The forecast may simulate ControllerEngine behaviour but cannot send vehicle commands.

The controller remains the single authority for charging decisions.

SQLite is configured for reliable long-running operation with WAL/busy-timeout handling, and runtime energy recording is kept independent from forecast calculations.

## Planned work

- ChargeHQ historical CSV import into a dedicated forecast-training/calibration history.
- Continued forecast calibration using local production and charging history.
- Automated survival backup / disaster-recovery package.
- Additional documentation for clean installation and migration.

## Project origin and licence

E.V. Solar is a modified fork of **ChargeHA** by `startswithaj`.

Original project:

- https://github.com/startswithaj/ChargeHA

The upstream project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. E.V. Solar remains subject to that licence. See [`LICENSE`](LICENSE).

Changes specific to E.V. Solar are identified through this repository's Git history.

E.V. Solar is not affiliated with or endorsed by Tesla, Fronius, Open-Meteo, Météo-France or ChargeHQ.

---

**E.V. Solar** — self-hosted Tesla charging that prioritises your solar production without sacrificing control of your home battery.