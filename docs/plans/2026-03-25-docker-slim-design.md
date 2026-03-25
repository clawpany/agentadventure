# Docker Image Slimming Design

**Date:** 2026-03-25
**Goal:** Reduce play/ Docker image from 2GB+ to ~1.6GB by removing dead dependencies and adding conditional build flags for optional features.

## Hard Removes (~308MB)

| Package | Size | Reason |
|---------|------|--------|
| `@tensorflow/tfjs` + `@tensorflow-models/body-pix` | ~300MB | Zero imports in codebase — dead code |
| `@livekit/track-processors` | ~3MB | Listed in package.json but never imported |
| `stanza` | ~5MB | Only used for `uuid` in one file — replaced by existing `uuid` package |

Also removed: `mediapipe_workaround()` in `vite.config.mts` (TF.js-related, no longer needed).

## Conditional Features (default OFF, ~107MB)

Each feature is controlled by a Docker build ARG and/or Vite define constant.

| Feature | ARG | Vite Define | Packages | Size |
|---------|-----|-------------|----------|------|
| Background blur | `ENABLE_BACKGROUND_BLUR` | `__ENABLE_BACKGROUND_BLUR__` | `@mediapipe/selfie_segmentation`, `@mediapipe/tasks-vision` | ~35MB |
| S3 recording | `ENABLE_S3_RECORDING` | — (server-side only) | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | ~35MB |
| Swagger API docs | `ENABLE_SWAGGER` | — (server-side only) | `swagger-ui-dist`, `swagger-jsdoc` | ~17MB |
| Sentry error tracking | `ENABLE_SENTRY` | `__ENABLE_SENTRY__` | `@sentry/browser`, `@sentry/node`, `@sentry/svelte` | ~17MB |
| PostHog analytics | `ENABLE_POSTHOG` | `__ENABLE_POSTHOG__` | `posthog-js` | ~3MB |

## Build Speedup

`FAST_BUILD` ARG defaults to `true` (was empty). Disables `@vitejs/plugin-legacy` polyfill generation for old browsers.

## Mechanism

### Install-time: conditional-install.sh

A script (`play/scripts/conditional-install.sh`) runs **before** `npm ci` in the production Docker stage. It uses Node to strip disabled feature dependencies from `package.json` so npm's resolver never installs them or their transitive deps.

### Build-time: Vite define constants

Frontend feature flags are injected via `vite.config.mts` `define`:

```ts
define: {
    __ENABLE_BACKGROUND_BLUR__: JSON.stringify(env.ENABLE_BACKGROUND_BLUR === "true"),
    __ENABLE_SENTRY__: JSON.stringify(env.ENABLE_SENTRY === "true"),
    __ENABLE_POSTHOG__: JSON.stringify(env.ENABLE_POSTHOG === "true"),
}
```

Code paths guarded by these constants are dead-code-eliminated by Vite/Rollup when set to `false`.

### Runtime: process.env checks

Server-side features (S3 recording, Swagger) check `process.env.ENABLE_*` at runtime and gracefully no-op when disabled.

## Files Modified

1. `play/package.json` — remove TF, livekit/track-processors, stanza
2. `play/vite.config.mts` — add define flags, remove mediapipe_workaround(), wire feature env vars
3. `play/Dockerfile` — add ARGs, default FAST_BUILD=true, run conditional-install before npm ci
4. `play/src/pusher/controllers/FrontController.ts` — replace stanza uuid with uuid package
5. `play/src/front/WebRtc/BackgroundProcessor/createBackgroundTransformer.ts` — guard behind __ENABLE_BACKGROUND_BLUR__
6. `play/src/pusher/services/RecordingService.ts` — guard behind ENABLE_S3_RECORDING env var
7. `play/src/pusher/controllers/SwaggerController.ts` — guard behind ENABLE_SWAGGER env var
8. `play/src/front/Connection/ConnectionManager.ts` — guard PostHog behind __ENABLE_POSTHOG__
9. `play/src/front/Administration/AnalyticsClient.ts` — guard PostHog behind __ENABLE_POSTHOG__

## Files Created

1. `play/scripts/conditional-install.sh` — strips disabled deps from package.json before npm ci
2. `play/src/front/utils/sentry.ts` — thin Sentry wrapper, no-ops when disabled
3. `play/src/pusher/utils/sentry.ts` — same for server-side

## Usage

Default lightweight build:
```bash
docker build -f play/Dockerfile .
```

Full-featured build:
```bash
docker build \
  --build-arg ENABLE_BACKGROUND_BLUR=true \
  --build-arg ENABLE_S3_RECORDING=true \
  --build-arg ENABLE_SWAGGER=true \
  --build-arg ENABLE_SENTRY=true \
  --build-arg ENABLE_POSTHOG=true \
  --build-arg FAST_BUILD=false \
  -f play/Dockerfile .
```
