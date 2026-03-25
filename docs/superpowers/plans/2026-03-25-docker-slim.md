# Docker Image Slimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce play/ Docker image from 2GB+ to ~1.6GB by removing dead dependencies, adding conditional build flags, and defaulting to modern-browser-only builds.

**Architecture:** Hard-remove unused packages (TensorFlow, livekit/track-processors, stanza). For optional features (background blur, S3 recording, Swagger, Sentry, PostHog), strip deps from package.json before `npm ci` via a conditional-install script, and use Vite `define` constants + `resolve.alias` to dead-code-eliminate frontend code paths. Server-side features use runtime `process.env` checks with try/catch dynamic imports.

**Tech Stack:** Node.js, Vite (define + resolve.alias), Docker multi-stage build, shell scripting

**Design doc:** `docs/plans/2026-03-25-docker-slim-design.md`

---

### Task 1: Hard-remove dead dependencies

**Files:**
- Modify: `play/package.json`
- Modify: `play/vite.config.mts`
- Modify: `play/src/pusher/controllers/FrontController.ts:4`

- [ ] **Step 1: Remove TensorFlow and unused packages from package.json**

In `play/package.json`, remove these lines from `"dependencies"`:
```json
"@tensorflow-models/body-pix": "^2.2.1",
"@tensorflow/tfjs": "^4.11.0",
"@livekit/track-processors": "^0.5.8",
"stanza": "^12.18.0",
```

Also remove from `"devDependencies"`:
```json
"@types/xmpp__client": "^0.13.0",
"@types/xmpp__jid": "^1.3.3",
```

- [ ] **Step 2: Replace stanza uuid import in FrontController.ts**

In `play/src/pusher/controllers/FrontController.ts`, change line 4:
```ts
// Before:
import { uuid } from "stanza/Utils";

// After:
import { v4 as uuid } from "uuid";
```

- [ ] **Step 3: Remove mediapipe_workaround from vite.config.mts**

In `play/vite.config.mts`:

1. Remove the `mediapipe_workaround()` call from `rollupOptions.plugins` (line 33):
```ts
// Before:
rollupOptions: {
    plugins: [mediapipe_workaround()],
    // external: ["@mediapipe/tasks-vision"],

// After:
rollupOptions: {
    // external: ["@mediapipe/tasks-vision"],
```

2. Remove the entire `mediapipe_workaround()` function (lines 133-148).

3. Remove unused `basename` import from line 1 if no longer used:
```ts
// Before:
import { basename } from "path";

// After: (remove the line entirely, fs may still be used by sentry plugin)
```

- [ ] **Step 4: Verify changes compile**

Run: `cd play && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to removed packages. (Warnings about uninstalled mediapipe/sentry/etc are OK at this stage since node_modules isn't fully installed.)

- [ ] **Step 5: Commit**

```bash
git add play/package.json play/vite.config.mts play/src/pusher/controllers/FrontController.ts
git commit -m "chore: remove dead dependencies (tensorflow, livekit/track-processors, stanza)

Remove ~308MB of unused packages from play/:
- @tensorflow/tfjs + @tensorflow-models/body-pix: zero imports in codebase
- @livekit/track-processors: listed but never imported
- stanza: replaced single uuid import with existing uuid package
- mediapipe_workaround() in vite.config.mts: no longer needed"
```

---

### Task 2: Create conditional-install.sh

**Files:**
- Create: `play/scripts/conditional-install.sh`

- [ ] **Step 1: Create the script**

Create `play/scripts/conditional-install.sh`:

```bash
#!/bin/sh
# Strips disabled feature dependencies from package.json before npm ci.
# Run BEFORE npm ci in Docker production stage.
# Each ENABLE_* env var defaults to "false" — set to "true" to keep the feature.

set -e

node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('play/package.json', 'utf8'));

const removals = {
  ENABLE_BACKGROUND_BLUR: ['@mediapipe/selfie_segmentation', '@mediapipe/tasks-vision'],
  ENABLE_S3_RECORDING: ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
  ENABLE_SWAGGER: ['swagger-ui-dist', 'swagger-jsdoc'],
  ENABLE_SENTRY: ['@sentry/browser', '@sentry/node', '@sentry/svelte'],
  ENABLE_POSTHOG: ['posthog-js'],
};

let removed = [];
for (const [flag, deps] of Object.entries(removals)) {
  if (process.env[flag] !== 'true') {
    for (const dep of deps) {
      if (pkg.dependencies && pkg.dependencies[dep]) {
        delete pkg.dependencies[dep];
        removed.push(dep);
      }
      if (pkg.devDependencies && pkg.devDependencies[dep]) {
        delete pkg.devDependencies[dep];
        removed.push(dep);
      }
    }
  }
}

if (removed.length > 0) {
  console.log('Stripped disabled feature deps: ' + removed.join(', '));
} else {
  console.log('All features enabled, no deps stripped.');
}

fs.writeFileSync('play/package.json', JSON.stringify(pkg, null, 2) + '\n');
"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x play/scripts/conditional-install.sh`

- [ ] **Step 3: Commit**

```bash
git add play/scripts/conditional-install.sh
git commit -m "feat: add conditional-install.sh for feature-flagged dep stripping"
```

---

### Task 3: Add Vite define constants and resolve aliases for frontend features

**Files:**
- Modify: `play/vite.config.mts`
- Create: `play/src/front/utils/sentry-noop.ts`

- [ ] **Step 1: Create frontend Sentry no-op shim**

Create `play/src/front/utils/sentry-noop.ts`:

```ts
// No-op Sentry shim used when ENABLE_SENTRY is false.
// Vite resolve.alias maps @sentry/svelte and @sentry/browser to this file.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noop = (..._args: any[]): any => {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noopPassthrough = (fn: any) => fn;

export const init = noop;
export const captureException = noop;
export const captureMessage = noop;
export const setUser = noop;
export const setContext = noop;
export const setTag = noop;
export const withScope = noopPassthrough;
export const startSpan = noopPassthrough;
export const addBreadcrumb = noop;
export const configureScope = noopPassthrough;
export const getCurrentHub = () => ({ getClient: () => null });
export default {
    init,
    captureException,
    captureMessage,
    setUser,
    setContext,
    setTag,
    withScope,
    startSpan,
    addBreadcrumb,
    configureScope,
    getCurrentHub,
};
```

- [ ] **Step 2: Add define constants and resolve aliases to vite.config.mts**

In `play/vite.config.mts`, inside the `defineConfig` callback, after `const env = loadEnv(...)` (line 16), add the define block to the config object and conditionally add resolve aliases:

```ts
// Add to the config object, after the "test" block (around line 101):
define: {
    __ENABLE_BACKGROUND_BLUR__: JSON.stringify(env.ENABLE_BACKGROUND_BLUR === "true"),
    __ENABLE_SENTRY__: JSON.stringify(env.ENABLE_SENTRY === "true"),
    __ENABLE_POSTHOG__: JSON.stringify(env.ENABLE_POSTHOG === "true"),
},
```

Add Sentry resolve alias — modify the existing `resolve.alias` section:

```ts
// Before:
resolve: {
    alias: {
        events: "events",
    },
},

// After:
resolve: {
    alias: {
        events: "events",
        ...(env.ENABLE_SENTRY === "true"
            ? {}
            : {
                  "@sentry/svelte": path.resolve(__dirname, "src/front/utils/sentry-noop.ts"),
                  "@sentry/browser": path.resolve(__dirname, "src/front/utils/sentry-noop.ts"),
              }),
    },
},
```

Add `import path from "path";` at the top of the file if not already present.

- [ ] **Step 3: Also guard the Sentry Vite plugin**

The existing Sentry Vite plugin block (lines 103-129) already checks for `SENTRY_ORG` etc. Add an additional `ENABLE_SENTRY` check:

```ts
// Before:
if (env.SENTRY_ORG && env.SENTRY_PROJECT && env.SENTRY_AUTH_TOKEN && env.SENTRY_RELEASE && env.SENTRY_ENVIRONMENT) {

// After:
if (env.ENABLE_SENTRY === "true" && env.SENTRY_ORG && env.SENTRY_PROJECT && env.SENTRY_AUTH_TOKEN && env.SENTRY_RELEASE && env.SENTRY_ENVIRONMENT) {
```

- [ ] **Step 4: Declare global types for define constants**

Add to a declaration file. Check if `play/src/types/` exists and find an appropriate `.d.ts` file, or create `play/src/types/feature-flags.d.ts`:

```ts
declare const __ENABLE_BACKGROUND_BLUR__: boolean;
declare const __ENABLE_SENTRY__: boolean;
declare const __ENABLE_POSTHOG__: boolean;
```

- [ ] **Step 5: Commit**

```bash
git add play/vite.config.mts play/src/front/utils/sentry-noop.ts play/src/types/feature-flags.d.ts
git commit -m "feat: add Vite define constants and Sentry resolve alias for feature flags"
```

---

### Task 4: Guard background blur behind feature flag

**Files:**
- Modify: `play/src/front/WebRtc/BackgroundProcessor/createBackgroundTransformer.ts`

- [ ] **Step 1: Add feature flag guard**

In `play/src/front/WebRtc/BackgroundProcessor/createBackgroundTransformer.ts`, wrap the MediaPipe imports and usage behind the compile-time flag:

```ts
import { BACKGROUND_TRANSFORMER_ENGINE } from "../../Enum/EnvironmentVariable";
import { FallbackBackgroundTransformer } from "./FallbackBackgroundTransformer";

export type BackgroundMode = "none" | "blur" | "image" | "video";

export interface BackgroundConfig {
    mode: BackgroundMode;
    blurAmount?: number;
    backgroundImage?: string;
    backgroundVideo?: string;
}

export interface BackgroundTransformer {
    updateConfig(config: Partial<BackgroundConfig>): Promise<void>;
    getPerformanceStats(): unknown;
    close(): void;
    waitForInitialization(): Promise<void>;
    transform(inputStream: MediaStream, signal?: AbortSignal): Promise<MediaStream>;
    stop(): void;
}

/**
 * Create a MediaPipe-based background transformer with fallback support
 * Supports both the new Tasks Vision API (GPU-accelerated) and legacy Selfie Segmentation (CPU)
 * Selected via BACKGROUND_TRANSFORMER_ENGINE environment variable
 *
 * @param config Background configuration
 * @returns A MediaPipe transformer instance or fallback
 */
export function createBackgroundTransformer(config: BackgroundConfig): BackgroundTransformer {
    if (!__ENABLE_BACKGROUND_BLUR__) {
        console.info("[BackgroundProcessor] Background blur disabled at build time");
        return new FallbackBackgroundTransformer();
    }

    // Check browser support for MediaStream APIs
    if (typeof MediaStreamTrackProcessor === "undefined" || typeof MediaStreamTrackGenerator === "undefined") {
        return new FallbackBackgroundTransformer();
    }

    const engine = BACKGROUND_TRANSFORMER_ENGINE || "tasks-vision";
    console.info(`[BackgroundProcessor] Using transformer engine: ${engine}`);

    if (engine === "tasks-vision") {
        try {
            // Dynamic import to allow tree-shaking when disabled
            const { MediaPipeTasksVisionTransformer } = require("./MediaPipeTasksVisionTransformer");
            const transformer = new MediaPipeTasksVisionTransformer(config);
            return transformer;
        } catch (error) {
            console.error("[BackgroundTransformer] Failed to create Tasks Vision transformer, using fallback:", error);
            return new FallbackBackgroundTransformer();
        }
    }

    try {
        const { MediaPipeBackgroundTransformer } = require("./MediaPipeBackgroundTransformer");
        const transformer = new MediaPipeBackgroundTransformer(config);
        return transformer;
    } catch (error) {
        console.error(
            "[BackgroundTransformer] Failed to create Selfie Segmentation transformer, using fallback:",
            error
        );
        return new FallbackBackgroundTransformer();
    }
}
```

Key change: The top-level static imports of `MediaPipeTasksVisionTransformer` and `MediaPipeBackgroundTransformer` are replaced with `require()` inside the `if (__ENABLE_BACKGROUND_BLUR__)` block. When the flag is `false`, Vite dead-code-eliminates the entire block, so the MediaPipe modules are never bundled.

- [ ] **Step 2: Commit**

```bash
git add play/src/front/WebRtc/BackgroundProcessor/createBackgroundTransformer.ts
git commit -m "feat: guard background blur behind __ENABLE_BACKGROUND_BLUR__ build flag"
```

---

### Task 5: Guard PostHog behind feature flag

**Files:**
- Modify: `play/src/front/Administration/AnalyticsClient.ts`

- [ ] **Step 1: Add feature flag guard to AnalyticsClient constructor**

In `play/src/front/Administration/AnalyticsClient.ts`, wrap the PostHog initialization:

```ts
// Before (line 11-19):
constructor() {
    const postHogApiKey = POSTHOG_API_KEY;
    if (postHogApiKey && POSTHOG_URL) {
        this.posthogPromise = import("posthog-js").then(({ default: posthog }) => {

// After:
constructor() {
    if (!__ENABLE_POSTHOG__) {
        return;
    }
    const postHogApiKey = POSTHOG_API_KEY;
    if (postHogApiKey && POSTHOG_URL) {
        this.posthogPromise = import("posthog-js").then(({ default: posthog }) => {
```

When `__ENABLE_POSTHOG__` is `false`, Vite will dead-code-eliminate the `import("posthog-js")` call and the entire constructor body, so posthog-js is never bundled.

- [ ] **Step 2: Commit**

```bash
git add play/src/front/Administration/AnalyticsClient.ts
git commit -m "feat: guard PostHog behind __ENABLE_POSTHOG__ build flag"
```

---

### Task 6: Create server-side Sentry wrapper for pusher

**Files:**
- Create: `play/src/pusher/utils/sentry.ts`
- Modify: All pusher files that import `@sentry/node` (~15 files)

- [ ] **Step 1: Create pusher Sentry wrapper**

Create `play/src/pusher/utils/sentry.ts`:

```ts
// Sentry wrapper for pusher. Re-exports @sentry/node when ENABLE_SENTRY is true,
// otherwise exports no-op stubs. This allows the S3 recording packages to be
// stripped without breaking server-side code.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noop: AnyFn = (..._args: any[]) => {};
const noopPassthrough: AnyFn = (fn) => fn;

interface SentryLike {
    init: AnyFn;
    captureException: AnyFn;
    captureMessage: AnyFn;
    setUser: AnyFn;
    setContext: AnyFn;
    setTag: AnyFn;
    withScope: AnyFn;
    startSpan: AnyFn;
    addBreadcrumb: AnyFn;
    [key: string]: AnyFn;
}

let sentryModule: SentryLike;

if (process.env.ENABLE_SENTRY === "true") {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        sentryModule = require("@sentry/node");
    } catch {
        console.warn("[Sentry] ENABLE_SENTRY is true but @sentry/node is not installed. Using no-op stubs.");
        sentryModule = new Proxy({} as SentryLike, {
            get: (_, prop) => (prop === "init" ? noop : noop),
        });
    }
} else {
    sentryModule = new Proxy({} as SentryLike, {
        get: (_, prop) => (prop === "withScope" || prop === "startSpan" ? noopPassthrough : noop),
    });
}

export default sentryModule;
export const {
    init,
    captureException,
    captureMessage,
    setUser,
    setContext,
    setTag,
    withScope,
    startSpan,
    addBreadcrumb,
} = sentryModule;
```

- [ ] **Step 2: Update all pusher imports from @sentry/node to the wrapper**

Change all files that have `import * as Sentry from "@sentry/node"` to use the wrapper instead. The files are:

- `play/src/server.ts`
- `play/src/room-api/RoomApiServer.ts`
- `play/src/pusher/controllers/FrontController.ts`
- `play/src/pusher/controllers/IoSocketController.ts`
- `play/src/pusher/controllers/AuthenticatedProviderController.ts`
- `play/src/pusher/middlewares/AdminToken.ts`
- `play/src/pusher/middlewares/Authenticated.ts`
- `play/src/pusher/middlewares/MapStorageToken.ts`
- `play/src/pusher/models/Zone.ts`
- `play/src/pusher/models/PusherRoom.ts`
- `play/src/pusher/models/Space.ts`
- `play/src/pusher/models/SpaceConnection.ts`
- `play/src/pusher/models/SpaceToBackForwarder.ts`
- `play/src/pusher/models/SpaceToFrontDispatcher.ts`
- `play/src/pusher/models/SpaceNotificationStrategy/LiveStreamingNotificationStrategy.ts`
- `play/src/pusher/services/AdminApi.ts`
- `play/src/pusher/services/AdminWokaService.ts`
- `play/src/pusher/services/AdminCompanionService.ts`
- `play/src/pusher/services/GlobalErrorHandler.ts`
- `play/src/pusher/services/SocketManager.ts`
- `play/src/pusher/services/RedisClient.ts`

In each file, change:
```ts
// Before:
import * as Sentry from "@sentry/node";

// After (adjust relative path per file):
import Sentry from "<relative-path>/utils/sentry";
```

For example, in `play/src/pusher/controllers/FrontController.ts`:
```ts
import Sentry from "../utils/sentry";
```

In `play/src/server.ts`:
```ts
import Sentry from "./pusher/utils/sentry";
```

In `play/src/room-api/RoomApiServer.ts`:
```ts
import Sentry from "../pusher/utils/sentry";
```

- [ ] **Step 3: Commit**

```bash
git add play/src/pusher/utils/sentry.ts play/src/server.ts play/src/room-api/RoomApiServer.ts play/src/pusher/controllers/ play/src/pusher/middlewares/ play/src/pusher/models/ play/src/pusher/services/AdminApi.ts play/src/pusher/services/AdminWokaService.ts play/src/pusher/services/AdminCompanionService.ts play/src/pusher/services/GlobalErrorHandler.ts play/src/pusher/services/SocketManager.ts play/src/pusher/services/RedisClient.ts
git commit -m "feat: wrap pusher Sentry imports behind ENABLE_SENTRY runtime flag"
```

---

### Task 7: Guard Swagger behind conditional import

**Files:**
- Modify: `play/src/pusher/app.ts:17,102-104`

- [ ] **Step 1: Make SwaggerController import conditional**

In `play/src/pusher/app.ts`, the SwaggerController is already guarded by `ENABLE_OPENAPI_ENDPOINT` (line 102). But the static import at line 17 still pulls in `swagger-jsdoc`. Change to a dynamic import:

```ts
// Before (line 17):
import { SwaggerController } from "./controllers/SwaggerController";

// Remove this line entirely.

// Before (lines 102-104):
if (ENABLE_OPENAPI_ENDPOINT) {
    new SwaggerController(this.app);
}

// After:
if (ENABLE_OPENAPI_ENDPOINT) {
    import("./controllers/SwaggerController")
        .then(({ SwaggerController }) => {
            new SwaggerController(this.app);
        })
        .catch((e) => {
            console.warn("[Swagger] swagger-jsdoc/swagger-ui-dist not installed. Swagger UI disabled.", e);
        });
}
```

- [ ] **Step 2: Commit**

```bash
git add play/src/pusher/app.ts
git commit -m "feat: lazy-import SwaggerController so swagger deps can be stripped"
```

---

### Task 8: Guard S3 RecordingService behind feature flag

**Files:**
- Modify: `play/src/pusher/services/RecordingService.ts`

- [ ] **Step 1: Read the current RecordingService to understand structure**

Run: Read `play/src/pusher/services/RecordingService.ts` to understand how S3Client is imported and used.

- [ ] **Step 2: Make AWS SDK imports conditional**

Change the top-level AWS SDK imports to dynamic imports inside the methods that use them. Wrap the S3Client creation in a check:

```ts
// Before (top of file):
import {
    S3Client,
    type S3ClientConfig,
    // ... other imports
} from "@aws-sdk/client-s3";

// After:
// Move AWS SDK imports to be dynamic inside methods.
// Add a helper at the top:
async function getS3Module() {
    if (process.env.ENABLE_S3_RECORDING !== "true") {
        throw new Error("S3 recording is disabled. Set ENABLE_S3_RECORDING=true to enable.");
    }
    return await import("@aws-sdk/client-s3");
}

async function getS3PresignerModule() {
    if (process.env.ENABLE_S3_RECORDING !== "true") {
        throw new Error("S3 recording is disabled. Set ENABLE_S3_RECORDING=true to enable.");
    }
    return await import("@aws-sdk/s3-request-presigner");
}
```

Then update all usages of `S3Client`, `GetObjectCommand`, `ListObjectsV2Command`, etc. to use the dynamically imported module. This requires making the methods that use these classes `async` (most already are).

Note: This task requires careful reading of the full RecordingService file to update all references. The agent should read the full file first.

- [ ] **Step 3: Commit**

```bash
git add play/src/pusher/services/RecordingService.ts
git commit -m "feat: guard S3 RecordingService behind ENABLE_S3_RECORDING runtime flag"
```

---

### Task 9: Update Dockerfile

**Files:**
- Modify: `play/Dockerfile`

- [ ] **Step 1: Add feature flag ARGs and update FAST_BUILD default**

In `play/Dockerfile`, add the ARGs after the existing `FROM` line for the production stage, and update `FAST_BUILD`:

```dockerfile
# At the top of the file, update the builder stage:
# Change:
ARG FAST_BUILD=""
# To:
ARG FAST_BUILD=true

# Before the production stage "FROM node:20.18-bullseye-slim" (line 52), add:
ARG ENABLE_BACKGROUND_BLUR=false
ARG ENABLE_S3_RECORDING=false
ARG ENABLE_SWAGGER=false
ARG ENABLE_SENTRY=false
ARG ENABLE_POSTHOG=false
```

- [ ] **Step 2: Pass feature flags to builder stage for Vite define**

In the builder stage RUN command (around line 32), add the feature flag exports:

```dockerfile
RUN --mount=type=secret,id=SENTRY_RELEASE \
    --mount=type=secret,id=SENTRY_URL \
    --mount=type=secret,id=SENTRY_AUTH_TOKEN \
    --mount=type=secret,id=SENTRY_ORG \
    --mount=type=secret,id=SENTRY_PROJECT \
    --mount=type=secret,id=SENTRY_ENVIRONMENT \
    export SENTRY_RELEASE=$(cat /run/secrets/SENTRY_RELEASE) && \
    export SENTRY_URL=$(cat /run/secrets/SENTRY_URL) && \
    export SENTRY_AUTH_TOKEN=$(cat /run/secrets/SENTRY_AUTH_TOKEN) && \
    export SENTRY_ORG=$(cat /run/secrets/SENTRY_ORG) && \
    export SENTRY_PROJECT=$(cat /run/secrets/SENTRY_PROJECT) && \
    export SENTRY_ENVIRONMENT=$(cat /run/secrets/SENTRY_ENVIRONMENT) && \
    export NODE_OPTIONS="$NODE_OPTIONS" && \
    export DISABLE_LEGACY_BROWSERS="$FAST_BUILD" && \
    export ENABLE_BACKGROUND_BLUR="$ENABLE_BACKGROUND_BLUR" && \
    export ENABLE_SENTRY="$ENABLE_SENTRY" && \
    export ENABLE_POSTHOG="$ENABLE_POSTHOG" && \
    cd play && \
    npm run typesafe-i18n && \
    npm run build-iframe-api && \
    SENTRY_RELEASE=$SENTRY_RELEASE SENTRY_URL=$SENTRY_URL SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN SENTRY_ORG=$SENTRY_ORG SENTRY_PROJECT=$SENTRY_PROJECT SENTRY_ENVIRONMENT=$SENTRY_ENVIRONMENT npm run build
```

Note: The builder stage needs the feature flag ARGs redeclared after its FROM (Docker ARGs don't persist across stages):

```dockerfile
FROM --platform=$BUILDPLATFORM node:20.18-bullseye-slim AS builder
ARG NODE_OPTIONS="--max-old-space-size=16384"
ARG FAST_BUILD=true
ARG ENABLE_BACKGROUND_BLUR=false
ARG ENABLE_SENTRY=false
ARG ENABLE_POSTHOG=false
```

- [ ] **Step 3: Add conditional-install.sh to production stage**

In the production stage, copy the script and run it before `npm ci`:

```dockerfile
# Before (line 67):
RUN npm ci --omit=dev --workspace workadventure-play

# After:
COPY play/scripts/conditional-install.sh play/scripts/conditional-install.sh
ARG ENABLE_BACKGROUND_BLUR=false
ARG ENABLE_S3_RECORDING=false
ARG ENABLE_SWAGGER=false
ARG ENABLE_SENTRY=false
ARG ENABLE_POSTHOG=false
RUN ENABLE_BACKGROUND_BLUR=$ENABLE_BACKGROUND_BLUR \
    ENABLE_S3_RECORDING=$ENABLE_S3_RECORDING \
    ENABLE_SWAGGER=$ENABLE_SWAGGER \
    ENABLE_SENTRY=$ENABLE_SENTRY \
    ENABLE_POSTHOG=$ENABLE_POSTHOG \
    sh play/scripts/conditional-install.sh && \
    npm ci --omit=dev --workspace workadventure-play
```

- [ ] **Step 4: Pass runtime env vars for server-side features**

Add ENV defaults so pusher code can check them:

```dockerfile
# After the npm ci line, before COPY --from=builder:
ENV ENABLE_SENTRY=false
ENV ENABLE_S3_RECORDING=false
```

These can be overridden at `docker run` time via `-e ENABLE_SENTRY=true`.

- [ ] **Step 5: Commit**

```bash
git add play/Dockerfile
git commit -m "feat: update Dockerfile with feature flag ARGs and conditional dep install

- Default FAST_BUILD=true (skip legacy browser polyfills)
- Add ENABLE_* ARGs for all conditional features (default false)
- Run conditional-install.sh before npm ci to strip disabled deps
- Pass feature flags to Vite build for dead-code elimination"
```

---

### Task 10: Verification and testing

- [ ] **Step 1: Verify TypeScript compilation**

Run: `cd play && npx tsc --noEmit 2>&1 | head -50`
Expected: Clean compilation or only pre-existing warnings.

- [ ] **Step 2: Run existing unit tests**

Run: `cd play && npm run test -- --watch=false 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 3: Test lightweight Docker build (if Docker available)**

Run:
```bash
docker build -f play/Dockerfile . 2>&1 | tail -20
docker images | grep play
```
Expected: Build succeeds. Image size should be noticeably smaller than 2GB.

- [ ] **Step 4: Test full-featured Docker build (if Docker available)**

Run:
```bash
docker build \
  --build-arg ENABLE_BACKGROUND_BLUR=true \
  --build-arg ENABLE_S3_RECORDING=true \
  --build-arg ENABLE_SWAGGER=true \
  --build-arg ENABLE_SENTRY=true \
  --build-arg ENABLE_POSTHOG=true \
  --build-arg FAST_BUILD=false \
  -f play/Dockerfile . 2>&1 | tail -20
```
Expected: Build succeeds with all features enabled.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```
