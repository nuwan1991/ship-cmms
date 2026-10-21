# CHAT_STARTER

Start every module in a **new chat**. Attach the files listed for that module (the repo, or the minimal set below), then paste the block.

## Generic block

```
You are implementing module <ID> — <NAME> of the Ship & Fleet CMMS.

Read first: CHAT_STARTER.md (this), MODULE_MAP.md, CONTRACTS.md, the <ID> section of DATA_DICTIONARY.md.
Do not re-derive architecture. Obey MODULE_MAP rules: you may edit only src/modules/<dir>/**, your migrations,
your row in MODULE_MAP.md and DATA_DICTIONARY.md, one line in src/modules/index.ts, web/ screens for your module,
tests, and BUILD_STATUS.md. Do not modify src/platform/**, CONTRACTS.md or SYNC_RULES.md; if you need a change,
stop and propose it with a DECISIONS entry instead.

Rules: all synced writes through platform/records.ts; permissions via the Authorizer port; no cross-module table
access; entities registered in the entity registry with the record class from DATA_DICTIONARY; migrations use the
sync macros; exact-pinned dependencies only; UTC storage; errors via AppError.

Definition of done: migrations + services + routes + entity registration + tests (including ownership, version
conflict, permission denial, and the module's own business rules) ; `npm run verify` green; DATA_DICTIONARY and
MODULE_MAP rows finalized; BUILD_STATUS updated. Keep output minimal; do not restate the spec.
Stop when done and list the smallest file set needed for the next module.
```

## M01 block (ready to paste)

```
You are implementing module M01 — Organizations, ships, commands and locations (prefix org_, API /api/v1/org).
Scope (R1): tables org_fleet, org_command, org_ship, org_ship_command_assignment (dated, non-overlapping per ship),
org_department, org_workshop, org_external_provider (all hub_reference) and org_location (owner_mutable, tree per
ship/site, owner = installation that holds the site). Command count is data, not code (seven initially, configurable).
Provide: services with business rules (assignment overlap rejected; effective-dated lookup getShipCommandAt;
reassigning a ship never changes record owners); routes; permissions org.<resource>.<action> registered; view
org_v_ship_current_command; index.ts public surface per MODULE_MAP; PartyRef resolution helper; seed command for a
demo dataset (not production data). Then scaffold web/ (React + Vite, versions pinned at install, bundled assets)
with the shell, nav registry fed by NavItem, freshness banner placeholder, and org screens (list/create/edit/assign).
No authentication logic: use the Authorizer port (CMMS_DEV_AUTH=1 in development).
```

## Smallest file set to attach for M01

Docs: `CHAT_STARTER.md`, `MODULE_MAP.md`, `CONTRACTS.md`, `DATA_DICTIONARY.md`, `BUILD_STATUS.md`.
Code: `package.json`, `package-lock.json`, `tsconfig.json`, `src/main.ts`, `src/boot.ts`, `src/app.ts`, `src/modules/index.ts`, and `src/platform/` (`records.ts`, `entity-registry.ts`, `contracts.ts`, `authz.ts`, `ports.ts`, `errors.ts`, `ids.ts`, `time.ts`, `modules.ts`, `app-context.ts`, `identity.ts`, `canonical.ts`, `db/migrate.ts`, `db/open.ts`, `db/migrations/0001_core.sql`), plus `test/helpers.ts` and `tools/check-boundaries.ts`.
If the repository itself is available in the chat, attach nothing else: the docs above are the only ones M01 must read.
