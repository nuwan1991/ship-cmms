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

## M05 block (ready to paste)

```
You are implementing module M05 — Defects, repair cases, work orders, job cards, reviews and repair acceptance (prefix wrk_, API /api/v1/work).
M01, M02, M03 and M04 are done; do not modify them (small additions to a done module's index.ts need a DECISIONS entry). M05 depends on M01 and M03 only
through their index.ts, and never imports M02 (use the Authorizer and ApprovalPort).
Scope (R1): wrk_defect (O), wrk_repair_case (O, parent that may span departments/providers), wrk_work_order (O; ownership moves by handover; separate
ownership/operating/executing PartyRefs), wrk_job_card (O), wrk_status_event (E, four independent status axes), wrk_labour_entry / wrk_finding /
wrk_test_record (E), wrk_acceptance (E, return-to-service evidence), wrk_handover (E, offer/accept), wrk_advisory (H), wrk_recurrence (D).
Rules: current status is derived from events; a work order is numbered from a platform range (works offline); acceptance and review gates are approvals via
ctx.approvals; replicated events are never rejected (D20); every write goes through platform/records.ts. Provide services, routes, permissions
wrk.<noun>.<action>, entity registrations, public surface per MODULE_MAP (WorkOrderRef, createWorkOrder), a view for M13, demo seed extension, tests, and web
screens (defect list/report, work order list/detail with status axes, job card, handover, acceptance) bound through web/src/modules.ts.
```

## Smallest file set to attach for M05

Docs: `CHAT_STARTER.md`, `MODULE_MAP.md`, `CONTRACTS.md`, `SYNC_RULES.md` (§2–3), `DATA_DICTIONARY.md`, `BUILD_STATUS.md`, `DECISIONS.md` (D07, D19–D25, D30–D35).
Server: `package.json`, `src/modules/index.ts`, `src/platform/` (as for M03), `src/modules/m03-assets/index.ts` and `queries.ts`, the M04 `service.ts` and `routes.ts` as the newest pattern, `test/modules/qr-helpers.ts`, `tools/check-boundaries.ts`.
Web: `web/src/modules.ts`, `web/src/platform/` (`ResourceScreen.tsx`, `form.tsx`, `useList.ts`, `ui.tsx`, `api.ts`, `permissions.ts`), `web/src/modules/qr/` (`SurveysScreen.tsx` as the list-plus-detail pattern).
If the repository itself is available in the chat, attach nothing else.

## M06 block (ready to paste)

```
You are implementing module M06 — Planned maintenance, meters and calibration (prefix pm_, API /api/v1/pm).
M01 to M05 are done; do not modify them (a small addition to a done module's index.ts needs a DECISIONS entry). M06 depends on M01, M03 and M05 only
through their index.ts, and never imports M02 (use the Authorizer and ApprovalPort).
Scope (R1): pm_task_template (H, standard PM tasks with checklist and estimated time), pm_plan (O, calendar and running-hour schedules per asset or position; condition-based is R2),
pm_meter (O, running-hour or counter meter per asset), pm_meter_reading (E, reading with source time; readings from other installations are never rejected, D20),
pm_calibration_record (E, result and next due date), pm_due (D, computed due list as a view pm_v_due for M13).
Rules: generate preventive work orders only through M05's createWorkOrder (work_type preventive) and never write wrk_ tables; a plan keeps the last generated order so the same
due date is not generated twice; running hours are derived from meter readings (latest by time, with rollover/replacement handled explicitly); offline generation uses the
installation's own work-order range; every write goes through platform/records.ts. Provide services, routes, permissions pm.<noun>.<action>, entity registrations, public
surface per MODULE_MAP, a view for M13, demo seed extension, tests, and web screens (plans, meters and readings, calibration, due list with Generate work order)
bound through web/src/modules.ts.
```

## Smallest file set to attach for M06

Docs: `CHAT_STARTER.md`, `MODULE_MAP.md`, `CONTRACTS.md`, `SYNC_RULES.md` (§2–3), `DATA_DICTIONARY.md`, `BUILD_STATUS.md`, `DECISIONS.md` (D07, D19–D25, D30–D38).
Server: `package.json`, `src/modules/index.ts`, `src/platform/` (as for M03), `src/modules/m05-work/index.ts`, `queries.ts`, `service.ts` (createWorkOrder) and `schemas.ts`, `src/modules/m03-assets/index.ts`, `test/modules/wrk-helpers.ts`, `tools/check-boundaries.ts`.
Web: `web/src/modules.ts`, `web/src/platform/` (`ResourceScreen.tsx`, `form.tsx`, `useList.ts`, `ui.tsx`, `api.ts`, `permissions.ts`), `web/src/modules/wrk/` (`WorkOrdersScreen.tsx`, `DefectsScreen.tsx` as list patterns).
If the repository itself is available in the chat, attach nothing else.

## M01 to M07 and M11 (done)

Delivered and recorded in BUILD_STATUS; their prompts are in git history.
