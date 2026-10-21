# CONTRACTS

Executable definitions live in `src/platform/` (named per section). This file states the rules; if code and this file disagree, fix one in the same change and add a DECISIONS entry.

## 1. Identity and naming

- Every record `id` is a **UUIDv7** (`ids.ts`), generated locally, never reused. IDs are internal and never shown to users.
- Readable numbers (equipment tag `SLN-EQ-00000001`, QR label number, job number) come from **number sequences/ranges** (`ranges.ts`), stored in separate columns (`asset_tag`, `serial_number`, `position_tag`, `label_number`…). Prefix and width are hub-configured data, not code.
- Users are referenced by immutable `user_id`, never by username.
- Tables `<prefix>_<singular_noun>` snake_case; columns snake_case; booleans `is_*`; JSON text columns `*_json`; foreign-key-like columns `<noun>_id`; entity types `<prefix>.<noun>` (e.g. `org.ship`); permissions `<prefix>.<resource>.<action>`; HTTP JSON camelCase (`toCamel`/`toSnake`).

## 2. Standard record columns and classes

Macros in migrations inject these (`db/migrate.ts`):

| Record class | Columns | Who writes | Trigger guards |
|---|---|---|---|
| `hub_reference`, `owner_mutable` (`{{SYNC_COLUMNS}}`) | `id, version, owner_installation_id, home_scope_id, created_at/by/installation_id, updated_at/by, deleted_at/by` | hub only / owner installation only | no DELETE (tombstone) |
| `event` (`{{EVENT_COLUMNS}}`) | `id, owner_installation_id, home_scope_id, occurred_at, recorded_at, recorded_by` | any installation appends; never changes | no UPDATE, no DELETE |
| `derived`, `local` | none required | local only; never synced | — |

`home_scope_id` = the ship/workshop/command org unit the record belongs to (NULL = fleet-wide). `occurred_at` is when it really happened; `recorded_at` when it was entered. Corrections are new events referencing the original. Semantics of classes: SYNC_RULES §2.

All mutations of synced tables use `createRecord / updateRecord / tombstoneRecord / appendEvent` (`records.ts`).

## 3. Audit envelope (`contracts.ts: AuditEvent`, table `sys_audit_event`)

One append-only row per business action, written by the same transaction: who (`actor_user_id` + `actor_snapshot` of name/rank/number at that time), what (`action`, entity type/id/version, field `changes`), when (`occurred_at` vs `recorded_at`), where (`owner_installation_id`), why (`reason`), under what authority (`authority_basis`: role assignment or offline grant), and `outcome` (`success|denied|failed`). Denials and failed logins are audited with `writeAudit`. Audit rows replicate like events.

## 4. Sync change and operations (`contracts.ts: SyncChange`)

State-based change entry: `{changeId, originInstallationId, entityType, entityId, op: upsert|tombstone|event, version, ownerInstallationId, homeScopeId, occurredAt, schemaVersion, payload(full row), payloadHash}`; idempotent by `changeId`. Operations (protocol in SYNC_RULES §5): `hello`, `push`, `pull`, `ack`, `provision`, `range.request`, `ownership.offer|accept|reject`, `authority.revocation`, `bundle.export|import`.

## 5. Time, units, money

- Stored instants: UTC ISO-8601 with ms and `Z` (`time.ts`). Display zone configurable, default `Asia/Colombo`. Planning dates are local calendar dates `YYYY-MM-DD`.
- Dated relationships (assignments, responsibilities) use `effective_from` / `effective_to` (UTC instants, `effective_to` NULL = current); they never overlap per subject.
- Integers only: quantity `*_milli` + `uom`; money `*_minor` + `currency` (default LKR); running time `*_minutes`. Other measurements: REAL + `unit` code (SI/UCUM codes).

## 6. Errors (`errors.ts`)

Envelope: `{ "error": { "code", "message", "details?", "correlationId" } }`. Codes → HTTP: `VALIDATION_FAILED` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `AUTHORITY_EXPIRED` 403, `NOT_FOUND` 404, `VERSION_CONFLICT` 409, `DUPLICATE` 409, `NOT_OWNER` 409, `RANGE_EXHAUSTED` 409, `WORKFLOW_BLOCKED` 422, `DEPENDENCY_MISSING` 422, `SYNC_REJECTED` 422, `INTERNAL` 500. Services throw `AppError`; unexpected errors never leak details. `x-correlation-id` is accepted and always echoed.

## 7. Authorization, approvals, status axes

- Modules call `requirePermission(authorizer, principal, permission, scope)` (`authz.ts`). Roles are never tested in module code. The `AuthDecision` carries `basis` (written to audit) and `provisional` (authority lease expired, SYNC_RULES §6).
- **Gates** are configured per gate code (`<prefix>.<noun>.<gate>`) with mode `mandatory_prior | review_pending_allowed | none` and an offline policy. Modules ask `ApprovalPort.evaluateGate`; they do not hard-code approval rules.
- **Approvals** are immutable events keyed by `user_id` with actor snapshot, actual `decided_at`, `recorded_at` and installation. Username/password changes never touch them. Later revocations flag, never delete (SYNC_RULES §6).
- **Four independent status axes** on repair cases and work orders (`STATUS_AXES`): `progress`, `approval`, `returnToService`, `closure`. Each transition is a `wrk_status_event`; the current value is derived. No combined status field.

## 8. Extension ports (`ports.ts`, `authz.ts`, `entity-registry.ts`, `events.ts`)

Entity registry (record class, `requires`, distribution) · `Authorizer` · `ApprovalPort` · `ImportExportPort` · read-model views `<prefix>_v_*` · `NavItem` · `EventBus` (post-commit, failure-isolated; event types `<prefix>.<noun>.<past_verb>`). Modules register at startup via `register(ctx, app)` in `src/modules/index.ts`.

## 9. HTTP API

`/api/v1/<module-area>/<kebab-plural>`; JSON camelCase; every record response includes `id`, `version`, `updatedAt`. Updates send `expectedVersion`; mismatch → `VERSION_CONFLICT` with `currentVersion`. Offline-capable clients may send `Idempotency-Key` on creates (replayed key returns the original result). Lists use cursor pagination (`limit`, `cursor`) and, where data is synchronized, include `freshness: Freshness[]` (`contracts.ts`). Deletion is `POST …/:id/tombstone` with `reason`, never HTTP DELETE.

## 10. UI

Single shell; nav from `NavItem`s filtered by permission; freshness banner per scope; four status axes shown as separate chips; conflict dialog on `VERSION_CONFLICT`; all text via `labelKey`; local-time display only; Excel/print features reuse the same permission checks as the screens.
