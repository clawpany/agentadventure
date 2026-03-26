# Design: GitHub Actions — Build & Push Play + AIO Images

**Date:** 2026-03-26
**Branch:** agent
**Repo:** clawpany/agentadventure

## Goal

Add a GitHub Actions workflow that builds and pushes two Docker images to GHCR:
1. **play** — minified play image (no legacy browser support)
2. **aio** — all-in-one image (play + back + map-storage + uploader via supervisord)

## Trigger

```yaml
on:
  push:
    branches: [agent]
  workflow_dispatch:
```

Runs on every push to `agent` and on-demand via the GitHub Actions UI.

## Architecture

- **Platform:** amd64 only (`ubuntu-24.04` runner)
- **Registry:** GHCR (`ghcr.io/clawpany/`)
- **Auth:** `GITHUB_TOKEN` (no external secrets required)

## Jobs

Both jobs run in parallel as independent jobs in a single workflow file: `.github/workflows/build-images.yml`.

### `build-play`

| Field | Value |
|---|---|
| Dockerfile | `play/Dockerfile` |
| Context | `./` |
| Build-arg | `FAST_BUILD=true` (disables legacy browser polyfills → smaller bundle) |
| Image | `ghcr.io/clawpany/agentadventure-play` |
| Tags | `latest`, `agent`, `<sha>` |

### `build-aio`

| Field | Value |
|---|---|
| Dockerfile | `aio/Dockerfile` |
| Context | `./` |
| Build-arg | `FAST_BUILD=true` |
| Image | `ghcr.io/clawpany/agentadventure-aio` |
| Tags | `latest`, `agent`, `<sha>` |

## Permissions

Each job sets `packages: write` to allow pushing to GHCR.

## Exclusions

- No Sentry integration (upstream uses Sentry secrets not available here)
- No DockerHub push (fork-specific, GHCR only)
- No arm64 build (amd64 sufficient for this use case)
- Does not reuse existing `build-single-image.yml` / `build-multi-arch-image.yml` (those have org-gated logic for `workadventure`)
