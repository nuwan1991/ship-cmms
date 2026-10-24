# DECISIONS

Format: **ID — decision.** Why. Consequence. Changing a decision means a new entry that supersedes it.

**D01 — TypeScript (strict, ESM) on Node 22 LTS with Fastify 5, Zod 4, Vitest.** One language for API, shared contracts and UI; strong typing for contracts across 14 modules; all open source, no paid service. Consequence: every module is TypeScript; contracts are Zod schemas.

**D02 — Modular monolith, one deployable per installation.** Ships and workshops need something one technician can install and back up. Module boundaries are enforced by `check-boundaries` instead of network boundaries. Consequence: no microservices unless a measured requirement appears.

**D03 — Hub-and-spoke sync, same envelope over HTTPS or signed bundle file.** Simple topology, one place for reference data and number ranges, works for ships that are completely disconnected. Consequence: no direct replica↔replica sync in R1; a hub outage blocks only synchronization and range top-ups, not local work.

**D04 — IDs are UUIDv7; readable tags and numbers are separate columns from hub-granted ranges.** Offline creation without collisions, permanent identity, time-ordered keys. Consequence: tag prefix/width are data (`sys_number_sequence`), initially `SLN-EQ` / 8 digits; ids are never displayed.

**D05 — Single writer per record (ownership) plus append-only event ledgers; no generic merge.** Merging free-form edits across disconnected installations is unsafe for maintenance records; ownership makes conflicts rare and reviewable. Consequence: tables are designed so each has one writer (split dates, split custody, events for history); handover is explicit (SYNC_RULES §3).

**D06 — State-based change log (full row snapshot per change), idempotent by `changeId`.** Simpler and safer to replay than deltas; payload hash detects divergence. Consequence: larger payloads; acceptable on LAN/USB, batches bounded.

**D07 — No database foreign keys on synced tables.** Selective sync, tombstones and out-of-order delivery make FKs unreliable. Integrity comes from services, `requires` dependency closure and the M14 integrity checks. Local tables may use FKs.

**D08 — Forward-only SQL migrations per module with checksums and sync macros.** Offline installations cannot run down-migrations reliably; macros make the sync contract impossible to forget; checksum blocks silent edits. Consequence: fixes are new migrations; backup precedes every upgrade.

**D09 — Authorization by port.** Modules ask `Authorizer`/`ApprovalPort` supplied by M02 at startup, so M01 can ship before M02 and no module imports identity. Production refuses to start with the placeholder authorizer; `CMMS_DEV_AUTH=1` allows an allow-all authorizer for development only.

**D10 — Four independent status axes** (progress, approval, return-to-service, closure) stored as events, current values derived. Matches the requirement that work, approval, return to service and administrative closure are different facts. No combined "status".

**D11 — Offline authority = lease from last confirmed hub sync (default 30 days) with per-class policy `allow | provisional | deny`; late revocations flag, never rewrite history.** Keeps ships working at sea while bounding risk (SYNC_RULES §6). Defaults are proposals to be confirmed (see open questions).

**D12 — Units and time.** UTC ISO-8601 ms for instants; local calendar dates for plans; display zone Asia/Colombo configurable; integers for quantity (milli), money (minor units) and run time (minutes).

**D13 — SQLite `synchronous=FULL` + WAL.** Ships lose power; committed work must survive. Slightly slower writes, irrelevant at this scale.

**D14 — SQLite, not PostgreSQL, per installation.** Zero administration, single file backup, enough for LAN department use with one writer process; embedded in the deployable. Revisit only if the hub outgrows it (measure first); the repository layer keeps SQL inside modules.

**D15 — UI is a React + Vite SPA under `web/`; exact versions pinned when first installed in M01.** Avoids pinning speculative versions now. Bundled assets only (no CDN) so it runs offline.

**D16 — Production run mode (compiled `dist` vs `tsx`) is decided in M14.** Sources are NodeNext-compatible with `.js` import specifiers so either works.

**D17 — Encryption at rest deferred to M14.** Initial position: OS-level disk encryption on hubs and replicas; evaluate SQLCipher only if policy requires database-level encryption.

**D18 — Workshops and commands without a replica are hub clients.** Avoids needless replicas; "independent replicas only where disconnected operation is required".

**D19 — Derived state is never synchronized.** Stock balances, current installation, due lists, operating state are recomputed locally from events, so replicas cannot disagree about arithmetic.

**D20 — Events are never rejected for state reasons, only flagged.** The physical world already happened (an item was issued, a reading taken); the system records it and raises an exception for review.

**D21 — Ship-to-command attachment is a dated, hub-written interval; reassignment never moves record ownership.** Intervals are half-open `[from, to)`, non-overlapping per ship (service rule plus DB trigger). `reassignShip` closes and opens in one transaction. Record owners are installations, not commands, so a ship changing command changes no `owner_installation_id`.

**D22 — Org reference data is hub-only; locations are owner-mutable per site.** Ships and workshops read reference data and enter locations only for the site their installation serves (`sys_installation.org_unit_id`); the hub may enter any. Changes to reference data from elsewhere are requests to the hub, not edits.

**D23 — Codes are unique among live rows only; removal is a tombstone with a reason.** Lets a retired code be reused while history keeps the old row; HTTP exposes `POST …/:id/tombstone`, never DELETE.

**D24 — Web UI is one Vite/React app in `web/`, composed in `web/src/modules.ts`.** Bundled assets only (no CDN or remote fonts), labels by key (`registerLabels`), nav filtered by `can()` (placeholder until M02), freshness banner on every synced list. Serving the built assets from the local server is an M14 deployment concern; development uses the Vite proxy to port 8080.

**D25 — Platform gets an `ApprovalPortRegistry` on `AppContext`; permissions are declared over the event bus.** M02 supplies the real `ApprovalPort` (consumers call `ctx.approvals.current()` at use time; a permissive stand-in is used until then). Modules that depend only on M01/M03.. cannot import M02, so they announce their permission codes by publishing `sys.permissions.declared` (`{codes: string[]}`) on `ctx.events`; M02 subscribes and merges them into its catalogue. Dedicated platform change made before M02 (MODULE_MAP rule 5).

**D26 — Entity definitions may list `redact` columns; the audit envelope masks them.** Audit rows replicate to every installation, so secrets (password hashes) must never be copied into `changes`. The sync payload still carries the real value, because credentials replicate only to installations the user is provisioned to (M10 filters). Platform change made before M02 used it.

**D27 — The generic list/edit screen lives in `web/src/platform/ResourceScreen.tsx`; each module binds it to its API base and permission prefix.** M02 needed the same screen M01 built. Moving it avoids copying it and avoids one module's UI importing another's. M01's `ResourceScreen` is now a thin binding; column renderers receive the loaded reference options.

**D28 — Web sign-in uses a bearer token kept per browser tab (sessionStorage with an in-memory copy).** The server stores only a hash of the token (12-hour sessions). A 401 on a signed-in call returns the shell to the sign-in screen. Effective permissions come from `/identity/me` and only decide what the UI shows; the server enforces every action. With `CMMS_DEV_AUTH=1` and no session the dev user is used and no sign-in is shown.

**D29 — Lockout counts failed sign-ins per username (5 in 10 minutes) from the audit trail.** Simple and offline-safe; it can lock a legitimate user out, so a hub administrator can reset the credential. Revisit with per-source throttling if abuse appears.

**D30 — Asset movements are events; "where is it now" is folded and rebuildable.** Install/remove/custody/status are appended to `ast_asset_movement`; `ast_asset_current` is folded in `(occurred_at, id)` order and never synced. Corrections are `void` events, never edits. A replicated install into an occupied position is accepted and shown in `ast_v_position_conflicts` (D20).

**D31 — M01 gains `findPartyByCode(kind, code)` in its public surface** so M03's demo seed can reference parties without reaching into M01 tables. Tag-number ranges are managed with the `asset-tags` CLI (`setup`, `grant`); the hub grants, installations consume.

**D32 — The tree helper moved to `web/src/platform/tree.ts`** (org re-exports it) so M03 reuses it without importing another module's UI.

**D33 — Labels carry the label number only; the equipment tag stays the identity.** `qr_label` links a label to an asset; replacing a damaged sticker voids the old label (reason required, number never reused) and assigns a new one. The QR payload is the label number, so reprinting can never change what a scan means. Label numbers use their own range (`label_no`, `SLN-LB`, 8 digits) and the `label-numbers` CLI, like asset tags (D31).

**D34 — A4 sheet printing is a recorded job plus a browser print.** `POST /labels/print` appends one `qr_label_print` event per label (first print, then reprints), and returns the sheet grid with inline SVG QR codes (pinned `qrcode` library, rendered at the server so it works from any installation). The web preview uses the browser print dialog; no PDF library is added.

**D35 — Survey conversion goes through M03, and M03 gains a small public surface.** M03 now exports `createAsset`, `findAssetByName` and the `AstActor` type; M01 exports `findLocationByCode`. Converting a pending survey item is one transaction: asset registration (tag from the asset range, registration movement), optional label assignment, item marked converted. If the range is exhausted nothing is written. Converted items and their surveys are kept.

**D36 — Work order status is four event streams; commands validate transitions, replicated events are only ordered.** Each axis change is a `wrk_status_event`; the current value is the latest event by `occurred_at` (then id) in `wrk_v_status_current`. Commands refuse impossible moves (for example closing before work is complete), but an event that arrives from another installation is stored and simply sorts by time (D20). Repair cases use the same events (progress and closure only).

**D37 — Gates go through the ApprovalPort; M05 never decides who may approve.** `wrk.work_order.approve` and `wrk.acceptance.accept` are both permission codes and gate codes. Starting work asks `evaluateGate`; deciding and accepting call `recordApproval`, which M02 checks against the user's authority (provisional after lease expiry) and records immutably. The status event only references the approval id and its provisional flag. With no gate policy (mode `none`) acceptance records no approval and needs only `wrk.acceptance.create`.

**D38 — Hand-over changes who executes, not who owns the record.** `wrk_handover` offer/accept/decline/withdraw are events; an accepted offer makes the receiving party the executing party in `wrk_v_work_order_overview`, and the receiving installation records its own labour, findings, tests, acceptance and status as events on the order. Moving the record's `owner_installation_id` is the sync layer's job (M10, SYNC_RULES §3). Recurring-fault detection is the view `wrk_v_recurring_faults` instead of the planned `wrk_recurrence` table.

**D39 — Stock is a ledger of events and balances are a view.** `stk_transaction` and `stk_reservation` are append-only, signed by `qty_delta`; `stk_v_balance` sums them, so on-hand can never drift from history and two installations posting offline cannot overwrite each other (unlike a stored balance). Commands refuse to overdraw locally; replicated events are only flagged (D20). The planned `stk_balance` table is the view. Consequence: a stock-take is an `adjustment` event with a reason, never an edit.

**D40 — M07 depends on M05 to issue parts against work orders.** The module map listed only M01 and M03. Issuing to a work order must check that the order exists, is not closed, and is on the same ship as the store; M05's public `getWorkOrder` does that, so M07 now depends on M01, M03 and M05 (still acyclic). M05 does not know about M07; screens that show a work order's parts read `GET /api/v1/stores/work-orders/:id/parts`. Issue cost is the latest receipt cost of the part, which is simple and explainable; weighted-average costing is a later option.

**D41 — Transfers are a document plus events on both sides.** Dispatch writes the owner-mutable `stk_transfer` and `transfer_out` events; arrival is a `transfer_in` event written by whoever holds the destination, so the receiving installation never needs to edit a record it does not own. State (`in_transit`/`received`/`cancelled`) is a view over these. Only the dispatching installation can call a transfer back, and only while in transit. Lines are one document with several parts, all-or-nothing; the web form currently dispatches one part per transfer. Transfer numbers come from the installation's own `transfer_no` range (`npm run store-numbers -- setup`).

**D42 — Excel templates are declared by the owning module, not stored.** A module registers an `ImportExportPort` (template code, columns with labels, required flags and hints, an `importRow` that calls its own command service, and `exportRows`) in `ctx.importExport`. M11 reads only that registry and imports no module, and a module can never be bypassed by a spreadsheet: permissions, workflow rules and audit are exactly those of the screens. The planned `xls_template` table is dropped; a template changes when the software is upgraded. The R1 templates are `locations` (M01), `assets` (M03) and `parts` (M07). Changes outside M11: `ports.ts` gained column metadata and `ImportExportRegistry`, `AppContext` gained `importExport`, and M01, M03 and M07 each gained an `import-export.ts`.

**D43 — An upload is a preview; saving is a separate, all-or-nothing step.** The whole file runs inside one rolled-back transaction, so the preview is the real outcome (later rows see earlier ones, such as a parent location defined above its children, and number ranges are not consumed). Commit re-applies the stored rows afresh in one transaction because data may have changed since the preview; by default one error aborts everything, or the user can choose to leave the failing rows out. Updates are by natural key (part number, location code within a site, equipment tag) and leave blank cells alone; unchanged rows are reported, not rewritten. Equipment is never given a typed-in new tag: new equipment gets its tag from the installation's own range, and a manufacturer plus serial number that already exists is reported as a possible duplicate of that tag.

**D44 — Files are read and written with a small OOXML layer over `fflate`.** `fflate` 0.8.2 (zero dependencies) does only zip; the workbook reader and writer are our own (`m11-excel/xlsx.ts`) and are checked against LibreOffice and openpyxl. The reader takes values only (a formula yields its cached value), caps entry and total sizes, and rejects anything that is not a plain workbook (no macros, no `.xls`). Excel turns text such as `00123` into the number 123 when it re-saves a CSV, so import converts numbers back to text and part numbers should be formatted as Text in the sheet. CSV export neutralises cells that start with `=`, `+`, `-` or `@`.

**D45 — Work-order generation is idempotent and never overlaps.** Each plan remembers `last_generated_key` (the due date, or the due hours rounded to 2 decimals). Running generation twice, or on the hub and a ship, cannot create the same cycle twice. A plan starts no new cycle while its previous order is open. Plans are created only through M05 `createWorkOrder`; M05 gained the read-only export `workOrderClosedAt`.

**D46 — The next cycle counts from completion.** When the previous order is closed, the anchor moves to the closure time (hours plans: the current meter total), so late work does not cause a catch-up burst.

**D47 — Meters keep a running total.** Each reading stores `cumulative`; replacing a dial adds a `replacement` event that carries the total on. Readings may not go backwards, back in time or into the future. An hours plan takes its baseline from the meter when it is created.

**D48 — Calibration is event-based.** The latest record per asset decides the due date. A failed record with no next date leaves nothing due, since the item must be dealt with, not scheduled.

**D49 — R1 limits.** Condition-based triggers are R2 (event `mon.condition.breached`). The task checklist is copied into the work order description because M05 job cards are not exposed to other modules.

**D50 — Installations authenticate to each other with signed envelopes.** Each installation has an Ed25519 key pair (`syn_local_key`). A message carries sender, time, path and body, signed over their canonical JSON; the hub verifies it against the key it stored at enrolment, and the replica verifies the hub's reply. The same envelope fields travel in a network exchange and in a bundle file. Replays are harmless because every change is applied by `changeId`.

**D51 — A replica joins with a one-time provisioning package.** The hub creates the installation record and a random secret (stored only as a hash). The package carries the installation id, the hub's public key, the scopes and the secret. At its first exchange the replica sends its own public key with the secret; the hub then activates it and forgets the secret. Provisioning packages are secrets: they are saved with owner-only permissions and shown to the person once.

**D52 — Selective sync keys on `home_scope_id`, with a central-data rule.** A replica receives fleet reference data, records whose `home_scope_id` is a subscribed scope, and (by default) hub-owned mutable records that have no scope. Events with no scope are not forwarded. Most modules do not yet set `home_scope_id` on everything they write, so records written without a scope stay at the installation that wrote them and the hub, and reach others only if the hub owns them. Modules should stamp the ship or site on what they create; this does not change the protocol. Growing a subscription raises an epoch, and the replica re-pulls from the start. Shrinking keeps what was sent and stops updates.

**D53 — Applying a change never throws for data reasons.** The outcome is applied, duplicate, rejected (wrong owner, bad hash, schema too old) or quarantined in `syn_conflict` (version fork, schema newer, unknown type, could not be saved). An older version arriving late is a duplicate. A hub-reference difference at the same version is overwritten by the hub copy and logged as resolved. The owner or hub resolves a fork by accepting the incoming version, keeping the local one, or dismissing it, and the decision is recorded. Quarantined changes that waited for an upgrade are retried on request.

**D54 — After sync, derived data is rebuilt through an event.** M10 publishes `sys.sync.applied` with the entity types it applied. M03 subscribes and folds the asset current-state table again when movements arrived. Other modules with derived tables do the same. This is a small addition to M03's `register()`.

**D55 — Not in this build of M10.** Ownership hand-over between installations (`syn_ownership_transfer`), ship re-homing, and the dependency closure that sends out-of-scope parents with a child. Records stay with the installation that created them. These are listed in BUILD_STATUS as the first things to add when a ship needs them.

**D56 — M13 reads only published views and keeps its own notifications locally.** Reports and the dashboard run SQL over `<prefix>_v_*` views; a test fails if M13 touches any other table. Notifications are raised by each installation from its own data, so they need no synchronization and cannot conflict. "Data as of" comes from the sync health view: the hub is never stale, any other installation is stale after 7 days (ships) or 2 days.

**D57 — Backups are consistent copies made while running, and are checked.** `VACUUM INTO` makes a consistent copy without stopping the application; the manifest holds the SHA-256; a verify step re-checks hash, SQLite integrity, identity and that the code knows every migration in it. Scheduled backups keep the newest 14 (configurable); manual, pre-upgrade and pre-restore backups are never removed automatically. Files are owner-readable only because they contain the signing key and password hashes. Encryption at rest stays with the operating system (D17).

**D58 — Every upgrade is preceded by a backup; a restore is a stopped-application command.** Starting the application (and `npm run migrate`) takes a `pre_upgrade` backup when migrations are pending and the database already has data. Restore refuses while the database is in use, refuses a backup from a different installation unless told it is replacement hardware, refuses a backup made by a newer version, and keeps the replaced database as a `pre_restore` backup. After a restore the next sync reconciles with the hub (SYNC_RULES §8).

**D59 — Production runs compiled code and serves the web app itself (resolves D16).** `npm run build:server` compiles to `dist/` and copies the SQL migrations beside it; `npm start` runs `node dist/main.js`. If `web/dist` exists the same process serves it (files inside that folder only, anything else falls back to the app page), so an installation is one program on one port with no CDN. `npm run ops -- check|setup|status|backup|verify|restore|integrity` is the installer and recovery tool.

**D61 — Credentials follow the user's provisioning, not the ship scope.** `EntityDef.audience` (platform) says a record follows an installation: `idn.user_installation` goes to the installation it names, and `idn.credential` goes to the installations its user is linked to. Without such a rule a record that is not scoped reaches nobody, so a credential cannot leave the hub by accident. When a new link appears, the hub raises the peer's epoch and the replica pulls again from the start, so a credential written before the link still arrives. Users, roles and assignments are fleet reference data. Un-linking a user does not remove an already delivered credential; revoke the account at the hub (M02) instead. This is a small addition to the platform entity type and to M02's registrations.

**D60 — M01 gains a view.** Migration `0002_assignment_overlap_view.sql` adds `org_v_assignment_overlap` for the M14 integrity checks (a ship attached to two commands at once, which replication could leave). No table or behaviour changed.


**D62 — Standard electrical classifications follow SWBS; legacy classifications are merged through a crosswalk, not rewritten.** M03 ships a standard catalogue (`catalogue/electrical.ts`) based on ESWBS (S9040) with IEC 60092 names, codes `SWBS-<group>[-<CLASS>]` and `CMP-EL-<CLASS>`, plus marked navy extensions for hybrid propulsion, energy storage, DC zonal power, HV shore connection, mission loads and unmanned systems. Codes are permanent; loading only adds. Legacy codes are related to standard classes in `ast_classification_map` (hub reference: `exact`/`broader` move records automatically, `narrower` needs a person, `related` is reference only). Each installation re-points only the positions and assets it owns, as audited updates; the hub then sets fully re-pointed legacy classes inactive, never removes them, so other modules' references stay valid. Imports translate mapped legacy codes. M03 schema version 2: every installation is upgraded before the mapping is used. Plan and phases: CLASSIFICATION_MERGE.md.

**D63 — A physical move inside a site is a status change that keeps the status.** Location is recorded on movements (`location_id`) and kept until a later movement gives another. To record a move with no change of position, custody or status (engine room to store), a `status_change` may repeat the current status when it brings a new location; a status change that changes neither is still refused. No new movement kind, so no migration and no schema change for replicas. The web screen offers it as *Move to another location*; the asset list can be filtered by location.

**D64 — Part compatibility and PM task templates follow the classification crosswalk.** M07 `partsForAsset` and M06 `templatesForAsset` (new export, also `GET /api/v1/pm/assets/:id/task-templates`) treat a compatibility row or template as matching an asset when its classification is the asset's class, or when M03 `standardEquivalent` (a 1:1 `exact`/`broader` mapping) of its classification is the asset's class. So rows linked to a legacy class keep matching assets re-pointed to the standard class, and the hand re-linking step of the merge is not needed. Both modules use only M03's `index.ts` (declared dependency); no table or other module changed. The match is one way and one step: a split (`narrower`) legacy class matches nothing new, and an asset still on a legacy class does not pick up rows linked to its standard class until it is re-pointed. M05 `advisoriesForAsset` still matches the exact class only, so advisories remain a hand re-link step (CLASSIFICATION_MERGE.md phase 3) until M05 does the same.



## Open questions for the project owner (defaults used until answered)

1. Confirm `SLN-EQ` as the equipment tag prefix and 8-digit width (assumed).
2. Offline lease length (assumed 30 days) and which gates must be `deny` or `provisional` after expiry.
3. Which commands/workshops need their own replica versus using the hub.
4. UI languages required (English assumed; keys allow Sinhala/Tamil later).
5. Security classification and network policy (affects D17, hosting of the hub, bundle handling).
6. Stale thresholds (assumed 7 days ships, 2 days workshops/commands).
