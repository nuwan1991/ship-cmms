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

## M01 `org_` (planned)

| Table | Class | Purpose |
|---|---|---|
| org_fleet | H | Fleet root (single row) |
| org_command | H | Configurable commands (seven initially; count not hard-coded) |
| org_ship | H | Ship master data (name, pennant/hull no., class, status) |
| org_ship_command_assignment | H | Dated ship→command attachment, non-overlapping per ship |
| org_department | H | Disciplines (Marine Eng., Electrical Eng., …) |
| org_workshop | H | Command, specialist or onboard workshop; optional command; has replica flag |
| org_external_provider | H | External repair organizations |
| org_location | O (owner = ship/site installation) | Decks, compartments, spaces; tree per ship/site |

## M02 `idn_` (planned)

| Table | Class | Purpose |
|---|---|---|
| idn_user | H | Person identity (`user_id`, name, rank, service no., status); no credentials |
| idn_credential | H | Username + scrypt hash + credential version; replicated only to installations the user is provisioned to |
| idn_user_installation | H | Which users are provisioned where, with lease expiry |
| idn_role / idn_role_permission | H | Roles and their permission codes |
| idn_role_assignment | H | User↔role↔scope, dated, optional `valid_until` |
| idn_offline_grant | H | Per-installation/per-role offline lease limits |
| idn_gate_policy | H | Gate mode and offline policy per gate code |
| idn_approval | E | Immutable approvals with actor snapshot, decided_at, authority basis, `confirmation_state` |
| idn_authority_revocation | E | Revocations with `effective_at` vs `received_at` |
| idn_session | L | Local login sessions |

## M03 `ast_` (planned)

| Table | Class | Purpose |
|---|---|---|
| ast_classification | H | Equipment classes/types, maintainable-component types |
| ast_position | O (owner = ship installation) | Functional tree node with `position_tag`, level, parent |
| ast_position_responsibility | O | Dated responsible department per position |
| ast_asset | O (owner = installation holding it) | Permanent `asset_tag`, `serial_number`, manufacturer, model, classification |
| ast_asset_movement | E | Install, remove, custody transfer, status change; position, location, custody party, dated |
| ast_asset_current | D | Folded current installation/custody/location per asset |

## M04 `qr_` (planned)

| Table | Class | Purpose |
|---|---|---|
| qr_label | O | Reserved/assigned label number (from range), asset link, state |
| qr_label_print | E | Print and reprint log (A4 sheets) |
| qr_survey_template | H | Simple compartment survey forms |
| qr_survey / qr_survey_item | O | Survey session and observed items (scanned asset or pending registration) |

## M05 `wrk_` (planned)

| Table | Class | Purpose |
|---|---|---|
| wrk_defect | O | Reported defect |
| wrk_repair_case | O | Parent case; may span departments/providers |
| wrk_work_order | O (owner moves via handover) | Departmental/provider work order with ownership/operating/executing parties |
| wrk_job_card | O | Task instructions and checklist |
| wrk_status_event | E | Transition on one of the four axes |
| wrk_labour_entry / wrk_finding / wrk_test_record | E | Labour, findings, tests |
| wrk_acceptance | E | Repair acceptance / return-to-service evidence |
| wrk_handover | E | Ownership offer/accept for work orders |
| wrk_advisory | H | Technical advisories |
| wrk_recurrence | D | Recurring-fault detection |

## M06 `pm_` (planned)

| Table | Class | Purpose |
|---|---|---|
| pm_task_template | H | Standard PM tasks |
| pm_plan | O | Calendar / running-hour / (R2) condition schedule per asset or position |
| pm_meter | O | Running-hour or counter meter |
| pm_meter_reading | E | Readings with source time |
| pm_calibration_record | E | Calibration results and due dates |
| pm_due | D | Computed due list |

## M07 `stk_` (planned)

| Table | Class | Purpose |
|---|---|---|
| stk_part | H | Parts catalogue |
| stk_part_compatibility | H | Part↔classification/asset compatibility |
| stk_location | O | Stock location per installation |
| stk_transaction | E | Receipt, issue, return, transfer out/in, adjustment; unit cost; work-order `EntityRef` |
| stk_reservation | E | Reserve/release events |
| stk_transfer | O | Inter-location/installation dispatch document |
| stk_balance | D | On-hand and reserved per part/location |

## M08 `res_` (planned, R2)

`res_skill` H · `res_user_skill` H · `res_workshop_capability` H · `res_capacity_calendar` O · `res_resource` O · `res_provider_agreement` H.

## M09 `pln_` (planned, R2)

`pln_requirement` O (requested dates, by submitter) · `pln_window` O (command/hub) · `pln_window_item` O · `pln_proposal` O (proposed dates) · `pln_authorization` E (authorized dates) · `pln_dependency` O · `pln_commitment` O · `pln_confirmation` E. Actual dates come from M05 events via view.

## M10 `syn_` (planned)

`syn_peer` L (peers, cursors) · `syn_subscription` H (scopes per installation) · `syn_session` L (history, health) · `syn_conflict` L · `syn_quarantine` L · `syn_ownership_transfer` E · `syn_bundle` L.

## M11 `xls_` (planned)

`xls_template` H · `xls_import_job` L · `xls_import_row` L · `xls_export_log` E.

## M12 `mon_` (planned, R2)

`mon_point` O · `mon_reading` E (value, unit, source timestamp, quality, source) · `mon_alarm_event` E · `mon_condition_rule` O · `mon_state` D (operating state, availability, alarm condition, data quality kept as four separate fields).

## M13 `rpt_` (planned)

`rpt_notification` L · `rpt_notification_rule` H · `rpt_readiness_snapshot` D. Reports read `<prefix>_v_*` views published by other modules.

## M14 `ops_` (planned)

`ops_backup_log` L · `ops_restore_log` L · `ops_integrity_check` L.
