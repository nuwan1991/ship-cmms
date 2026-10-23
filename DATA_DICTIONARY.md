# DATA_DICTIONARY

Classes: **H** hub_reference (hub writes) · **O** owner_mutable (owner installation writes) · **E** event (append-only) · **D** derived (rebuilt locally, never synced) · **L** local (never synced). Each table belongs to exactly one module (its prefix). Tables marked *planned* are the intended scope; the owning module's chat finalizes columns and updates this file.

## Cross-cutting rules

- No database foreign keys on synced tables; integrity is enforced by services and the sync dependency closure (`requires`), and checked by an integrity query set in M14.
- **Separate relationships** (never one field): command attachment → `org_ship_command_assignment` (dated); department responsibility → `ast_position_responsibility` (dated); physical location → `org_location` + `location_id` on `ast_asset_movement`; custody → `ast_asset_movement`. On repair work, `ownership_party`, `operating_party` and `executing_party` are three separate `PartyRef` column pairs (`*_kind`, `*_id`).
- **Position ≠ asset.** The functional tree of **positions** (system → equipment group → equipment → component) belongs to a ship; physical **assets** are installed into positions over time. Transfers move the asset between positions/custodians; the asset's `id` and `asset_tag` never change.
- **Split by writer.** Where two parties write about one thing, use separate tables so each has one writer (e.g. requested vs proposed vs authorized vs actual dates).
- **Current state is derived** from events (current installation, stock balance, status axes, operating state).

## Platform (`sys_`) — implemented in migration `0001_core`

| Table | Class | Purpose |
|---|---|---|
| sys_local_identity | L | This installation's id, kind, code, name (one row) |
| sys_installation | H | All installations in the fleet |
| sys_audit_event | E | Audit envelope |
| sys_change_log | L | Local ledger of locally written and received changes; sync cursor |
| sys_number_sequence | H | Sequence definitions (code, prefix, width) |
| sys_number_range | H | Non-overlapping granted ranges (DB trigger rejects overlap) |
| sys_number_cursor | L | Consumption position inside each granted range |
| sys_setting | L | Installation settings (display zone, thresholds) |
| sys_schema_migration | L | Applied migrations with checksums (created by the runner) |

## M01 `org_` — implemented in migration `m01-organization/0001_organization`

All rows carry the standard sync columns (CONTRACTS §2). No foreign keys; services validate references. Codes are unique among live rows (a tombstoned code can be reused). Permissions: `org.<noun>.<view|create|update|remove>` for each noun below (`ORG_PERMISSIONS`).

| Table | Class | Key columns | Rules |
|---|---|---|---|
| org_fleet | H | code, name | Single live row |
| org_command | H | code, name, short_name, sort_order, status | Count is data (seven initially); cannot be deactivated or removed while it has current/future ship assignments or workshops |
| org_ship | H | fleet_id, code, name, pennant_no, ship_class, ship_type, status (`active|laid_up|decommissioned`) | `fleet_id` defaults to the single fleet; cannot be removed while it has locations, an onboard workshop or current/future assignments |
| org_ship_command_assignment | H | ship_id, command_id, effective_from, effective_to (NULL = open), reason | Half-open `[from, to)`; live rows of one ship never overlap (service check + DB trigger); inactive commands cannot receive ships |
| org_department | H | code, name, sort_order, status | Disciplines; responsibility itself lives in M03 |
| org_workshop | H | code, name, kind (`onboard|command|specialist`), command_id, ship_id, has_replica, status | onboard ⇒ ship_id only; command ⇒ command_id only; specialist ⇒ neither (serves any command by capability, M08) |
| org_external_provider | H | code, name, contact_*, notes, status | Executing party only; no site |
| org_location | O | site_kind (`ship|workshop`), home_scope_id (= site id), parent_id, code, name, kind, sort_order, status | Tree per site, depth ≤ `LOCATION_MAX_DEPTH`; parent in same site; no cycles; code unique per parent; owner = installation that entered it; ship/workshop installations enter only their own site |

Published read model: **`org_v_ship_current_command`** (ship + command attached now). Service operation `reassignShip` closes the assignment in force and opens the next atomically; it changes no ship, location or asset owner.

## M02 `idn_` — implemented in migration `m02-identity/0001_identity`

Permissions: `idn.<noun>.<view|create|update|remove>` for user, credential, user_installation, role, role_permission, role_assignment, offline_grant, gate_policy, approval, revocation, plus `idn.credential.reset_local` and `idn.clock.reset`. Roles hold exact codes, `<prefix>.*` or `*`. Hub-written classes are changed at the hub only; revocations and approvals may be recorded at any installation.

| Table | Class | Key columns | Rules |
|---|---|---|---|
| idn_user | H | display_name, rank, service_number, status | Person identity; no credentials. Approvals reference `user_id`, never the name |
| idn_credential | H | user_id, username, password_hash (scrypt, redacted from audit), credential_version | One live credential per user; username unique; a new version ends that user's sessions and affects only future sign-in |
| idn_user_installation | H | user_id, installation_id, lease_expires_at | Which users are provisioned where (credentials replicate only there, M10) |
| idn_role / idn_role_permission | H | code, name, status / role_id, permission | Permission list replaced as a set (`PUT /roles/:id/permissions`) |
| idn_role_assignment | H | user_id, role_id, scope_kind, scope_id, valid_from, valid_until | Scoped and dated; `valid_until` ends authority even offline |
| idn_offline_grant | H | installation_id?, role_id?, lease_days (1–365) | Overrides the default 30-day lease (most specific wins) |
| idn_gate_policy | H | gate_code, mode, offline_policy (`allow|provisional|deny`) | `mandatory_prior | review_pending_allowed | none`; row overrides the default offline policy for that code |
| idn_approval | E | gate_code, subject_type/id, decision (`approved|rejected|ratified`), actor_user_id, actor_snapshot, authority_basis, confirmation_state, ratifies_approval_id | Immutable; `occurred_at` = actual decision time, `recorded_at` = entry time |
| idn_authority_revocation | E | user_id, role_assignment_id?, kind (`revoke|reinstate`), effective_at, issued_at, reason | `effective_at` (when authority really ended) ≠ `issued_at`; history never rewritten |
| idn_session | L | token_hash, user_id, expires_at, revoked_at | 12-hour sessions; only a hash of the token is stored |
| idn_local_password | L | user_id, password_hash, set_by, set_at | Installation-scoped administrator reset; superseded by a newer hub credential |

Published read model: **`idn_v_approval_status`** (per approval: `pending_confirmation`, `authority_disputed`, `needs_review`, `ratified`). A different authority clears a flag with a `ratified` approval event. Local settings keep the last hub sync time and a monotonic clock high-water mark.

## M03 `ast_`

| Table | Class | Key columns / rules |
|---|---|---|
| ast_classification | H | code (unique), name, kind (`equipment`/`component`), parent_id, description, status |
| ast_position | O (owner = ship installation) | ship (home scope), position_tag (unique per ship), name, level (system → equipment_group → equipment → component), parent_id, classification_id, sort_order, status |
| ast_position_responsibility | O | position_id, department_id, effective_from/to (half-open); a trigger rejects overlapping intervals for one position |
| ast_asset | O (owner = installation that registered it) | asset_tag (permanent, `SLN-EQ-########` from range `equipment_tag`; a trigger blocks changes), serial_number, manufacturer, model (separate columns), classification_id, home ship (home scope), notes |
| ast_asset_movement | E | asset_id, kind (`register`/`install`/`remove`/`custody_transfer`/`status_change`/`void`), position_id, location_id, custody party (kind+id), asset_status (`in_service`/`in_store`/`under_repair`/`out_of_service`/`condemned`), note, corrects_movement_id; occurred_at is when it happened |
| ast_asset_current | D | folded by `(occurred_at, id)`, rebuildable (`rebuildAssetCurrent`): position, location, custody, status, installed_since |

Views: **`ast_v_asset_overview`** (asset + current state + position + classification, for lists and M13) and **`ast_v_position_conflicts`** (positions holding more than one asset after replication; flagged, never rejected, D20). Corrections are `void` movements. Equipment tags come from locally consumed ranges and raise RANGE_EXHAUSTED when used up.

## M04 `qr_`

| Table | Class | Key columns / rules |
|---|---|---|
| qr_label | O | label_no (unique, never reused; `SLN-LB-########` from range `label_no`), state (`reserved`/`assigned`/`void`), asset_id, assigned_at, void_reason, note; one assigned label per asset (partial unique index); home scope = ship it was issued for, or none |
| qr_label_print | E | label_id, print_job_id, reason (`first`/`reprint`), note; one row per label per print job |
| qr_survey_template | H | code (unique), name, description, items_json (`[{key,label,kind: text/yesno/number}]`), status |
| qr_survey | O | location_id (org_location compartment), template_id, status (`open`/`closed`), started_at, closed_at, note; home scope = the site; one open survey per compartment |
| qr_survey_item | O | survey_id, kind (`scanned`/`pending`), asset_id, label_no, observed_status, description/manufacturer/model/serial_number (pending), answers_json, note, converted_asset_id, converted_at; one scanned row per asset per survey |

View: **`qr_v_survey_summary`** (per survey: item, scanned, pending and converted counts; for lists and M13). The QR code carries the label number only; the equipment tag is shown beside it and is never replaced. A voided label keeps its number and still resolves, as `void`, so a stale sticker is recognised. Pending items are converted into assets through M03 (`createAsset`), in one transaction with the optional label assignment.

## M05 `wrk_`

| Table | Class | Key columns / rules |
|---|---|---|
| wrk_defect | O | defect_no (`SLN-DF-########`, range `defect_no`), title, description, severity (`minor`/`major`/`critical`), asset_id, position_id, status (`open`/`converted`/`dismissed`), repair_case_id, reported_at, dismiss_reason; home scope = ship |
| wrk_repair_case | O | case_no (`SLN-RC-…`), title, description, asset_id, position_id, priority, opened_at |
| wrk_work_order | O | wo_no (`SLN-WO-…`), repair_case_id, title, work_type (`corrective`/`preventive`/`inspection`/`modification`), priority, asset_id, position_id, operating party (kind+id), executing party (kind+id), requested_due (local date). The owner is the installation that entered it |
| wrk_job_card | O | work_order_id, seq, title, instructions, checklist_json (`[{text,done}]`), status (`draft`/`issued`/`completed`/`void`), completed_at |
| wrk_status_event | E | subject_type (`repair_case`/`work_order`), subject_id, axis (`progress`/`approval`/`return_to_service`/`closure`), value, note, approval_id, provisional |
| wrk_labour_entry | E | work_order_id, worker_name, trade, minutes (1–1440), note |
| wrk_finding | E | work_order_id, kind (`observation`/`cause`/`recommendation`/`additional_defect`), text |
| wrk_test_record | E | work_order_id, test_name, result (`pass`/`fail`/`not_applicable`), measured_value, note |
| wrk_acceptance | E | work_order_id, decision (`accepted`/`rejected`), return_to_service, restrictions, remarks, approval_id, provisional |
| wrk_handover | E | work_order_id, kind (`offer`/`accept`/`decline`/`withdraw`), offer_id, to party (kind+id), note |
| wrk_advisory | H | code (unique), title, body, severity, classification_id, status, issued_at |

Views (derived, never synchronized): **`wrk_v_status_current`** (latest value per subject and axis, ordered by `occurred_at` then id), **`wrk_v_handover_state`** (each offer: pending/accepted/declined/withdrawn), **`wrk_v_work_order_overview`** (one row per work order with the four axes, effective executing party, labour minutes, hand-over pending; for lists and M13) and **`wrk_v_recurring_faults`** (assets with 3 or more defects or standalone corrective orders in 90 days; `wrk_recurrence` from the plan is a view, so it cannot go stale).

Axes and rules: progress `planned → in_progress ⇄ on_hold → work_complete`; approval `not_required → pending_review → approved/rejected`; return to service `not_assessed → restricted/cleared/withheld`; closure `open → closed ⇄ reopened`. Starting work is blocked by a `mandatory_prior` approval gate until approved; `review_pending_allowed` lets work start with the review pending. Closing needs work complete, no review pending or rejected, a return-to-service decision for corrective work (not withheld) and every job card completed or void. A rejected acceptance withholds return to service and sends the order back to `in_progress`. Gate codes: `wrk.work_order.approve` and `wrk.acceptance.accept` (permission codes too).

## M06 `pm_` (planned)

| Table | Class | Purpose |
|---|---|---|
| pm_task_template | H | Standard PM tasks |
| pm_plan | O | Calendar / running-hour / (R2) condition schedule per asset or position |
| pm_meter | O | Running-hour or counter meter |
| pm_meter_reading | E | Readings with source time |
| pm_calibration_record | E | Calibration results and due dates |
| pm_due | D | Computed due list |

## M07 `stk_`

| Table | Class | Key columns / rules |
|---|---|---|
| stk_part | H | part_no (unique, upper case), name, description, unit (`each`, `m`, `kg`…), category, manufacturer, manufacturer_part_no, status |
| stk_part_compatibility | H | part_id plus exactly one of classification_id or asset_id; unique per part and target |
| stk_location | O | code (unique per site), name, kind (`store`/`locker`/`workshop`/`other`), org_location_id (physical compartment, optional), status; home_scope_id = ship or workshop, NULL = fleet/hub store |
| stk_stock_level | O | part_id, location_id, min_level, reorder_qty; one per part and location (added to the plan so "below minimum" needs no guesswork) |
| stk_transaction | E | part_id, location_id, kind (`receipt`/`issue`/`return`/`transfer_out`/`transfer_in`/`adjustment`), quantity (magnitude, 3 decimals), qty_delta (signed), unit_cost, currency, ref_type/ref_id (`wrk.work_order`), transfer_id, reference, note |
| stk_reservation | E | part_id, location_id, kind (`reserve`/`release`), quantity, ref_type/ref_id (work order), note |
| stk_transfer | O | transfer_no (`SLN-TR-########`, range `transfer_no`), from/to location, lines_json `[{partId,quantity}]`, status (`dispatched`/`cancelled`), dispatched_at, cancel_reason |

Views (derived, never synchronized): **`stk_v_balance`** (on hand, reserved, available per part and location; this is the planned `stk_balance`), **`stk_v_stock`** (balance joined with part, location and minimum level, `below_minimum` flag, used by lists and M13), **`stk_v_last_cost`** (latest receipt cost per part, used as the issue cost), **`stk_v_issued_by_ref`** (net issued quantity and cost per work order and part), **`stk_v_reserved_by_ref`** (outstanding reservation per work order, part and location), **`stk_v_transfer_state`** (`in_transit`/`received`/`cancelled`).

Rules: stock is changed only by appending transactions; corrections are new `adjustment` events with a mandatory reason. Local commands refuse to overdraw (available = on hand − reserved by other work orders), to return more than a work order drew, to issue against a closed or other-ship work order, and to receive into inactive parts or locations; events replicated from elsewhere are never rejected for these reasons (D20). A work order's own issue consumes its reservation. A transfer takes stock out of the source at dispatch (all lines or none); the receiving installation records `transfer_in` events (received), or the dispatching installation calls it back while still in transit (stock returns to the source). A part or location with any history cannot be removed, only made inactive.

## M08 `res_` (planned, R2)

`res_skill` H · `res_user_skill` H · `res_workshop_capability` H · `res_capacity_calendar` O · `res_resource` O · `res_provider_agreement` H.

## M09 `pln_` (planned, R2)

`pln_requirement` O (requested dates, by submitter) · `pln_window` O (command/hub) · `pln_window_item` O · `pln_proposal` O (proposed dates) · `pln_authorization` E (authorized dates) · `pln_dependency` O · `pln_commitment` O · `pln_confirmation` E. Actual dates come from M05 events via view.

## M10 `syn_` (planned)

`syn_peer` L (peers, cursors) · `syn_subscription` H (scopes per installation) · `syn_session` L (history, health) · `syn_conflict` L · `syn_quarantine` L · `syn_ownership_transfer` E · `syn_bundle` L.

## M11 `xls_`

| Table | Class | Key columns / rules |
|---|---|---|
| xls_import_job | L | template_code, file_name, file_kind (`xlsx`/`csv`), file_sha256, status (`previewed`/`committed`/`failed`), total/ok/error/create/update/skip row counts, ignored_columns, message, created_by, committed_at |
| xls_import_row | L | job_id, row_no (the spreadsheet's own row number), data_json (cleaned cell values by column key), status (`ok`/`error`), action (`create`/`update`/`skip`), errors_json, duplicate_of, reference (for example a new asset tag) |
| xls_export_log | E | template_code, format, row_count, scope_kind, scope_id: one event per data export so the hub can see what was taken out |

`xls_template` from the plan does not exist: a template is the column list that the owning module declares on its `ImportExportPort` (D42). Templates in R1: `locations` (M01), `assets` (M03), `parts` (M07). Import jobs and rows are local working data and never synchronized.

Rules: an upload saves nothing. The preview applies every row inside one transaction that is rolled back, so each row is judged by the owning module's real command service (permissions, workflow, duplicates) and later rows see earlier ones. Commit re-applies the stored rows in one transaction: any row error aborts everything unless `skipErrors` is chosen, in which case failing rows are left out. A job can be committed once. Limits: 5 MB upload (8 MB hard limit), 20,000 rows, 200 columns, 2,000 characters per cell; only the first (or "Data") sheet is read; headers match the label or the key in any case; unknown columns are ignored and reported; CSV may use `,` `;` or tab.

## M12 `mon_` (planned, R2)

`mon_point` O · `mon_reading` E (value, unit, source timestamp, quality, source) · `mon_alarm_event` E · `mon_condition_rule` O · `mon_state` D (operating state, availability, alarm condition, data quality kept as four separate fields).

## M13 `rpt_` (planned)

`rpt_notification` L · `rpt_notification_rule` H · `rpt_readiness_snapshot` D. Reports read `<prefix>_v_*` views published by other modules.

## M14 `ops_` (planned)

`ops_backup_log` L · `ops_restore_log` L · `ops_integrity_check` L.
