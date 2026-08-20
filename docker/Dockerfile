# syntax=docker/dockerfile:1

# ============================================================
# E.V Solar — Optimized multi-stage Dockerfile
# ============================================================

# ------------------------------------------------------------
# Stage 1 — Tesla HTTP proxy
# ------------------------------------------------------------
FROM --platform=$BUILDPLATFORM golang:1.26.6-bookworm AS proxy-builder

ARG TESLA_VEHICLE_COMMAND_REF=f97fa1e4bf617a364c72b85cb5d859528abeda67

# Pin Tesla's source to the exact revision audited with this image. Building
# directly from a moving branch would make identical source trees produce
# different binaries over time.
RUN git init /src && \
    git -C /src remote add origin https://github.com/teslamotors/vehicle-command.git && \
    for i in 1 2 3 4 5; do \
      git -C /src fetch --depth 1 origin "$TESLA_VEHICLE_COMMAND_REF" && break; \
      echo "Clone failed, retry $i/5..."; \
      sleep 5; \
    done && \
    git -C /src checkout --detach FETCH_HEAD && \
    test "$(git -C /src rev-parse HEAD)" = "$TESLA_VEHICLE_COMMAND_REF"

WORKDIR /src

ARG TARGETOS
ARG TARGETARCH

# The audited Tesla revision still declares an old x/sys version. Its known
# issue is Windows-only, but updating it removes the vulnerable component from
# the Linux binary metadata as well.
RUN go get golang.org/x/sys@v0.44.0

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -o /tesla-http-proxy ./cmd/tesla-http-proxy


# ------------------------------------------------------------
# Stage 2 — Client build
# ------------------------------------------------------------
FROM --platform=$BUILDPLATFORM denoland/deno:2.9.4 AS client-builder

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

ARG TARGETARCH
ARG BUILDARCH

ENV DENO_DIR=/deno-dir

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      openssl \
      ca-certificates \
      openssh-client \
      libsqlite3-0 && \
    SQLITE_LIB="$(ldconfig -p | awk '/libsqlite3\.so\.0/{print $NF; exit}')" && \
    test -n "$SQLITE_LIB" && \
    ln -sf "$SQLITE_LIB" /usr/local/lib/libsqlite3.so.0

# @db/sqlite supports a custom native SQLite path. Using Debian's architecture-
# appropriate library avoids downloading and executing Plug's prebuilt library
# during cross-platform builds and keeps production fully offline.
ENV DENO_SQLITE_PATH=/usr/local/lib/libsqlite3.so.0

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

# Replace the development workspace manifests and lock inside the runtime image
# with a server-only dependency graph. This excludes client, test, lint and
# build packages (including their native helper binaries).
COPY docker/deno.runtime.json deno.json
COPY docker/deno.runtime.lock deno.lock
COPY docker/plugins.runtime.deno.json packages/plugins/deno.json

# Built UI
COPY --from=client-builder \
  /app/packages/server/dist \
  packages/server/dist/

# Runtime dependencies are deliberately committed to the image. Keeping this
# command behind a BuildKit cache mount would leave /deno-dir empty at runtime
# and cause every container restart to download executable code from the network.
# Cache only the two production entry points, not workspace development tools.
RUN deno cache --frozen \
    packages/server/src/main.ts \
    packages/server/src/healthcheck.ts
RUN deno cache --frozen "npm:better-sqlite3@11.10.0"

# Opening SQLite through FFI is useful as a native-build smoke test, but doing
# that inside an emulated arm64 stage can SIGILL under Buildx/QEMU even though
# the same library works on real arm64 hardware. Validate it only when the target
# architecture matches the builder; cross-built images use the system library
# above and will be validated by the normal container healthcheck on deployment.
RUN if [ "$TARGETARCH" = "$BUILDARCH" ]; then \
      deno eval \
        --unstable-ffi \
        'import { Database } from "@db/sqlite"; const db = new Database(":memory:"); db.close();'; \
    else \
      echo "Skipping SQLite FFI smoke test for emulated ${TARGETARCH} build"; \
    fi

RUN mkdir -p /app/data && chown 1000:1000 /app/data

COPY docker/entrypoint.sh /app/entrypoint.sh

# Docker COPY preserves the source permission bits from the build context. A
# restrictive host umask can therefore produce root-owned 0600 source files in
# the image even though Git records them as regular 100644 files. The runtime
# intentionally runs as uid 1000, so normalize all application files and
# directory traversal permissions before switching user.
RUN chmod 755 /app/entrypoint.sh && \
    chmod -R a+rX /app/packages /app/drizzle && \
    chmod a+r /app/deno.json /app/deno.lock

# The service does not need root. Numeric IDs also work with bind-mounted
# secrets and keep the image independent from host user names.
USER 1000:1000

# Fail the image build if the non-root runtime user cannot traverse and read
# dynamically imported server modules. This catches host-permission regressions
# before an update can replace the healthy container.
RUN test -x /app/packages/server/src/trpc && \
    test -r /app/packages/server/src/trpc/root.ts && \
    test -r /app/packages/server/src/main.ts && \
    test -r /app/packages/server/src/healthcheck.ts

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD ["deno", "run", "--cached-only", "--allow-net", "packages/server/src/healthcheck.ts"]

ENTRYPOINT ["/app/entrypoint.sh"]
