# OFFICE_R1_SPEC — SLE (E&T) II – North: Office, Engineering & Technical Management, Release 1

Status: **draft for approval** (Day 1 deliverable). Nothing is built yet.
Source: the "Master AI Development Prompt" requirements supplied by the user (Nov 2026).
Scope rule: Release 1 (R1) mandatory features only. Everything else is in §9 (deferred register).

---

## 0. How this fits into the existing Ship-CMMS

The requirements say not to prescribe technology. They don't need to: Ship-CMMS already exists and already does
about half of what R1 asks for. So the plan is **extend, not rebuild**. The office system becomes one more module
plus configuration of the existing modules.

| Requirement module | Delivered by | New work |
|---|---|---|
| 01 Dashboard | **M15 Office** (new) dashboard reading views from M15 + M05 | New screen, new views |
| 02 Handover/Takeover | **M15** | New |
| 03 Correspondence | **M15** | New |
| 04 Tasks & actions | **M15** | New |
| 05 Personnel & responsibility | M02 users (identity) + **M15** profile/responsibility/duty records | Extension |
| 06 Equipment, repair, temporary issue | M03 asset register (identity of equipment) + **M15** custody/movement register | Extension |
| 07 Work orders | **M05** (existing work orders, gates, verification) | Status mapping, links to letters |
| 08 Reports | **M13** reports, print layouts, Excel via M11, PDF | 9 new report definitions |
| Common: import/export | **M11** Excel | New sheet templates |
| Common: history, no silent deletion | Platform audit/change log (already enforced) | None |
| Roles & access | **M02** roles, scoped assignments, ApprovalPort | 5 seeded roles |
| Backup & recovery | **M14** operations | Acceptance test only |
| Org structure (office, sections, workshops) | **M01** command/department/section | Seed SLE (E&T) II – North |

New module: **M15 – Office management**. Directory `src/modules/m15-office`, table prefix `ofc_`, API `/api/v1/office`,
depends on M01, M03, M05. Registered in MODULE_MAP and BUILD_STATUS; a DECISIONS entry (D71) records it.
M15 must not import M02 (MODULE_MAP rule 2). Person ids are plain ids that the web picks from the M02 user directory.

---

## 1. Consolidated R1 functional requirements

The IDs below are referenced by the tests in §7.

### 1.1 Common record behaviour (all M15 records). Most of it is already platform behaviour
- FR-C1: Every record gets a unique system id and a **human reference number** from a sequence per record type
  (e.g. `TSK-2026-0001`, `COR-IN-2026-0001`, `HOV-0001`, `EQM-2026-0001`). Imported records **keep their original
  reference** in `original_ref`, and the system number is assigned in addition.
- FR-C2: created at/by, updated at/by, version. All of these come from the platform.
- FR-C3: responsible person, priority (`Immediate`, `High`, `Normal`, `Low`), status, remarks, where applicable.
- FR-C4: Attachments (scans, photos, PDF) on any record, stored once and linkable to several records.
- FR-C5: **Links** between any two records (letter ↔ task ↔ handover item ↔ work order ↔ equipment), each with a
  link type (`originated_from`, `reply_to`, `relates_to`, `supersedes`). Links are shown on both ends.
- FR-C6: **Activity history** that is append-only: status changes, reassignment, progress notes, target-date changes
  with a reason, attachment add/remove.
- FR-C7: No hard deletion. *Cancel* or *void* needs a reason and the permission. A correction to a significant field
  (reference no., dates, subject) is recorded as a correction event that shows the old and new values.
- FR-C8: List screens offer search (free text over reference, subject, remarks), sort, filters (section, responsible person,
  priority, status, date range), print and export to Excel.
- FR-C9: Duplicate warning on create/import: same original reference + date, or same subject + originator within 30 days.
- FR-C10: **Overdue** = target date before today and status not in a terminal state (Completed/Closed/Cancelled; for
  correspondence, replied/no reply needed). This one rule is used everywhere.
- FR-C11: **Due soon** = target date within the next 7 days. The number of days is a setting.

### 1.2 M01 Dashboard
- FR-D1: Tiles for: active tasks, completed in period, overdue, immediate attention (priority Immediate or overdue
  more than 14 days), awaiting approval/decision, outstanding work orders, pending correspondence, equipment awaiting
  collection/return/repair, upcoming deadlines (due soon), recently completed (last 10).
- FR-D2: A per-person table of active, overdue and due-soon counts.
- FR-D3: Filters for section, person, priority, status and period. Every tile and count opens the filtered list.
- FR-D4: The numbers come from the same queries as the lists, so the dashboard and the lists can never disagree (Acceptance 6).

### 1.3 M02 Handover / takeover
- FR-H1: Handover **packet**: reference, from appointment-holder, to appointment-holder, appointment, handover date,
  takeover date, status (`Draft`, `Signed`, `In Progress`, `Completed`), attached handover document and annexes.
- FR-H2: Handover **item** fields: reference no. (auto), annex/document reference, category (`Responsibility`,
  `Project`, `Pending work`, `Unresolved matter`, `Correspondence`, `Equipment`), subject, description, previous status
  (text from the document, kept unchanged), current status (`Open`, `In Progress`, `Completed`, `Not Applicable`),
  priority, urgent flag, responsible person, target date, latest action (the newest progress note), remarks, attachments.
- FR-H3: Bulk registration from a spreadsheet, with a validation preview before commit (§1.9).
- FR-H4: Create a task from an item. The item and the task stay linked, and completing the task does not close the item
  by itself. The system suggests it, and the user confirms.
- FR-H5: Handover progress report per packet: count and % by status/category, open urgent items, overdue items.

### 1.4 M03 Correspondence & documents
- FR-K1: A record is one of `Incoming letter`, `Outgoing letter`, `Minute sheet`, `Signal/Message`, `Other document`.
- FR-K2: Fields: system no., **official reference no.**, file reference, date of letter, date received/sent,
  originator, recipient(s), subject, security classification marker (`Unclassified`, `Restricted`, `Confidential`).
  Restricted and above are visible only to holders of the sensitive-view permission. Also: reply required (Y/N), reply due
  date, action officer, dispatch/receipt status (`Received`, `Under Action`, `Replied`, `Filed`, for outgoing:
  `Draft`, `Signed`, `Dispatched`, `Acknowledged`), dispatch mode and date, attachments, remarks.
- FR-K3: **Matter (file thread)**: groups the related letters, replies and minute sheets of one matter in date order. A letter
  belongs to at most one matter. A reply links to the letter it answers.
- FR-K4: Create task(s) or a work order from a letter. Its reference and attachments stay visible on the task/WO.
- FR-K5: Pending correspondence = reply required, and no linked outgoing reply marked Dispatched, and not marked "no reply needed".
- FR-K6: Registers: the incoming register and the outgoing register for a date range (printable book format).

### 1.5 M04 Tasks & actions
- FR-T1: Create manually, from a letter, from a handover item or from a work order. The source is linked automatically.
- FR-T2: Fields: ref no., title, description, section, assigned to (one accountable person), assigned by, priority,
  start date, target date, status, % progress (optional), delay reason (mandatory when it becomes overdue, or when the
  target date is moved later), remarks, attachments.
- FR-T3: Statuses: Not Started → Assigned → In Progress ⇄ Awaiting Information / Awaiting Approval / On Hold →
  Completed → Closed. Cancelled is possible from any non-terminal status, with a reason. Reopen from Completed/Closed needs a reason.
- FR-T4: **Close after verification**: the assignee sets Completed. A person holding task-verify on that section
  sets Closed. The assignee cannot close their own task, unless they are the officer in charge and a self-closure note is recorded.
- FR-T5: Subtasks (one level), each with its own assignee, target date and status. The parent cannot be Completed while
  a subtask is open.
- FR-T6: Comments and progress updates in the timeline. Reassignment records from, to and reason, and keeps the history.

### 1.6 M05 Personnel & responsibility
- FR-P1: A person is an M02 user (sign-in optional: a "no-login" person can still be assigned work). Fields: service no.,
  rank/designation, name, appointment, section/workshop, contact (visible only with permission), supervisor, duty status
  (`Available`, `On Leave`, `Temporary Duty`, `Course`, `Sick`, `Transferred`), with from/to dates.
- FR-P2: Responsibilities: named standing duties (e.g. "Workshop inventory", "Generator section") assigned to a person,
  with from/to dates. A handover can transfer them.
- FR-P3: Workload view: active, overdue and due-soon tasks, and open work orders and equipment custody per person.
- FR-P4: Temporary duty assignment: from/to, place, acting person for their tasks (optional, with bulk reassignment).
- FR-P5: Historical ownership is preserved: past assignee events stay in the timeline. A transferred person is marked
  inactive, never deleted.

### 1.7 M06 Equipment, repair & temporary issue
- FR-E1: Equipment identity uses the M03 asset register. Equipment that is not in the register (e.g. brought in by another
  unit) can be **quick-registered** with just: equipment id no., name, make/model, serial no., owning unit.
- FR-E2: An M15 **equipment movement register** records each movement: `Received for repair`, `Sent to workshop/agency`,
  `Returned from workshop/agency`, `Temporarily issued`, `Returned from issue`, `Repair completed`,
  `Ready for collection`, `Collected / returned to owner`. Each movement has date, from, to, person, document ref,
  expected return date, condition (`Serviceable`, `Unserviceable`, `Repairable`, `Beyond Economic Repair`, `Unknown`),
  remarks and photos.
- FR-E3: Current state per equipment (location/custodian, condition, repair/issue status, expected return), worked out
  from the movements, so nothing is overwritten.
- FR-E4: Defects/repair requirements are raised as an M05 defect or work order on the asset (no second defect list).
- FR-E5: Lists: pending collection, overdue return (temporary issue past expected date), at external agency.

### 1.8 M07 Work orders (existing M05)
- FR-W1: Reuse the M05 work order (requesting unit, equipment, reported defect, section/workshop, supervisor, crew,
  priority, actions/labour, materials, findings, completion, acceptance/verification, closure).
- FR-W2: The office uses **office status labels**, mapped from the M05 status axes (mapping to be confirmed on Day 4
  against `wrk_status_event`): Requested, Under Review, Approved, Assigned, In Progress, Awaiting Spares,
  Awaiting External Support, Completed, Verified, Closed.
- FR-W3: A work order can be created from a letter or a task, and is linked both ways.
- FR-W4: "Materials required" goes in a free-text list in R1 (stock issue via M07 stores is optional).

### 1.8a Supply demand tracking (added at the user's request, 21 Nov 2026)
The Supply department sits outside the unit tree. The office still needs to see where each demand stands.
- FR-S1: Supply demand record: system no., **Supply/logistics system reference** (kept exactly, as the key for future
  integration), demand date, item/part description, part no., quantity, unit, demanding unit, linked WO/task/equipment, priority,
  current stage, stage date, expected date, Supply contact, remarks, attachments.
- FR-S2: Stages (default list, editable in settings until the real stages are given): `Demand raised`, `Forwarded to Supply`,
  `Under processing`, `Not in stock – local purchase`, `Quotation / tender`, `Order placed`, `Received at Supply`,
  `Issued / collected`, `Cancelled`. Each stage change is a timeline event with its date, so time-in-stage can be measured.
- FR-S3: A WO in *Awaiting Spares* shows its linked demands and their stages. The dashboard gets a tile for open demands and
  demands overdue against the expected date.
- FR-S4: Entry options: (a) a manual form; (b) **paste import**: copy rows from the logistics system screen or export, paste them
  into the import screen, map the columns once (the mapping is saved), preview, then commit. Rows matched by the Supply reference
  update the stage instead of creating duplicates. A local helper ("bot") can later feed the same import format.
  Direct integration is in Release 3.
- FR-S5: Report 10: Supply demand status (open demands by stage, days in stage, overdue).

### 1.9 M08 Reports
Nine reports. Each one has a date range, filters, a print layout (A4, header "SLE (E&T) II – North", report title, period,
generated by/at, page numbers, a signature block "Prepared by / Checked by"), and Excel export and PDF (print-to-PDF from the
print layout). Each one includes reference numbers, remarks and responsible persons.

1. Daily outstanding actions: open tasks, letters awaiting reply and open WOs, overdue first.
2. Weekly work progress: tasks/WOs opened, progressed and completed in the week, with the latest action each.
3. Monthly office activity summary: counts by module/status/section, letters in/out, completion rate.
4. Overdue tasks, with days overdue and delay reason.
5. Pending correspondence, with days since received and reply due.
6. Handover completion, per packet.
7. Equipment pending repair/return/collection.
8. Workshop work progress: WOs per section/workshop by office status.
9. Personnel task allocation: per person active/overdue/completed in period.

### 1.10 Data import/export
- FR-X1: Excel templates for handover items, correspondence, tasks, personnel, equipment.
- FR-X2: Import is a two-step **preview → commit**: row-level validation errors, duplicate warnings, and nothing written until
  commit. It keeps the original refs and dates. Each row is stamped with the import batch id. Values are never silently changed:
  an unknown value is a row error, not a guess.
- FR-X3: Export of any list as Excel, with the current filters applied.
- FR-X4: Backup/restore via M14. A restore drill is part of acceptance.

---

## 2. Screens

| # | Screen | Purpose | Main fields / content |
|---|---|---|---|
| S01 | Office dashboard | Command overview (FR-D) | Tiles, per-person table, upcoming deadlines, recently completed, filters |
| S02 | Task list | Find/act on tasks | Ref, title, section, assignee, priority, status, target, days overdue, source |
| S03 | Task detail | Work a task | All FR-T2 fields, subtasks, timeline (comments/progress/status), links, attachments, actions: assign, reassign, status, complete, close, reopen, cancel |
| S04 | New/edit task | Create | FR-T2 fields, source picker |
| S05 | Correspondence register | In/out list | Type, sys no., official ref, date, originator/recipient, subject, action officer, reply due, status, classification |
| S06 | Correspondence detail | One letter | FR-K2 fields, matter thread, replies, linked tasks/WOs, attachments, actions: create task, create WO, register reply, mark dispatched, no reply needed |
| S07 | Matters | File threads | Matter title, file ref, letters count, open actions, latest date |
| S08 | Handover packets | List of handovers | Ref, from, to, appointment, date, % complete |
| S09 | Handover packet detail | Items of one handover | Packet fields, documents/annexes, item table (FR-H2), bulk import, progress report button |
| S10 | Handover item detail | Track one item | FR-H2 fields, timeline, linked tasks, actions: add action, create task, complete |
| S11 | Personnel register | People | Service no., rank, name, appointment, section, supervisor, duty status, active/overdue counts |
| S12 | Person detail | One person | Profile, responsibilities, duty periods, workload, task history |
| S13 | Equipment register (office view) | Equipment handled | Id no., name, make/model, serial, owner unit, location/custodian, condition, status, expected return, responsible |
| S14 | Equipment detail | One item | Identity, current state, movement history, linked WOs/defects, photos, action: record movement |
| S15 | Record movement | Receive/send/issue/return | FR-E2 fields |
| S16 | Work orders (office view) | M05 list with office status | Existing M05 screens + office status column/filter and letter links |
| S17 | Reports | Pick and run reports 1–9 | Report, period, filters, Preview / Print / Excel / PDF |
| S18 | Import | Bulk import | Template download, upload, preview with errors/duplicates, commit, batch history |
| S19 | Admin: users and roles | Existing M02 screen | Assign the 5 office roles, scope to the office/section |
| S20 | Admin: office settings | Reference formats, due-soon days, responsibility list, report header | — |
| S21 | Backup | Existing M14 screen | Backup now, last backup, restore guidance |

---

## 3. Roles and permissions

These are software permissions only. **Formal Navy approval authority is recorded separately** as delegated authority (M02
`ApprovalPort` / authority records). A permission lets a user press a button. It does not make the action an official approval.
Where an action is an approval (close a task after verification, verify a WO), the system also records who approved it and under
which authority reference.

| Permission (group) | Sys Admin | Officer in Charge | Section Officer / Supervisor | Technical Staff | Read-only |
|---|---|---|---|---|---|
| View all office records | ✓ | ✓ | own section(s) | own/assigned | authorised scope |
| View restricted correspondence | — (admin ≠ content) | ✓ | if granted | — | — |
| Register correspondence | ✓* | ✓ | ✓ | — | — |
| Create/assign tasks | — | ✓ | own section | subtasks on own tasks | — |
| Update progress/comments | — | ✓ | own section | own tasks/WOs | — |
| Complete task | — | ✓ | ✓ | own tasks | — |
| Close (verify) task / reopen | — | ✓ | own section, not own | — | — |
| Cancel records | — | ✓ | own section, with reason | — | — |
| Handover register/update | — | ✓ | as assigned | own items | — |
| Personnel register | ✓ | ✓ | own section (view, duty status) | own profile view | — |
| Equipment movements | — | ✓ | ✓ | ✓ (record, not cancel) | — |
| Work orders | per existing M05 permissions | approve/verify | assign/progress | progress/complete | view |
| Reports | — | all | own section | — | authorised |
| Import/export | ✓ | ✓ | export | — | export if granted |
| Users, roles, settings, backup | ✓ | — | — | — | — |

\* An admin has data entry only if the office wants it (assumption A6). By default the admin manages the system and does not work the records.
Scope: roles are assigned to the office (command/department scope in M01), or to a section for supervisors. This uses the existing
dated, scoped M02 role assignments.

---

## 4. Record relationships

```
Org (M01): Command ── Office "SLE (E&T) II – North" ── Sections / Workshops
Person (M02 user + ofc_person_profile) ──< Responsibility, DutyPeriod
Matter ──< Correspondence ──(reply_to)── Correspondence
HandoverPacket ──< HandoverItem
Task ──< Subtask ; Task ──< TimelineEvent
Equipment (M03 asset) ──< EquipmentMovement (ofc) ; Asset ──< Defect/WorkOrder (M05)
Attachment >──< any record                      (ofc_attachment_link)
Any record >──< any record                       (ofc_link: from_ref, to_ref, link_type)
```
All cross-record references are `EntityRef {type,id}` with no database foreign keys on synced tables (DECISIONS D07).
Typical chains: *Letter → Task → Work order → Equipment*, and *Handover item → Task → Outgoing letter*.

Planned M15 tables (R1): `ofc_matter`, `ofc_correspondence`, `ofc_handover_packet`, `ofc_handover_item`, `ofc_task`,
`ofc_task_event`, `ofc_person_profile`, `ofc_responsibility`, `ofc_duty_period`, `ofc_equipment_movement`,
`ofc_attachment`, `ofc_attachment_link`, `ofc_link`, `ofc_import_batch`, plus views `ofc_v_task_current`,
`ofc_v_correspondence_pending`, `ofc_v_equipment_state`, `ofc_v_dashboard_*` for M13.

---

## 5. End-to-end workflows

**WF1 Incoming letter → task → closure (Acceptance 1, 2)**
Clerk registers the incoming letter with a scan, sets reply required and due date, and assigns the action officer → OIC opens it,
creates a task for the section officer (the letter is linked) → the section officer assigns it to staff (Assigned) → staff record
progress (In Progress, optionally Awaiting Information) → staff mark Completed → the section officer verifies and Closes → the outgoing
reply is registered with reply_to = the letter, and marked Dispatched → the letter drops off the pending list.

**WF2 Handover import → monitoring (Acceptance 3)**
Create the packet and attach the signed handover document → download the template, fill in the annex items, upload and preview
(fix errors, review duplicates), then commit → the OIC sets priority/responsible/target per item, bulk-editing in the list →
items needing work get tasks → progress notes update "latest action" → items are completed → the handover completion report goes to higher authority.

**WF3 Equipment received for repair → returned (Acceptance 4)**
A unit brings equipment → find it, or quick-register it → movement *Received for repair* (condition, photos, owner's
document ref) → raise a defect/work order → optionally *Sent to agency* with expected return → *Returned from agency* →
*Repair completed* → *Ready for collection* → *Collected*. It shows in "pending collection" until the last step.

**WF4 Temporary issue**: *Temporarily issued* to a person/unit with expected return → overdue list after the date →
*Returned from issue* with condition.

**WF5 Work order (Acceptance 5)**: Requested (from a unit/letter) → Under Review → Approved (OIC, recorded authority) →
Assigned (section + crew) → In Progress (actions, materials) ⇄ Awaiting Spares / External Support → Completed →
Verified (acceptance gate) → Closed.

**WF6 Personnel change**: the officer is transferred → their duty status is set to Transferred → bulk-reassign their open tasks
with a reason → the history keeps the old owner → the handover packet transfers their responsibilities.

**WF7 Daily routine**: the OIC opens the dashboard → overdue tile → chases items or records delay reasons → prints the daily
outstanding report.

---

## 6. Seven-day task breakdown

Each day ends with `npm run verify` and `npm run verify:web` green, and that day's acceptance tests (§7) passing.
Anything not finished moves to the next day's top, or to the deferred register, and is never shipped half-done.

| Day | Build | Done when |
|---|---|---|
| 1 | This spec approved. M15 skeleton (module registration, D71, permissions, 5 seeded roles, reference sequences, `ofc_link`, `ofc_attachment*`, generic timeline). Seed org: SLE (E&T) II – North + sections. Office menu shell | AT-14, AT-15 pass |
| 2 | Correspondence + matters (S05–S07). Handover packets/items (S08–S10). Attachments and linking UI | AT-01, AT-05, AT-06 pass |
| 3 | Tasks with subtasks, statuses, verify-close, reopen, delay reasons, overdue rule (S02–S04). Person profile, responsibilities, duty, workload (S11–S12) | AT-02, AT-03, AT-07, AT-08 pass |
| 4 | Equipment quick-register and movement register (S13–S15). WO office-status mapping, WO ↔ letter/task links (S16) | AT-09, AT-10, AT-11 pass |
| 5 | Dashboard views and screen (S01). Nine reports with print layout, Excel, PDF (S17) | AT-12, AT-13, AT-16 pass |
| 6 | Import templates and preview/commit (S18). Load real handover records. Full workflow run-through. Role access tests. Backup and restore drill | AT-04, AT-17–AT-20 pass |
| 7 | UAT with the office. Fix critical defects. Short user guide section (USER_GUIDE.md). Tag v1.0-office | All AT pass and are signed off by the OIC |

Daily completion checklist (copied into BUILD_STATUS each day): ☐ migrations apply on a fresh DB and an existing DB ☐ server tests
☐ web tests ☐ boundary check ☐ day's AT cases run ☐ existing CMMS tests still green (no regression to ship data) ☐ deferred items logged.

---

## 7. Functional acceptance tests

| AT | Covers | Steps | Expected |
|---|---|---|---|
| AT-01 | Acc 1 | Register an incoming letter with a PDF, then create a task from it | The task shows the letter ref and the PDF. The letter shows the task |
| AT-02 | Acc 2 | Assign → progress → Awaiting Info → In Progress → Complete → Close by supervisor | Each step is in the timeline with user and time. Status is Closed |
| AT-03 | FR-T4 | The assignee tries to close their own task | Refused (unless OIC with a self-closure note) |
| AT-04 | Acc 3 | Import 50 handover rows with 2 bad rows and 1 duplicate | Preview shows 2 errors and 1 warning. Nothing is written before commit. After commit 48–49 rows exist with original refs |
| AT-05 | FR-K3/K5 | Register a reply to a letter, then mark it dispatched | The letter leaves the pending list. The matter thread shows both |
| AT-06 | FR-C7 | Cancel a letter, then correct a reference no. | A reason is needed. History shows the old and new values. The record still exists |
| AT-07 | Acc 7 | Task with a target date of yesterday | Appears in the overdue tile, list and report. A delay reason is prompted |
| AT-08 | FR-P5 | Reassign the tasks of a transferred person | New owner set. The old owner stays in the timeline and the person report history |
| AT-09 | Acc 4 | WF3 full cycle on quick-registered equipment | Current state follows each movement. Pending-collection list is correct at each step |
| AT-10 | WF4 | Temporary issue past its expected return | On the overdue-return list |
| AT-11 | Acc 5 | WF5 full cycle | All office statuses reachable. Verification records the approver and authority |
| AT-12 | Acc 6 | Compare each dashboard tile with its list count | Identical. Clicking opens the same records |
| AT-13 | Acc 8 | Run reports 1–9 for a period, then print, Excel and PDF | Header, refs, remarks and responsible persons are present. The files open |
| AT-14 | Acc 9 | Technical staff open another section's task by URL, or edit it | Refused. Read-only user cannot edit anything |
| AT-15 | Acc 9 | Admin opens restricted correspondence | Refused unless granted |
| AT-16 | Acc 10 | Edit a task's target date | Change event with old/new value and reason |
| AT-17 | Acc 11 | Back up, add records, restore | DB returns to the backup state. App starts. Counts match |
| AT-18 | Acc 12 | Run the full existing test suite after all R1 work | Green. Existing CMMS data untouched |
| AT-19 | FR-C9 | Enter the same letter ref + date twice | Duplicate warning |
| AT-20 | FR-X3 | Export a filtered task list | The Excel file contains exactly the filtered rows |

---

## 8. Assumptions (to confirm). Noncritical ones are used as the default until corrected

- A1 **Organisation (confirmed by the user, 20 Nov 2026).** Levels, from the top:
  1. **Dockyard**, headed by the Commodore/Captain Superintendent. This is the M01 command.
  2. **Department** (Fleet, Utility, Electronic, ...), headed by a senior officer.
  3. **Section**, headed by a senior-level officer. *Optional*: a small department may have no sections.
  4. **Workshop**, headed by an in-charge (senior sailor or civilian technical officer). Depending on size and importance,
     one or two officers (a senior and a junior).
  5. **Sub-section**, only inside a large workshop. Its in-charge is a petty officer or technical supervisor.
  6. **Staff**: sailors and labourers (currently civilian), sometimes junior technical ratings (Artificers).
  The **Supply department works outside this chain**. It appears as an external party (e.g. awaiting spares), not as a unit
  in the tree. M01 departments are flat (no parent), so M15 adds an office unit tree, `ofc_org_unit` (level, parent, head,
  deputy), anchored to the M01 command. Reports and dashboards roll up the tree. Unit names will be supplied later.
- A1a **Computer literacy differs by level.** Staff (basic literacy) get a simple *My work* screen: their tasks and work
  orders, large buttons, one-tap "Started / Need info / Done", photo upload. No registers or filters. Sub-section
  in-charges (moderate literacy) get lists for their own unit. Full screens go to workshop level and above.
- A2 Reference number formats follow the examples in FR-C1 until the office gives its own format.
- A3 The classification markers are as listed in FR-K2. **The system is not accredited for classified material.** Only enter what local
  security instructions permit (critical point, see Q1).
- A3a Local install hardening: BitLocker full-disk encryption, a Windows account password and screen lock, the server bound to localhost only (no LAN exposure until multi-user is approved), encrypted backups on removable media held securely, and no AI features over Restricted content.
- A4 One accountable assignee per task. Others are involved through subtasks.
- A5 **Verification (confirmed by the user).** A task or work order is verified and closed by the **in-charge of the owning unit, or the
  officer over that unit**, according to its size and importance. Verification is never done by the assignee. Configurable per unit:
  the in-charge alone, or the officer required. Further approval powers are not assumed.
- A6 The Sys Admin does not work the records by default.
- A7 PDF is produced by printing the print layout to PDF (no separate PDF engine in R1).
- A8 Due-soon window is 7 days. "Immediate attention" is priority Immediate or more than 14 days overdue.
- A9 Runs on the existing Ship-CMMS server installation (hub or shore). Office data is held at that installation and is not synced to ships in R1.

## Open questions for the office (needed by Day 2)

- Q1 *(Answered: up to Restricted, on a local single-user computer.)* Local hardening is in A3a. Restricted content must not be sent to cloud/AI services without authorisation.
- Q2 *(Structure answered, see A1.)* The unit names, the personnel list and the appointments will come later.
- Q3 *(Answered, see A5.)*
- Q4 Can you send a sample of the existing handover annex and the correspondence register (spreadsheet or scan), so the import templates match them?
- Q5 Are there existing reference number formats for letters and minute sheets?
- Q6 Is a specific report format required by higher authority (letterhead, signature blocks)?

---

## 9. Deferred-feature register (prioritised backlog)

**Release 2: operational expansion** (in this order, because most of it already exists in Ship-CMMS)
1. Complete equipment/asset registry. *M03 exists. This means migrating office equipment into it properly*
2. Equipment transfer and custody. *M03 transfers exist*
3. QR identification. *M04 exists. Enable it for office equipment*
4. Preventive maintenance scheduling. *M06 exists*
5. Spare parts and inventory. *M07 exists. Connect WO materials to stock issues*
6. Workshop capacity/workload planning. *M08, not yet built*
7. Procurement progress monitoring. *R1 has basic supply demand tracking (§1.8a). R2 adds procurement detail; R3 adds direct integration with the logistics system*
8. Technical inspection management. *New, using M04 survey templates*
9. Advanced report builder
10. Personnel competency. *M08 skills*

**Release 3: advanced engineering**: calibration (M06 has it), turnaround-time analysis, cost analysis (M13 job cost), reliability
and recurring defects (M05 has recurring faults), condition-based maintenance (M12), drawings/manuals repository, advanced approval
workflows (M02 gates), offline/sync for office data (M10), fleet-level reporting, historical comparison. Integration with Ship-CMMS is
**already native** under this design.

**Release 4: intelligent assistance** (always suggestion-only. Never approves, closes or changes authoritative records): correspondence
classification, task suggestions from documents, neglected-matter detection, draft progress reports, defect trend/repeat detection
(builds on M05 `suggestCategory` and recurring faults), PM recommendations, semantic search, similar past repairs, resource suggestions.
Each needs a security decision before any document leaves the installation.
