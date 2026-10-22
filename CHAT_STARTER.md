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

## M02 block (ready to paste)

```
You are implementing module M02 — Identity, roles, permissions and offline authority (prefix idn_, API /api/v1/identity).
M01 is done; do not modify it. M02 depends on M01 only through its index.ts.
Scope (R1): tables idn_user, idn_credential (username + scrypt hash + credential version), idn_user_installation (lease expiry),
idn_role, idn_role_permission, idn_role_assignment (dated, scoped, optional valid_until), idn_offline_grant, idn_gate_policy,
idn_approval (event), idn_authority_revocation (event, effective_at vs received_at), idn_session (local).
Provide: the real Authorizer and ApprovalPort registered at startup (replacing CMMS_DEV_AUTH); an authentication hook that sets
req.principal; login/logout/session routes; effective-permission endpoint for the web shell; permission catalogue seeded from each
module's exported permission list (ORG_PERMISSIONS today); gate policy modes mandatory_prior | review_pending_allowed | none with
offline policy allow | provisional | deny; offline lease expiry and late-revocation handling exactly as SYNC_RULES §6 (flag, never
rewrite history); approvals keyed by user_id with actor snapshot, actual decided_at and recorded_at, unaffected by username or
password changes. Then replace web/src/platform/permissions.ts with the real call and add login and admin screens (users, roles,
assignments) via web/src/modules.ts.
Hash passwords with node:crypto scrypt (no new native dependency). Stay inside M02's directory, migrations and docs rows.
```

## Smallest file set to attach for M02

Docs: `CHAT_STARTER.md`, `MODULE_MAP.md`, `CONTRACTS.md`, `SYNC_RULES.md` (§6 offline authority), `DATA_DICTIONARY.md`, `BUILD_STATUS.md`, `DECISIONS.md` (D11, D21–D24).
Server: `package.json`, `package-lock.json`, `tsconfig.json`, `src/main.ts`, `src/boot.ts`, `src/app.ts`, `src/modules/index.ts`, `src/platform/` (`authz.ts`, `ports.ts`, `contracts.ts`, `records.ts`, `entity-registry.ts`, `errors.ts`, `ids.ts`, `time.ts`, `canonical.ts`, `identity.ts`, `app-context.ts`, `modules.ts`, `config.ts`, `db/migrate.ts`, `db/open.ts`, `db/migrations/0001_core.sql`), M01 pattern and surface (`src/modules/m01-organization/index.ts`, `permissions.ts`, `actor.ts`, `entities.ts`), `test/helpers.ts`, `test/modules/org-helpers.ts`, `tools/check-boundaries.ts`.
Web: `web/package.json`, `web/package-lock.json`, `web/src/modules.ts`, `web/src/App.tsx`, `web/src/platform/` (`permissions.ts`, `api.ts`, `nav.ts`, `system.tsx`, `i18n.ts`, `ui.tsx`, `form.tsx`, `useList.ts`), `web/src/modules/org/index.tsx` (pattern).
If the repository itself is available in the chat, attach nothing else.

## M01 (done)

Delivered and recorded in BUILD_STATUS. Its prompt is kept in git history (commit "M01") rather than here.
