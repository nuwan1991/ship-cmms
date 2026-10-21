# SYNC_RULES

Design principle: **one writer per record + append-only events**. Concurrent edits to the same record are prevented by ownership rather than merged, so conflicts are rare and always visible.

## 1. Topology and transport

Hub-and-spoke (ARCHITECTURE). Installation kinds: `hub`, `command`, `ship`, `workshop`. Transports carrying the identical `SyncChange` envelope: HTTPS on LAN/WAN, and a signed bundle file (USB) for installations with no link. Replicas never sync directly with each other in R1. A workshop or command without a replica is a client of the hub.

## 2. Record classes — who may modify, how they sync, how conflicts resolve

| Class | Who may write | Flows | Conflict handling |
|---|---|---|---|
| `hub_reference` (commands, ships, assignments, departments, roles, parts catalogue, sequences, ranges, gate policy …) | Hub only. Replicas reject writes (`NOT_OWNER`) | hub → replicas by subscription | Hub wins. A replica row differing from hub at same version is overwritten and logged. |
| `owner_mutable` (positions, assets, defects, repair cases, work orders, plans, locations …) | Only `owner_installation_id` | owner → hub → subscribed replicas | Accept iff incoming `version` > local. Equal/lower version with different hash = fork → quarantine + `syn_conflict`; the owner's administrator resolves by writing a new version. |
| `event` (audit, approvals, stock transactions, readings, labour, movements, status events …) | Any installation appends; nobody edits | everywhere relevant | Union by `id`. Duplicate id + same hash = ignored. Same id + different hash = integrity quarantine. Corrections are compensating events. |
| `derived` | Local recomputation | never synced | Rebuilt after applying events; rebuildable at any time. |
| `local` (cursors, sessions, settings, import jobs) | Local | never synced | — |

Rules that follow:
- **Events record physical reality and are never rejected for state reasons.** An offline issue that drives a stock balance negative, or two receipts of the same part, are accepted and flagged as exceptions for review.
- **Tombstone, never delete.** Tombstones replicate; the owner's tombstone is final unless the owner writes a newer version.
- **Version, not clock, decides.** `occurred_at` is informational. Clock skew over 5 minutes between peers is reported in sync health.
- **Number ranges** are granted only by the hub and immutable. A replica consumes its own range locally and requests another at `RANGE_EXHAUSTED` or below the low-water mark (default 20%).
- **Split by writer** (DATA_DICTIONARY): requested, proposed, authorized and actual dates live in different records with different owners.

## 3. Ownership and handover

- A record is created by, and owned by, the installation where it was entered; `home_scope_id` says which unit it belongs to.
- Moving ownership (e.g. a work order created by a ship for a workshop replica to execute) is an explicit two-step `ownership.offer` → `ownership.accept` (events, `syn_ownership_transfer`). Until accepted the owner keeps writing. On acceptance the new owner writes new versions; the previous owner becomes read-only plus event-append (comments, approvals, readings).
- If the previous owner wrote after the accept took effect but before learning of it, those versions are quarantined as conflicts for the new owner to review.
- An asset's master record stays with its home installation when it is sent to a workshop; the workshop records custody and work as **events and its own work orders**.
- Ownership of a ship's records changes only through a hub-driven ship re-homing (M10), never implicitly by command re-attachment: **changing a ship's command attachment changes assignments (hub data), not record owners or asset identity.**

## 4. Provisioning and selective synchronization

- **Initial provisioning** (hub-initiated bundle or download): installation id and kind, trusted keys, schema versions, all `fleet` reference data, scoped data for the subscription, number ranges, and **selected users** (identity, role assignments, credentials only for users chosen for that installation).
- **Subscription** = set of scopes (ships, workshops, commands) plus fleet reference. A change is delivered when its `home_scope_id` is in the subscription, or it is explicitly shared (e.g. a work order whose executing party is that installation's workshop), or it is a required dependency.
- **Dependency closure**: before a change is applied, every `requires` entity it references must be present or included ahead of it in the same batch; otherwise it waits in quarantine as `DEPENDENCY_MISSING`.
- Subscriptions can shrink (data stays but is no longer updated and is marked stale) or grow (backfill).

## 5. Session protocol

1. `hello`: installation id, signature, per-module schema versions, push cursor, pull cursor. Hub replies with the last change it accepted from this origin (detects hub restore).
2. `push`: local-origin changes with `seq` above cursor, in batches (≤ 500 changes or 5 MB). Hub verifies signature, class/ownership rules, schema, dependencies; answers per `changeId`: `accepted | duplicate | rejected(code) | quarantined`.
3. `pull`: hub sends changes above the pull cursor filtered by subscription, parents first. Replica applies each batch in one transaction using the class rule, records it in `sys_change_log` with `received_from`, and recomputes derived tables.
4. Cursors advance only after commit; every step is resumable and idempotent (`changeId`).
5. Bundles: manifest (installation, cursors, schema versions, counts) + change lines + Ed25519 signature; import equals one push/pull session.
6. A change from a module schema newer than the receiver's is quarantined until upgrade; a change from a schema one step older is applied with column defaults. More than one step apart is refused.

## 6. Authority offline (REQ-5)

- **Lease.** Each installation holds an authority lease: `lease_expires_at = last_confirmed_hub_sync + lease_days` (default 30, configurable per installation, minimum 1). Users, role assignments and gate policies delivered at provisioning/sync are trusted until the lease expires. Individual role assignments may also carry `valid_until`.
- **After expiry (degraded mode)** each gate/permission class has an offline policy: `allow` (routine work-progress and data entry — default), `provisional` (reviews, approvals, return-to-service: allowed and stamped `confirmation_state = pending_confirmation`), `deny` (role/credential/grant administration and any gate configured `deny`). `AuthDecision.provisional` carries this to the audit envelope.
- **Clock safety.** The installation stores a monotonic high-water time; if the system clock is behind it, approvals are blocked until an administrator re-establishes the time and the event is audited.
- **Provisional items** are shown as "pending confirmation", and administrative closure requires all approvals on the case to be confirmed.
- **Revocations received late.** `idn_authority_revocation` carries `effective_at` (when authority was actually withdrawn) and `issued_at`. On receipt: (1) future actions are refused immediately; (2) history is never altered or deleted; (3) approvals/actions with `decided_at >= effective_at` are flagged `authority_disputed` and routed as a review task to the competent authority, who either ratifies (new approval event referencing the old) or requires rework; (4) earlier ones stand untouched. Deactivated users are handled the same way.
- **Credential/username changes** replicate hub-authoritatively as new credential versions and affect only future authentication. Approvals store `user_id` and an actor snapshot, so they remain valid and readable. A local administrator reset is allowed, is installation-scoped, is audited, and is superseded by the hub version at next sync.

## 7. Staleness and pending confirmation

Each installation records `last_sync_at` per scope. A scope is **stale** after a configurable age (default 7 days for ships, 2 days for workshops/commands). Every list/report over synchronized data returns `Freshness` (`asOf`, `stale`, `pendingOutbound`). The UI marks: locally written but unacknowledged changes ("pending upload"), provisional approvals and planning items awaiting ship confirmation ("pending confirmation"), and data from stale scopes. Reports always print `data as of` per scope.

## 8. Failure and recovery

- Never re-provision a replica that still has unsent changes: first export an emergency bundle of local-origin changes.
- Hub restored from an older backup: at `hello` the hub reports its last accepted seq per origin; replicas re-push everything above it. Number ranges are re-derived from replicas' reported maxima before any new grant.
- An installation can be decommissioned by the hub (`sys_installation.status`); its later changes are refused and reviewed manually.

## 9. Integrity

Per-change SHA-256 `payloadHash` over canonical JSON; Ed25519 installation signatures on pushes and bundles; replays harmless because of idempotency; the integrity query set (M14) checks dangling references, overlapping dated assignments and range overlaps.
