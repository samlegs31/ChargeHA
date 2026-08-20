#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker/compose.evsolar.yml"
CONTAINER="${EVSOLAR_CONTAINER:-chargeha}"
IMAGE="${EVSOLAR_IMAGE:-ghcr.io/samlegs31/chargeha:latest}"
WAIT_SECONDS="${EVSOLAR_WAIT_SECONDS:-300}"

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
ROLLBACK_TAG="evsolar:rollback-$STAMP"

[[ -r "$KEY_FILE" ]] || {
  echo "Encryption key is missing or unreadable: $KEY_FILE" >&2
  exit 1
}

docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1 || {
  echo "Docker volume not found: $DATA_VOLUME" >&2
  exit 1
}

# Fetch main first, then wait until :latest was actually built from that commit.
git -C "$REPO_ROOT" fetch --quiet origin main
EXPECTED_SHA="$(git -C "$REPO_ROOT" rev-parse origin/main)"

echo "E.V. Solar update"
echo "  target:    $EXPECTED_SHA"
echo "  image:     $IMAGE"
echo "  volume:    $DATA_VOLUME"
echo "  bind:      $BIND"
echo "  key:       $KEY_FILE"

image_ready=false
deadline=$((SECONDS + WAIT_SECONDS))
while (( SECONDS < deadline )); do
  if docker pull "$IMAGE" >/dev/null; then
    IMAGE_SHA="$(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
    if [[ -z "$IMAGE_SHA" || "$IMAGE_SHA" == "$EXPECTED_SHA" ]]; then
      image_ready=true
      [[ -z "$IMAGE_SHA" ]] && echo "Warning: image has no revision label; continuing after successful pull."
      break
    fi
    echo "latest is still $IMAGE_SHA; waiting for GitHub image $EXPECTED_SHA..."
  fi
  sleep 10
done

$image_ready || {
  echo "Timed out waiting for the Docker image built from main ($EXPECTED_SHA)." >&2
  exit 1
}

mkdir -p "$BACKUP_DIR"
old_image_id=""
was_running=false

if $container_exists; then
  docker inspect "$CONTAINER" > "$BACKUP_DIR/container-inspect.json"
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

export EVSOLAR_IMAGE="$IMAGE"
export EVSOLAR_DATA_VOLUME="$DATA_VOLUME"
export EVSOLAR_KEY_FILE="$KEY_FILE"
export EVSOLAR_BIND="$BIND"

start_new() {
  docker compose -p evsolar -f "$COMPOSE_FILE" up -d --remove-orphans
}

wait_healthy() {
  local timeout=180
  local end=$((SECONDS + timeout))
  while (( SECONDS < end )); do
    local running health
    running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"
    if [[ "$running" == "true" && ( "$health" == "healthy" || "$health" == "none" ) ]]; then
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
      docker compose -p evsolar -f "$COMPOSE_FILE" up -d --pull never --remove-orphans
    echo "Previous image restored as $ROLLBACK_TAG." >&2
  fi
  echo "Backup kept at: $BACKUP_DIR" >&2
}

trap 'rollback' ERR

start_new
wait_healthy
trap - ERR

# Keep the source checkout aligned when it is safely possible. Never destroy local edits.
if [[ "$(git -C "$REPO_ROOT" branch --show-current)" == "main" ]] && \
   [[ -z "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  git -C "$REPO_ROOT" merge --ff-only origin/main >/dev/null
else
  echo "Source checkout not fast-forwarded (not on clean main); container update is unaffected."
fi

RUNNING_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")"
HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER")"

echo
echo "E.V. Solar updated successfully."
echo "  container: $CONTAINER"
echo "  image:     $RUNNING_IMAGE"
echo "  health:    $HEALTH"
echo "  backup:    $BACKUP_DIR"
if [[ -n "$old_image_id" ]]; then
  echo "  rollback:  $ROLLBACK_TAG"
fi
