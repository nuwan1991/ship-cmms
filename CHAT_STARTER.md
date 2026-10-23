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

## M03 block (ready to paste)

```
You are implementing module M03 — Asset register, classifications, installations and transfers (prefix ast_, API /api/v1/assets).
M01 and M02 are done; do not modify them. M03 depends on M01 only through its index.ts and never imports M02 (use the Authorizer port).
Scope (R1): ast_classification (H), ast_position (O, owner = ship installation; functional tree system → equipment group →
equipment → maintainable component, per ship, with position_tag), ast_position_responsibility (O, dated responsible department),
ast_asset (O, owner = installation holding it; permanent asset_tag such as SLN-EQ-00000001 from a platform number range,
serial_number and manufacturer/model stored separately), ast_asset_movement (E: install, remove, custody transfer, status
change, each dated with position, org location and custody PartyRef), ast_asset_current (D, folded from movements).
Rules: asset id and asset_tag never change on transfer; position_tag, serial_number and asset_tag are three separate columns;
department responsibility, physical location (org_location) and command attachment are separate relationships; current state is
derived from events; offline tag issuance only from granted ranges (RANGE_EXHAUSTED when used up). Provide services, routes,
permissions ast.<noun>.<action>, entity registrations with the correct record classes, the public surface in MODULE_MAP
(getAsset, getPosition, currentInstallation, resolveTag), a view for M13, a demo seed that extends M01's, and web screens
(classifications, position tree per ship, asset list and detail with movement history, install/remove/transfer actions)
bound through web/src/modules.ts using the shared ResourceScreen.
```

## Smallest file set to attach for M03

Docs: `CHAT_STARTER.md`, `MODULE_MAP.md`, `CONTRACTS.md`, `SYNC_RULES.md` (§2–3), `DATA_DICTIONARY.md`, `BUILD_STATUS.md`, `DECISIONS.md` (D07, D19, D21–D28).
Server: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `src/main.ts`, `src/boot.ts`, `src/app.ts`, `src/modules/index.ts`, `src/platform/` (`records.ts`, `entity-registry.ts`, `ranges.ts`, `contracts.ts`, `errors.ts`, `ids.ts`, `time.ts`, `canonical.ts`, `authz.ts`, `ports.ts`, `events.ts`, `identity.ts`, `app-context.ts`, `modules.ts`, `config.ts`, `db/migrate.ts`, `db/open.ts`, `db/migrations/0001_core.sql`), the M01 pattern and surface (`src/modules/m01-organization/` `index.ts`, `actor.ts`, `permissions.ts`, `entities.ts`, `queries.ts`, `service.ts`, `routes.ts`, `schemas.ts`, `migrations/0001_organization.sql`), `test/helpers.ts`, `test/modules/org-helpers.ts`, `tools/check-boundaries.ts`.
Web: `web/package.json`, `web/package-lock.json`, `web/vite.config.ts`, `web/src/modules.ts`, `web/src/App.tsx`, `web/src/platform/` (`ResourceScreen.tsx`, `form.tsx`, `useList.ts`, `ui.tsx`, `api.ts`, `permissions.ts`, `nav.ts`, `i18n.ts`, `time.ts`), `web/src/modules/org/` (`index.tsx`, `resources.tsx`, `ResourceScreen.tsx`, `LocationsScreen.tsx` as the tree-screen pattern).
If the repository itself is available in the chat, attach nothing else.

## M04 block (ready to paste)

```
You are implementing module M04 — QR labels and compartment surveys (prefix qr_, API /api/v1/labels).
M01, M02 and M03 are done; do not modify them. M04 depends on M01 and M03 only through their index.ts.
Scope (R1): qr_label (O: label number from a platform range, optional asset link, state reserved/assigned/void), qr_label_print (E: print and
reprint log for A4 sheets), qr_survey_template (H: simple compartment forms), qr_survey and qr_survey_item (O: a survey session and observed
items, each either a scanned asset or a pending registration). Labels carry the asset tag, never replace it. Offline numbers only from granted
ranges. Provide services, routes, permissions qr.<noun>.<action>, entity registrations, tests, DATA_DICTIONARY and MODULE_MAP rows, and web
screens (label issue/assign/print, survey templates, run a survey and convert pending items to assets via M03) bound through web/src/modules.ts.
```

## Smallest file set to attach for M04

Docs: `CHAT_STARTER.md`, `MODULE_MAP.md`, `CONTRACTS.md`, `SYNC_RULES.md` (§2–3), `DATA_DICTIONARY.md`, `BUILD_STATUS.md`, `DECISIONS.md`.
Server: `package.json`, `src/modules/index.ts`, `src/platform/` (as for M03), `src/modules/m03-assets/index.ts`, `queries.ts`, `service.ts` (pattern), `test/modules/ast-helpers.ts`, `tools/check-boundaries.ts`.
Web: `web/src/modules.ts`, `web/src/platform/` (`ResourceScreen.tsx`, `form.tsx`, `useList.ts`, `ui.tsx`, `api.ts`, `permissions.ts`), `web/src/modules/ast/` (`binding.tsx`, `AssetsScreen.tsx`).
If the repository itself is available in the chat, attach nothing else.

## M01, M02 and M03 (done)

Delivered and recorded in BUILD_STATUS; their prompts are in git history.
