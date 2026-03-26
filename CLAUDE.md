# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WorkAdventure is a platform for customizable collaborative virtual worlds (metaverse). It's a TypeScript monorepo with microservices communicating via gRPC/Protocol Buffers.

## Architecture

**Services:**
- **`play/`** - Frontend (Svelte + Phaser.js game engine) + Pusher (WebSocket dispatcher via Express). `src/front/` = client code, `src/pusher/` = server-side WebSocket relay to back.
- **`back/`** - Core game logic & state (Express + gRPC). Room/player management, permissions, area events. MVC pattern in `src/Model/`, `src/Controller/`, `src/Services/`.
- **`map-storage/`** - Map CRUD service (Express + S3/disk). Has its own Svelte Kit admin UI in `src-ui/`.
- **`messages/`** - Protocol Buffer `.proto` definitions + generated TypeScript (ts-proto). **Must be built before play/back.**
- **`tests/`** - End-to-end Playwright tests.

**Shared libraries (`libs/`):** `map-editor`, `shared-utils`, `math-utils`, `store-utils`, `messages` (generated protobuf types), `eslint-config`, `room-api-clients`, `tailwind`.

**Inter-service communication:** gRPC between play (pusher) and back. Redis for caching. LiveKit for video/audio.

## Development Commands

### Environment Setup
```bash
cp .env.template .env
docker-compose up  # Handles protoc, npm install, hot reload
# Access: http://play.workadventure.localhost/
# Test login: User1 / pwd
```

### Protocol Buffers (must build first for manual builds)
```bash
cd messages && npm install && npm run ts-proto
```

### Per-Service Commands
```bash
# Play (frontend + pusher)
cd play
npm run typesafe-i18n       # Generate i18n files (REQUIRED before build)
npm run build               # Vite build (may need NODE_OPTIONS=--max-old-space-size=16384)
npm run typecheck
npm run svelte-check
npm run lint-fix            # ESLint with auto-fix
npm run pretty              # Prettier
npm run test -- --watch=false

# Back
cd back
npm run typecheck
npm run lint-fix
npm run pretty
npm run test -- --watch=false

# Map Storage
cd map-storage
npm run typecheck
npm run lint-fix
npm run pretty
npm run test -- --watch=false
```

### E2E Tests (Playwright)
```bash
cd tests
npx playwright install --with-deps
npm run test                              # Headless, all browsers
npm run test-headed-chrome -- tests/[file.ts]  # Single test, interactive
```

### Linting & Formatting
All services use the same script names: `lint`, `lint-fix`, `pretty`, `pretty-check`. Pre-commit hooks (Husky) run these automatically.

## Key Patterns

- **State management:** RxJS observables + Svelte stores in the frontend.
- **i18n:** typesafe-i18n. Translation files at `play/src/i18n/[language]/[module].ts`. Audit missing keys: `cd play && npm run i18n:diff` (summary) or `npm run i18n:diff -- fr-FR` (detailed).
- **Formatting:** Prettier with 120 char width, 4-space tabs.
- **Testing:** Vitest for unit tests, Playwright for E2E. E2E requires running Docker environment.

## Common Issues

- **"Cannot find module 'ts-proto-generated'"** - Build messages first: `cd messages && npm run ts-proto`
- **"JavaScript heap out of memory"** - `export NODE_OPTIONS=--max-old-space-size=16384`
- **Port conflicts** - `docker-compose down` or kill processes on ports 3000, 3001, 8080
- **Hostname resolution** - May need to add `*.workadventure.localhost` entries to `/etc/hosts` (see README.md)
