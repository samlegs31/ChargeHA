# syntax=docker/dockerfile:1

# ============================================================
# E.V Solar — Optimized multi-stage Dockerfile
# ============================================================

# ------------------------------------------------------------
# Stage 1 — Tesla HTTP proxy
# ------------------------------------------------------------
FROM --platform=$BUILDPLATFORM golang:1.23-bookworm AS proxy-builder

RUN for i in 1 2 3 4 5; do \
      git clone --depth 1 https://github.com/teslamotors/vehicle-command.git /src && break; \
      echo "Clone failed, retry $i/5..."; \
      rm -rf /src; \
      sleep 5; \
    done && test -d /src/.git

WORKDIR /src

ARG TARGETOS
ARG TARGETARCH

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -o /tesla-http-proxy ./cmd/tesla-http-proxy


# ------------------------------------------------------------
# Stage 2 — Client build
# ------------------------------------------------------------
FROM denoland/deno:2.9.4 AS client-builder

ARG GIT_SHA
ENV VITE_GIT_SHA=$GIT_SHA
ENV DENO_DIR=/deno-dir

WORKDIR /app

COPY deno.json deno.lock* ./
COPY packages/shared/ packages/shared/
COPY packages/server/deno.json packages/server/deno.json
COPY packages/plugins/ packages/plugins/
COPY packages/client/ packages/client/

RUN --mount=type=cache,target=/deno-dir \
    deno install

RUN --mount=type=cache,target=/deno-dir \
    deno task build


# ------------------------------------------------------------
# Stage 3 — Production runtime
# ------------------------------------------------------------
FROM denoland/deno:2.9.4

ENV DENO_DIR=/deno-dir

RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      openssl \
      ca-certificates \
      openssh-client

WORKDIR /app

# Tesla proxy
COPY --from=proxy-builder \
  /tesla-http-proxy \
  /usr/local/bin/tesla-http-proxy

# Application
COPY deno.json deno.lock* ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/plugins/ packages/plugins/
COPY packages/client/deno.json packages/client/deno.json
COPY drizzle/ drizzle/

# Built UI
COPY --from=client-builder \
  /app/packages/server/dist \
  packages/server/dist/

# Runtime dependencies
RUN --mount=type=cache,target=/deno-dir \
    deno install

RUN --mount=type=cache,target=/deno-dir \
    deno cache packages/server/src/main.ts

RUN mkdir -p /app/data

COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD ["deno", "run", "--allow-net", "packages/server/src/healthcheck.ts"]

ENTRYPOINT ["/app/entrypoint.sh"]
