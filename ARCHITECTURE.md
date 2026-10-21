# ARCHITECTURE

## Stack (one stack for every module)

| Concern | Choice | Pinned in |
|---|---|---|
| Language/runtime | TypeScript (strict, ESM, NodeNext) on Node.js 22 LTS | `package.json` engines, `.nvmrc` |
| HTTP | Fastify 5 | `package-lock.json` |
| Database | SQLite (WAL, `synchronous=FULL`) via better-sqlite3 | lockfile |
| Validation/contracts | Zod 4 | lockfile |
| Tests | Vitest | lockfile |
| Web UI | React + Vite SPA in `web/`, bundled assets only (no CDN). Versions pinned when first installed in M01 | `web/package.json` + lockfile |

All dependencies are open source, pinned to exact versions (`.npmrc` `save-exact`), installed from the lockfile. No paid or hosted service is required at runtime. Why each choice: see DECISIONS D01, D14.

## Topology

```
                    ┌────────────── HUB installation (HQ) ──────────────┐
                    │ reference data · number ranges · sync relay · UI  │
                    └───────▲───────────────▲───────────────▲───────────┘
         HTTPS or signed    │               │               │   same envelope either way
         bundle file (USB)  │               │               │
                  ┌─────────┴──┐     ┌──────┴─────┐   ┌─────┴───────┐
                  │ SHIP inst. │     │ WORKSHOP   │   │ COMMAND     │  (only where disconnected
                  │ app + DB   │     │ inst.      │   │ inst.       │   operation is required)
                  └─────▲──────┘     └────────────┘   └─────────────┘
              LAN browsers (department PCs)
```

- **One deployable per installation**: a single Node process serving the API and the built web UI, and one SQLite file. Department PCs are plain browsers on the local LAN.
- **Hub and spoke only** in R1. Replicas never sync with each other directly; the hub relays. Bundle files use the identical change envelope, so a ship with no link at all can still exchange data.
- A command or workshop that always has connectivity needs no replica: its users work as clients of the hub.
- Core local operations make no outbound network calls.

## Layering inside one installation

```
src/main.ts, src/modules/index.ts      composition root (only place that sees many modules)
src/modules/<mNN-name>/                a module: routes → services → repositories → migrations
src/platform/                          kernel shared by all modules (never imports a module)
```

Module rules (enforced by `npm run check:boundaries`, details in MODULE_MAP.md):
1. A module imports only `src/platform`, itself, and the public `index.ts` of modules it declares in `dependsOn` (`src/platform/modules.ts`).
2. Cross-module needs that would break the dependency direction use **ports** registered at runtime (`ports.ts`, entity registry, authorizer, event bus).
3. A module creates only tables/views with its own prefix. Others read its data through its public functions or published `<prefix>_v_*` views, never its base tables.
4. All writes to synced tables go through `platform/records.ts`.

## Request flow

`HTTP → correlation id → authenticate → Authorizer.check(permission, scope) → workflow/gate check → service → platform write path (ownership + version check → row → audit envelope → change log, one transaction) → response with new version`.

Reads of synchronized data return `Freshness` per scope so the UI can show stale data and pending confirmations.

## Platform kernel (M00, implemented)

`ids` (UUIDv7) · `time` (UTC/local display) · `units` · `errors` · `contracts` (Zod shapes) · `modules` (manifest) · `entity-registry` (record classes) · `records` (write path, audit, change log) · `ranges` (offline number allocation) · `authz` (port) · `ports` (types) · `events` (in-process bus) · `db/` (open, migrate) · `identity` (installation identity).

## Database and migrations

- One file per installation; one writer process; WAL for concurrent LAN readers.
- Forward-only migrations `NNNN_name.sql`, per module directory (`src/modules/<dir>/migrations`), applied platform-first then in dependency order; SHA-256 checksum recorded; editing an applied file is an error. Macros (`{{SYNC_COLUMNS}}`, `{{EVENT_COLUMNS}}`, `{{TRIGGERS_*}}`) inject the sync contract so it cannot be forgotten. Startup runs `verifySyncedTables`.
- Upgrades are always preceded by an automatic backup (M14). Replicas exchange per-module schema versions at sync handshake.

## UI conventions (applied from M01)

One shell with a navigation registry fed by module `NavItem`s (permission-filtered); every screen shows data freshness for its scope; shared components for tables, forms, status chips (four status axes shown separately), version-conflict dialogs and label-keyed text (`labelKey`) so translation can be added without rewrites. Times are shown in the configured zone (default Asia/Colombo) and stored in UTC.

## Verification

`npm run verify` = typecheck + boundary check + tests. CI and every module chat must finish with it green.

## Security baseline (details in M02/M14)

Password hashing with Node `scrypt` (no native dependency); sessions are installation-local; installation signing keys (Ed25519) for sync; database-at-rest protection through OS disk encryption initially (DECISIONS D17); loopback bind by default, LAN bind by explicit `CMMS_HOST`.
