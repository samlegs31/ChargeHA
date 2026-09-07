<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/client/public/ev-solar-logo-dark-exact.webp">
    <img src="packages/client/public/ev-solar-logo-exact.webp" alt="E.V. Solar" width="520">
  </picture>
</p>

# E.V. Solar

**Solar-first Tesla charging for your home.** E.V. Solar runs on a Raspberry Pi,
uses live Fronius energy data and adjusts charging to the solar power available
while protecting your BYD home battery.

See your cars, charging power and home energy flows in one dashboard. Choose
solar charging, combine it with weekly off-peak schedules, or take manual
control.

> [!IMPORTANT]
> **Active development.** The reference installation is a 64-bit Raspberry Pi
> running Docker, a **Fronius Primo GEN24 6.0 Plus**, a **BYD HVS 7.7** and
> **Tesla vehicles**. This is the currently validated setup; other integrations
> in the codebase do not imply equivalent hardware validation.

## How solar charging works

With home-battery priority enabled, the configured reserve determines when solar
can be shared with the car.

1. **Fill the home battery to its reserve.** Below the configured level, solar
   charging of the car waits.
2. **Start the car automatically once the reserve is reached**, provided the car
   is plugged in at home and enough solar is available under the configured
   charging rules. Solar still flowing into the home battery can now be used by
   the car; the controller no longer needs to wait for grid export.
3. **Start gently, then regulate.** Tesla solar charging starts at minimum
   current (5 A), then adjusts to available surplus. Margins and delays limit
   reactions to passing clouds and small power changes.
4. **Protect the reserve.** Solar charging pauses if the home battery drops
   below the threshold. Separate discharge-tolerance and grace settings protect
   against excessive battery drain.

**Example:** with an 80% reserve, the car waits while the BYD is below 80%. Once
80% is reached, sufficient solar can start the car automatically, even if the
BYD is still absorbing the production.

Home-battery discharge is excluded from usable solar surplus. Charging away from
home is kept separate from home automation and energy accounting. Missing, stale
or invalid energy readings trigger protective controller behaviour.

See the [charging-controller documentation](docs/charge-controller.md) for rule
precedence and technical details.

## Charging modes

| Mode      | What it does                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| **Smart** | Uses solar outside scheduled periods and allows configured scheduled charging, including off-peak periods. |
| **Solar** | Uses available solar while respecting home-battery protection and charging rules.                          |
| **Now**   | Requests immediate charging with manual current control.                                                   |
| **Stop**  | Requests a stop and prevents automatic charging until another mode is selected.                            |

Weekly schedules support selected days, overnight periods, charging current,
vehicle charge limits and do-not-charge windows. Tesla charge limits can also be
adjusted from the vehicle controls.

## A clear view of the home and every car

- **Visible vehicle cards:** charging state and power are shown together, for
  example **“Charging · 4.8 kW”**. Actual charging remains visible while a stop
  command is awaiting confirmation.
- **Consistent states:** green for charging, blue for connected, amber for
  waiting, grey for disconnected and red for errors.
- **Accessible mobile navigation:** Home, Stats, Schedules and Settings remain
  within reach. Location setup stays in Settings and onboarding, without a map
  taking space on Home.
- **Live energy flows:** solar production, household consumption, grid
  import/export, home-battery power and EV charging in one view.
- **Multiple Teslas:** view the vehicles together and allocate solar through
  equal sharing or vehicle priority.

## History, costs and forecasts

**Stats** separates charging energy from direct solar, the home battery and the
grid, with home/away totals, grid costs and solar savings. Day, month, year and
all-time views help compare usage. **Self-powered charging** includes both
direct solar and home-battery energy as a share of charging at home; it is
distinct from the direct-solar share.

**Historical imports** support ChargeHQ data and Solar.web/Wattpilot archives.
Imported daily totals are not detailed charging sessions. Solar.web requests are
paced, short rate-limit responses are retried, and long `Retry-After` delays
stop the import with a retry-later message. Historical imports remain separate
from live charging control.

**Solar forecasts** estimate useful energy for the car and its achievable charge
level using weather, installation characteristics, recent production, household
load, battery behaviour and schedules. Dedicated Solar Prediction settings
include a GEN24 6.0 / BYD HVS 7.7 reference profile.

Forecasts are informational: a forecast failure cannot directly start, stop or
change charging. Telegram notifications can report charging events and errors.

## Latest changes — September 2026

- **Automatic solar handoff at the battery reserve:** solar flowing into the
  home battery becomes available to the EV once the configured reserve is met.
  Regression tests cover the threshold, gradual startup, away vehicles and
  failed energy readings.
- **Clearer charging status and mobile controls:** actual charging takes
  priority in the status display; power, state colours and navigation are more
  consistent.
- **Correct self-powered statistics:** the displayed percentage now includes
  home-battery energy as well as direct solar.
- **More considerate Solar.web imports:** long server-requested retry delays are
  no longer shortened to five minutes.
- **Lighter dashboard and restored app icons:** deferred page loading, indexed
  history queries and installation icons based on the existing E.V. Solar
  artwork.
- **Stricter validation:** CI checks formatting without rewriting files and uses
  the same pinned Deno version as local validation.

The [reliability review](docs/audit-2026-09-05.md) and
[functional audit](docs/chargehq-parity-audit.md) document the changes and
remaining gaps.

## Integrations and scope

| Integration                        | Current role                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Tesla Fleet API**                | Vehicle state, home detection, start/stop, current and charge-limit control.                     |
| **Fronius GEN24 local**            | Validated live home-energy source.                                                               |
| **BYD HVS through Fronius**        | Home-battery state, power and reserve protection.                                                |
| **Solar.web / Wattpilot archives** | Historical home and EV energy imports; direct Wattpilot charger control is not implemented.      |
| **ChargeHQ**                       | Historical charging import tools.                                                                |
| **Telegram**                       | Charging notifications.                                                                          |
| **Local authentication / OIDC**    | Application access.                                                                              |
| **Other energy adapters**          | Fronius Cloud, Enphase and Sigenergy code exists; outside the current validated reference setup. |

The application controls the Tesla directly. It does not currently provide OCPP
charger control or production control for other vehicle brands. Raspberry Pi is
the supported development deployment; hosted server/VPS operation is not yet
supported.

Next priorities include a user-defined maximum-current cap, a real-time
subscribed-power limiter, clearer charging-decision explanations, one-off
schedules and CSV export. Subscribed power is currently modelled in forecasts;
it is not a hard real-time controller limit. See the functional audit for the
full roadmap.

## Self-hosted by design

The application stores its database locally and encrypts stored secrets with
AES-256-GCM. It supports local Argon2id authentication and OIDC. The Docker
setup below uses a non-root application, a read-only root filesystem, dropped
capabilities and an encryption key mounted separately from the data volume.

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

For a **new installation only**, generate and permanently keep an encryption
key. When updating or restoring an existing installation, reuse its original
key:

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
