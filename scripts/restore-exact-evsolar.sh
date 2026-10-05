#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker/compose.evsolar.yml"
CONTAINER="${EVSOLAR_CONTAINER:-chargeha}"
BASE_IMAGE="evsolar:rollback-20261005-204734"
BASE_IMAGE_ID="sha256:54862f48b17099a0cb8ebd33118ccfcb0d47ac3e28b94f079853260f12840c36"

if [[ -n "${SUDO_USER:-}" ]] && command -v getent >/dev/null 2>&1; then
  USER_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
else
  USER_HOME="$HOME"
fi

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need docker
need git
need python3

docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose plugin is required (docker compose)." >&2
  exit 1
}

[[ -f "$COMPOSE_FILE" ]] || {
  echo "Missing $COMPOSE_FILE" >&2
  exit 1
}

container_exists=false
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  container_exists=true
fi

# Preserve the current installation details when possible.
current_volume=""
current_key=""
current_bind=""
if $container_exists; then
  current_volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' "$CONTAINER")"
  current_key="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/run/secrets/evsolar_encryption_key"}}{{.Source}}{{end}}{{end}}' "$CONTAINER")"
  current_bind="$(docker inspect -f '{{with (index .HostConfig.PortBindings "8000/tcp")}}{{with index . 0}}{{.HostIp}}:{{.HostPort}}{{end}}{{end}}' "$CONTAINER")"
  [[ "$current_bind" == :* ]] && current_bind="0.0.0.0$current_bind"
fi

DATA_VOLUME="${EVSOLAR_DATA_VOLUME:-${current_volume:-chargeha-data}}"
KEY_FILE="${EVSOLAR_KEY_FILE:-${current_key:-$USER_HOME/.config/evsolar/encryption_key}}"
BIND="${EVSOLAR_BIND:-${current_bind:-0.0.0.0:8000}}"
BACKUP_ROOT="${EVSOLAR_BACKUP_DIR:-$USER_HOME/evsolar-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
ROLLBACK_TAG="evsolar:before-exact-recovery-$STAMP"

[[ -r "$KEY_FILE" ]] || {
  echo "Encryption key is missing or unreadable: $KEY_FILE" >&2
  exit 1
}

docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1 || {
  echo "Docker volume not found: $DATA_VOLUME" >&2
  exit 1
}

# Verify and build the exact saved image while the current service stays up.
[[ "$(docker image inspect "$BASE_IMAGE" --format '{{.Id}}')" == "$BASE_IMAGE_ID" ]] || {
  echo "The saved image does not match the reviewed Raspberry version." >&2
  exit 1
}
EXPECTED_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
IMAGE="evsolar:restored-20261005-${EXPECTED_SHA:0:12}"
BUILD_DIR="$(mktemp -d)"
SOURCE_CONTAINER=""
cleanup_build() {
  if [[ -n "$SOURCE_CONTAINER" ]]; then
    docker rm "$SOURCE_CONTAINER" >/dev/null 2>&1 || true
  fi
  rm -rf "$BUILD_DIR"
}
trap cleanup_build EXIT

echo "E.V. Solar exact-version restoration"
echo "  base:      $BASE_IMAGE_ID"
echo "  correction: $EXPECTED_SHA"
echo "  volume:    $DATA_VOLUME"
echo "  bind:      $BIND"
echo "Preparing the corrected image before stopping the current service..."

# A created, never-started container exposes only the saved application files.
SOURCE_CONTAINER="$(docker create --network none --entrypoint /bin/true "$BASE_IMAGE_ID")"
mkdir -p "$BUILD_DIR/app/packages/server" "$BUILD_DIR/app/packages/shared"
# Copying the complete server/shared source also allows Docker's offline type
# check to validate this patch against the actual saved runtime, not main.
docker cp "$SOURCE_CONTAINER:/app/packages/server/." "$BUILD_DIR/app/packages/server/"
docker cp "$SOURCE_CONTAINER:/app/packages/shared/." "$BUILD_DIR/app/packages/shared/"
docker rm "$SOURCE_CONTAINER" >/dev/null
SOURCE_CONTAINER=""
python3 "$REPO_ROOT/scripts/recovery/prepare.py" "$BUILD_DIR/app"

cat > "$BUILD_DIR/Dockerfile" <<'DOCKERFILE'
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG CORRECTION_SHA
USER 0:0
COPY app/packages/server/ /app/packages/server/
COPY app/packages/shared/ /app/packages/shared/
COPY app/recovery-verification.json /app/recovery-verification.json
RUN chmod -R a+rX /app/packages/server /app/packages/shared && \
    deno check --cached-only --frozen packages/server/src/main.ts && \
    deno cache --cached-only --frozen packages/server/src/main.ts packages/server/src/healthcheck.ts && \
    chmod -R a+rX /deno-dir
LABEL org.opencontainers.image.revision="${CORRECTION_SHA}"
LABEL evsolar.recovery.base="sha256:54862f48b17099a0cb8ebd33118ccfcb0d47ac3e28b94f079853260f12840c36"
USER 1000:1000
DOCKERFILE

docker build --pull=false --network none \
  --build-arg BASE_IMAGE="$BASE_IMAGE" \
  --build-arg CORRECTION_SHA="$EXPECTED_SHA" \
  -t "$IMAGE" "$BUILD_DIR"
PINNED_IMAGE_ID="$(docker image inspect "$IMAGE" --format '{{.Id}}')"
[[ -n "$PINNED_IMAGE_ID" ]] || { echo "Missing corrected image ID" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
old_image_id=""
was_running=false
COMPOSE_ARGS=(-p evsolar -f "$COMPOSE_FILE")

# Install recovery before stopping the service or copying the database.
recover_preparation() {
  local failure=$?
  trap - ERR
  if $was_running && docker inspect "$CONTAINER" >/dev/null 2>&1; then
    docker start "$CONTAINER" >/dev/null || echo "Could not restart the previous container" >&2
  fi
  echo "Preparation failed; no new image was started. Backup directory: $BACKUP_DIR" >&2
  exit "$failure"
}
trap recover_preparation ERR

if $container_exists; then
  docker inspect "$CONTAINER" > "$BACKUP_DIR/container-inspect.json"
  # Compose preserves all existing host bindings, including loopback + LAN.
  if [[ -z "${EVSOLAR_BIND:-}" ]]; then
    python3 - "$BACKUP_DIR/container-inspect.json" "$BACKUP_DIR/ports.compose.json" <<'PYPORTS'
import json, sys
with open(sys.argv[1]) as source:
    config = json.load(source)[0]
bindings = config.get("HostConfig", {}).get("PortBindings", {}).get("8000/tcp") or []
ports = []
for binding in bindings:
    ip = binding.get("HostIp") or "0.0.0.0"
    host = f"[{ip}]" if ":" in ip else ip
    ports.append(f"{host}:{binding['HostPort']}:8000")
with open(sys.argv[2], "w") as target:
    json.dump({"services": {"evsolar": {"ports": ports}}}, target)
PYPORTS
    COMPOSE_ARGS+=(-f "$BACKUP_DIR/ports.compose.json")
  fi
  old_image_id="$(docker inspect -f '{{.Image}}' "$CONTAINER")"
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" == "true" ]] && was_running=true

  echo "Stopping $CONTAINER for a consistent data backup..."
  docker stop "$CONTAINER" >/dev/null
  mkdir -p "$BACKUP_DIR/data"
  docker cp "$CONTAINER:/app/data/." "$BACKUP_DIR/data/"
  docker image tag "$old_image_id" "$ROLLBACK_TAG"
  docker rm "$CONTAINER" >/dev/null
else
  echo "No existing $CONTAINER container found; creating it from the existing data volume."
fi

export EVSOLAR_IMAGE="$PINNED_IMAGE_ID"
export EVSOLAR_DATA_VOLUME="$DATA_VOLUME"
export EVSOLAR_KEY_FILE="$KEY_FILE"
export EVSOLAR_BIND="$BIND"

start_new() {
  docker compose "${COMPOSE_ARGS[@]}" up -d --pull never --remove-orphans
}

wait_healthy() {
  local timeout=180
  local end=$((SECONDS + timeout))
  while (( SECONDS < end )); do
    local running health
    running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"
    if [[ "$running" == "true" && "$health" == "healthy" ]]; then
      return 0
    fi
    if [[ "$health" == "unhealthy" ]]; then
      return 1
    fi
    sleep 5
  done
  return 1
}

rollback() {
  echo "Update failed. Starting rollback..." >&2
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

  if [[ -n "$old_image_id" && -d "$BACKUP_DIR/data" ]]; then
    # Restore the stopped-container backup before starting the previous image.
    docker run --rm --user 0:0 --entrypoint /bin/sh \
      -v "$DATA_VOLUME:/app/data" \
      -v "$BACKUP_DIR/data:/backup:ro" \
      "$ROLLBACK_TAG" \
      -c 'find /app/data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; cp -a /backup/. /app/data/; chown -R 1000:1000 /app/data'

    EVSOLAR_IMAGE="$ROLLBACK_TAG" \
      docker compose "${COMPOSE_ARGS[@]}" up -d --pull never --remove-orphans
    echo "Previous image restored as $ROLLBACK_TAG." >&2
  fi
  echo "Backup kept at: $BACKUP_DIR" >&2
}

trap 'rollback' ERR

start_new
wait_healthy
trap - ERR

RUNNING_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")"
HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER")"

echo
echo "E.V. Solar restored successfully with Automatic charging + Reset correction."
echo "  container: $CONTAINER"
echo "  image:     $RUNNING_IMAGE"
echo "  health:    $HEALTH"
echo "  backup:    $BACKUP_DIR"
if [[ -n "$old_image_id" ]]; then
  echo "  rollback:  $ROLLBACK_TAG"
fi
