# E.V Solar

**E.V Solar** is a self-hosted, solar-aware EV charging controller focused on Tesla vehicles and Fronius home-energy installations.

It is based on [ChargeHA](https://github.com/startswithaj/ChargeHA) and extends it with solar self-consumption control, home-battery protection, tariff schedules, battery-to-car attribution, historical statistics and same-day solar charge forecasting.

> **Deployable branch:** `main`
>
> **Status:** personal/home deployment, actively developed and validated with Docker on ARM64 and AMD64.

## Main features

- **Tesla Fleet API integration** — vehicle state, SOC, plug/home detection, charging start/stop and current control.
- **Fronius Local** — direct LAN power-flow data for PV production, grid import/export and home-battery SOC/power.
- **Fronius Solar.web Cloud** — optional remote energy-source connector for installations where local access is unavailable or undesirable.
- **Home-battery aware charging** — avoids treating stationary-battery discharge as usable solar surplus.
- **Battery protection** — configurable minimum home-battery SOC, tolerated discharge power and grace periods.
- **10-minute schedules** — configurable start/end windows and scheduled charging targets.
- **Real-time dashboard** — solar, grid, home battery and EV charging flows.
- **Battery-to-car attribution** — charging statistics distinguish solar, home-battery and grid energy.
- **Historical statistics** — charging and energy attribution over time.
- **Solar charge forecast** — informational same-day EV SOC/energy prediction.
- **Telegram notifications** — charging events, errors and battery target notifications.
- **Responsive UI** — mobile-friendly interface with automatic light/dark theme.

## Charging modes

### STOP

No automatic charging. Schedules are ignored.

### CHARGE NOW

Starts charging immediately at the configured maximum current. Schedules and solar control are ignored.

### SOLAR ONLY

Charges only from usable solar excess.

E.V Solar subtracts home-battery discharge from the apparent export before deciding how much solar is genuinely available for the vehicle. Grace/cooldown logic avoids unnecessary rapid start/stop cycles during short solar drops.

### SOLAR + 🕒

Combines solar charging with scheduled charging.

- Outside a schedule, it behaves like `SOLAR ONLY`.
- During an active schedule, it charges at the configured scheduled amperage.
- A schedule target SOC can stop charging before the end of the time window.
- Home-battery discharge can be ignored by the EV decision during scheduled off-peak charging.

## Solar forecast

The informational forecast is displayed in the vehicle card when the car is plugged in at home and the active mode supports solar charging.

Example:

```text
☀️ Solar end 19:24 · +3.7 kWh · 67% tonight
🌙 Target 80% estimated around 04:32
```

Forecast logic is deliberately isolated from charge control: **it cannot start, stop or change vehicle charging.**

The model can use:

- site location,
- installation date,
- one or more PV arrays,
- kWp, azimuth and tilt,
- age/degradation assumptions,
- forecast irradiance,
- live Fronius production correction,
- local Tesla charging history,
- current Tesla SOC/state,
- household and home-battery state,
- E.V Solar controller rules for simulation.

Forecast failures are non-critical and never block the charging controller.

## Fronius conventions

E.V Solar normalises energy data internally so that:

- `gridPowerW > 0` = grid import,
- `gridPowerW < 0` = grid export,
- `batteryPowerW > 0` = home-battery discharge,
- `batteryPowerW < 0` = home-battery charging.

For solar allocation, home-battery discharge is excluded from usable PV surplus.

## Security

The deployment is designed for a private home server and supports:

- Argon2id local authentication,
- minimum password length enforcement,
- `HttpOnly` / `SameSite=Lax` session cookies,
- escalating brute-force delay,
- AES-256-GCM encryption for stored secrets,
- encryption key supplied through a read-only Docker secret file,
- non-root container execution,
- read-only root filesystem,
- dropped Linux capabilities,
- `no-new-privileges`,
- PID limits,
- restricted temporary filesystem,
- hardened trusted-proxy handling,
- OIDC HTTPS/SSRF protections,
- Tesla HTTP proxy bound to loopback.

The persistent SQLite database is stored in the Docker volume `chargeha-data`. Back up that volume together with the encryption key.

## Supported integrations

| Category | Integration | Notes |
| --- | --- | --- |
| Vehicle | **Tesla** | Fleet API, virtual key, charge control, SOC/location/home state |
| Energy | **Fronius Local** | PV, grid and home-battery data over LAN |
| Energy | **Fronius Solar.web Cloud** | Optional remote Solar.web source |
| Energy | Sigenergy local | Inherited from ChargeHA |
| Energy | Enphase local | Inherited from ChargeHA |
| Notifications | **Telegram** | Charging, errors and target notifications |
| Authentication | Local / OIDC | Local hardened auth plus OIDC support |

## Docker deployment

For the current ARM64 home deployment, build from the repository root with:

```bash
docker buildx build \
  -f docker/Dockerfile \
  --platform linux/arm64 \
  -t chargeha:arm64 \
  --load \
  .
```

Generate and permanently retain an encryption key:

```bash
mkdir -p ~/.config/evsolar
openssl rand -base64 32 > ~/.config/evsolar/encryption_key
chmod 400 ~/.config/evsolar/encryption_key
```

Example hardened container:

```bash
docker run -d \
  --name chargeha \
  --restart unless-stopped \
  --user 1000:1000 \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges=true \
  --pids-limit 256 \
  --tmpfs /tmp:rw,nosuid,noexec,size=64m,uid=1000,gid=1000,mode=700 \
  -e ENCRYPTION_KEY_FILE=/run/secrets/evsolar_encryption_key \
  -v "$HOME/.config/evsolar/encryption_key:/run/secrets/evsolar_encryption_key:ro" \
  -v chargeha-data:/app/data:rw \
  -p 8000:8000 \
  chargeha:arm64
```

Do not expose E.V Solar directly to the public Internet without an appropriate HTTPS/authentication architecture.

The production host can keep its own deployment helper (for example `update-chargeha.sh`); local deployment scripts are intentionally ignored by Git so machine-specific settings do not leak into the repository.

## Repository workflow

`main` is the deployable branch. Feature and maintenance work should be done on short-lived branches and merged through pull requests after validation.

GitHub Actions now uses one CI workflow. The blocking quality gate performs:

- TypeScript/Deno type-checking,
- repository invariant checks,
- server/plugin tests,
- client tests,
- Docker smoke builds for both `linux/amd64` and `linux/arm64`.

Formatting and custom lint debt are also reported on every CI run, but are temporarily non-blocking while inherited violations are cleaned progressively. Strict local validation of formatting, lint, types and tests remains available through:

```bash
deno task check:all
```

The CI-equivalent blocking quality gate is available through:

```bash
deno task check:ci
```

GitHub Actions dependencies are checked monthly by Dependabot.

## Data and backups

For disaster recovery, retain independent copies of:

1. the Git repository and deployed commit/tag,
2. a known-good Docker image when practical,
3. the `chargeha-data` Docker volume,
4. `~/.config/evsolar/encryption_key`,
5. deployment/restoration instructions.

The source repository alone is **not** a complete backup because the database and encryption key contain installation-specific configuration and secrets.

## Architecture notes

The charging controller remains the single authority for vehicle commands. Forecasting, statistics and external data enrichment must not bypass controller safety rules.

SQLite is configured for reliable long-running operation with WAL/busy-timeout handling, and runtime energy recording remains independent from forecast calculations.

## Planned work

- Continue improving Fronius Solar.web integration and remote-installation support.
- Continue forecast calibration using real production and charging history.
- Improve Tesla API efficiency and state-race handling.
- Automated survival backup / disaster-recovery packaging.
- Progressive cleanup of inherited formatting, lint and legacy ChargeHA code.

## Project origin and licence

E.V Solar is a modified fork of **ChargeHA** by `startswithaj`.

Original project: <https://github.com/startswithaj/ChargeHA>

The upstream project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. E.V Solar remains subject to that licence. See [`LICENSE`](LICENSE).

Changes specific to E.V Solar are recorded in this repository's Git history.

E.V Solar is not affiliated with or endorsed by Tesla, Fronius, Open-Meteo, Météo-France or ChargeHQ.
