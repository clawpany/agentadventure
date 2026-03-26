###############################################################################
# WorkAdventure All-in-One (AIO) Image
#
# Runs play, back, map-storage, and uploader in a single container using
# supervisord. Designed for easy extension — add new services by dropping a
# .conf snippet into /etc/supervisor/conf.d/.
#
# Internal port map (avoid conflicts between hardcoded services):
#   play HTTP       → 3200  (PUSHER_HTTP_PORT)
#   play WS         → 3201  (PUSHER_WS_PORT)
#   play Room API   → 50052 (ROOM_API_PORT)
#   back HTTP       → 8180  (HTTP_PORT)
#   back gRPC       → 50051 (GRPC_PORT)
#   map-storage HTTP→ 3000  (hardcoded)
#   map-storage gRPC→ 50053 (hardcoded)
#   uploader HTTP   → 8080  (hardcoded)
#   nginx           → 80    (external entry point)
###############################################################################

# ── Stage 1: Generate protobuf TypeScript ────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:22-bullseye-slim AS proto-builder
WORKDIR /usr/src
COPY messages/package-lock.json messages/package.json messages/
RUN cd messages && npm ci
COPY messages messages
COPY libs ./libs
RUN cd messages && npm run tag-version && npm run ts-proto

# ── Stage 2: Build play frontend (Vite) ─────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:20.18-bullseye-slim AS play-builder
ARG NODE_OPTIONS="--max-old-space-size=16384"
ARG FAST_BUILD=true
ARG ENABLE_BACKGROUND_BLUR=false
ARG ENABLE_SENTRY=false
ARG ENABLE_POSTHOG=false
WORKDIR /usr/src

RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

COPY --from=proto-builder /usr/src/messages messages
COPY --from=proto-builder /usr/src/libs libs

COPY package.json package-lock.json ./
COPY play/package.json play/package.json
COPY play/packages/iframe-api-typings/package.json play/packages/iframe-api-typings/package.json
COPY libs/messages/package.json libs/messages/package.json
COPY libs/map-editor/package.json libs/map-editor/package.json
COPY libs/math-utils/package.json libs/math-utils/package.json
COPY libs/tailwind/package.json libs/tailwind/package.json
COPY libs/store-utils/package.json libs/store-utils/package.json
COPY libs/shared-utils/package.json libs/shared-utils/package.json
RUN npm ci --workspace=workadventure-play --workspace=@workadventure/iframe-api-typings

COPY play ./play
ENV NODE_ENV=production
RUN export NODE_OPTIONS="$NODE_OPTIONS" && \
    export DISABLE_LEGACY_BROWSERS="$FAST_BUILD" && \
    export ENABLE_BACKGROUND_BLUR="$ENABLE_BACKGROUND_BLUR" && \
    export ENABLE_SENTRY="$ENABLE_SENTRY" && \
    export ENABLE_POSTHOG="$ENABLE_POSTHOG" && \
    cd play && \
    npm run typesafe-i18n && \
    npm run build-iframe-api && \
    npm run build

# ── Stage 3: Build map-storage Svelte Kit UI ────────────────────────────────
FROM --platform=$BUILDPLATFORM node:22-bullseye-slim AS map-storage-builder
WORKDIR /usr/src

RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

COPY --from=proto-builder /usr/src/libs libs

COPY package.json package-lock.json ./
COPY map-storage/package.json map-storage/package.json
COPY libs/messages/package.json libs/messages/package.json
COPY libs/map-editor/package.json libs/map-editor/package.json
COPY libs/math-utils/package.json libs/math-utils/package.json
COPY libs/tailwind/package.json libs/tailwind/package.json
COPY libs/store-utils/package.json libs/store-utils/package.json
COPY libs/shared-utils/package.json libs/shared-utils/package.json
RUN npm ci --workspace map-storage

COPY map-storage map-storage
RUN cd map-storage && npm run front:build

# ── Stage 4: Production image ───────────────────────────────────────────────
FROM node:22-bullseye-slim
LABEL maintainer="workadventure" \
      description="WorkAdventure All-in-One: play + back + map-storage + uploader"

# System packages: supervisord, nginx, git, curl
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        supervisor nginx git curl python3 make g++ cmake ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/log/supervisor /var/log/workadventure

# Feature-flag build args (play)
ARG ENABLE_BACKGROUND_BLUR=false
ARG ENABLE_S3_RECORDING=false
ARG ENABLE_SWAGGER=false
ARG ENABLE_SENTRY=false
ARG ENABLE_POSTHOG=false

ENV NODE_ENV=production
ENV UWS_HTTP_MAX_HEADERS_SIZE=16384
ENV ENABLE_SENTRY=${ENABLE_SENTRY}
ENV ENABLE_S3_RECORDING=${ENABLE_S3_RECORDING}

# ── Internal port remapping (avoids hardcoded-port collisions) ──────────────
ENV PUSHER_HTTP_PORT=3200
ENV PUSHER_WS_PORT=3201
ENV ROOM_API_PORT=50052
ENV HTTP_PORT=8180
ENV GRPC_PORT=50051

# ── Inter-service wiring (all on localhost) ─────────────────────────────────
ENV API_URL=localhost:50051
ENV INTERNAL_MAP_STORAGE_URL=http://localhost:3000
ENV MAP_STORAGE_URL=localhost:50053
ENV UPLOADER_URL=http://localhost:8080

WORKDIR /usr/src

# ── 1. Copy all source code from context (.dockerignore excludes node_modules)
COPY libs libs
COPY play play
COPY back back
COPY map-storage map-storage
COPY uploader uploader

# ── 2. Overlay built artifacts from builder stages (no node_modules)
# Play: built Vite output
COPY --from=play-builder /usr/src/play/dist play/dist
# Play: generated i18n files
COPY --from=play-builder /usr/src/play/src/i18n play/src/i18n
# Proto-generated code for libs
COPY --from=proto-builder /usr/src/libs/messages/src libs/messages/src
# Proto-generated code for back
COPY --from=proto-builder /usr/src/messages/generated back/src/Messages/generated
# Map-storage: built Svelte Kit UI
COPY --from=map-storage-builder /usr/src/map-storage/dist-ui map-storage/dist-ui

# ── 3. Install ALL production deps in one shot ─────────────────────────────
COPY package.json package-lock.json ./
COPY play/scripts/conditional-install.sh play/scripts/conditional-install.sh
RUN ENABLE_BACKGROUND_BLUR=$ENABLE_BACKGROUND_BLUR \
    ENABLE_S3_RECORDING=$ENABLE_S3_RECORDING \
    ENABLE_SWAGGER=$ENABLE_SWAGGER \
    ENABLE_SENTRY=$ENABLE_SENTRY \
    ENABLE_POSTHOG=$ENABLE_POSTHOG \
    sh play/scripts/conditional-install.sh && \
    npm ci --omit=dev \
        --workspace workadventure-play \
        --workspace @workadventure/iframe-api-typings \
        --workspace workadventureback \
        --workspace map-storage \
        --workspace workadventureuploader

# ── 4. Create required directories ─────────────────────────────────────────
RUN mkdir -p back/dist /maps && chown node:node /maps
ENV STORAGE_DIRECTORY=/maps

# ── 5. Configuration files ─────────────────────────────────────────────────
COPY aio/supervisord.conf /etc/supervisor/supervisord.conf
COPY aio/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=10s --start-period=30s --retries=5 \
    CMD curl -sf http://localhost:3200/ping && \
        curl -sf http://localhost:8180/ping && \
        curl -sf http://localhost:3000/ping || exit 1

CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]
