# Build Images Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `.github/workflows/build-images.yml` that builds and pushes the minified `play` image and the all-in-one (`aio`) image to GHCR on every push to the `agent` branch and on manual dispatch.

**Architecture:** A single workflow file with two parallel jobs (`build-play`, `build-aio`). Each job checks out the repo, authenticates to GHCR with `GITHUB_TOKEN`, and uses `docker/build-push-action@v6` to build and push. Both jobs run on `ubuntu-24.04` (amd64 only). No Sentry, no DockerHub.

**Tech Stack:** GitHub Actions, Docker Buildx (`docker/setup-buildx-action@v3`), `docker/login-action@v3`, `docker/build-push-action@v6`

---

### Task 1: Create the workflow file

**Files:**
- Create: `.github/workflows/build-images.yml`

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/build-images.yml` with this exact content:

```yaml
name: Build and push images

on:
  push:
    branches: [agent]
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-play:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push play image
        uses: docker/build-push-action@v6
        with:
          context: ./
          file: play/Dockerfile
          push: true
          build-args: |
            FAST_BUILD=true
          tags: |
            ghcr.io/clawpany/agentadventure-play:latest
            ghcr.io/clawpany/agentadventure-play:agent
            ghcr.io/clawpany/agentadventure-play:${{ github.sha }}

  build-aio:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push aio image
        uses: docker/build-push-action@v6
        with:
          context: ./
          file: aio/Dockerfile
          push: true
          build-args: |
            FAST_BUILD=true
          tags: |
            ghcr.io/clawpany/agentadventure-aio:latest
            ghcr.io/clawpany/agentadventure-aio:agent
            ghcr.io/clawpany/agentadventure-aio:${{ github.sha }}
```

- [ ] **Step 2: Validate YAML syntax**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-images.yml'))" && echo "YAML OK"
```
Expected: `YAML OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build-images.yml
git commit -m "feat: add GitHub Actions workflow to build and push play and aio images to GHCR"
```
