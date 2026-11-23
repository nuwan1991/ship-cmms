# OFFICE RELEASE NOTES: SLE (E&T) II – North

## Version 1.2, 23 Nov 2026

| Area | Change |
|---|---|
| Daily attendance (new) | **Office → Attendance.** *Mark the day*: the workshop in-charge marks each person Present, Late, Leave, Sick, On duty away, Course, Absent or Off duty, with remarks. Leave, sick, course and temporary duty periods from Personnel are filled in already. No future dates; past days can be corrected, with who marked them kept. *Summary*: one day or a period (man-days), by unit in structure order, each workshop rolled into its section and department, with strength, not marked and at-work %, and Print / Save as PDF |
| Access | New permissions `ofc.attendance.view` and `ofc.attendance.record`. OFC_SUPERVISOR marks and sees its own unit and below; OFC_OIC everything; OFC_READONLY views. Run `npm run office -- setup` after upgrading to add them to existing roles |
| Data | New table `ofc_attendance` (migration 0006), one mark per person per day, kept with the unit the person was in that day |

Tests: 360 server (new `test/modules/ofc-attendance.test.ts`) and 55 web tests pass.

## Version 1.1, 22 Nov 2026

Changes made while setting up the office, on top of Version 1.0.

| Area | Change |
|---|---|
| Sidebar | Shows only what the user's role allows (as before). New: **« Hide menu** folds it to a ☰ strip; each group folds, and only the current page's group opens; the sidebar scrolls on its own. Remembered per browser. Phones unchanged |
| Work orders: assigning staff | Supervisor and crew lists show only the staff of the chosen workshop (and units under it), plus anyone already on the work order |
| Work orders: borrowed staff | The server enforces the same rule. Staff from another workshop can be added by whoever assigns the work only with a reason (**Include staff from other workshops**); the reason is kept in the history. The work order lists borrowed staff separately under **From other workshops** |
| Structure | The in-charge field reads **Officer In-charge** for departments and sections and **S/S In-charge (Senior Sailor)** for workshops |
| Parts and stores | **New stock location** can now be given a workshop from Organization → Workshops, not only a ship |

Tests: 357 server and 54 web tests pass (`test/modules/ofc-day4.test.ts` now covers borrowed staff).

## Version 1.0 (Release 1), 22 Nov 2026

Release 1 is complete against OFFICE_R1_SPEC.md. The 12 acceptance criteria of the requirement (§11) are run automatically in `test/modules/ofc-acceptance.test.ts`, through the API with real sign-ins and the five office roles. They are **not yet signed off by the office**: that is the checklist in OFFICE_GUIDE.md §7.

| Requirement module | Where | Status |
|---|---|---|
| 01 Dashboard and command overview | Office → Dashboard | Done: 17 figures, each opening its list; per-person table; upcoming; recently completed |
| 02 Handover / takeover | Office → Handover / takeover | Done: packets, items, actions, paste import, completion report |
| 03 Correspondence and documents | Office → Correspondence, Matters | Done: in/out/minute/signal, matters, replies, pending/overdue, duplicates, Restricted masking |
| 04 Tasks and actions | Office → Tasks, My work | Done: 9 statuses, subtasks, delay reasons, verify-and-close by unit chain, reopen, cancel |
| 05 Personnel and responsibility | Office → Personnel | Done: people with or without sign-in, responsibilities, duty periods, workload, reassign on transfer |
| 06 Equipment, repair, temporary issue | Office → Equipment register | Done: quick registration, movement flow, overdue returns, pending collection |
| 07 Basic work orders | Office → Work orders (office) | Done: 10 statuses, approval reference, crew, verification, links to letters, equipment and supply |
| 08 Reports | Office → Reports | Done: 9 mandatory reports + supply status; period and filters; print/PDF; Excel |
| Added: Supply demand tracking | Office → Supply demands | Done: stages with dates, paste from the logistics system updates by Supply reference |
| Common: history, attachments, links, import, export | every record | Done |
| Roles and access | `npm run office -- setup` | Done: OIC, Supervisor, Technical staff, Read-only, Admin; unit-level visibility |
| Backup and recovery | Operations (M14) | Done: restore drill in the acceptance suite |

Design decisions: DECISIONS.md D71–D74.

### Known limits of 1.0 (accepted for the first release)

1. **Office structure, personnel and Supply stages are placeholders** until the office's own lists are entered (OFFICE_GUIDE §1.5–1.8).
2. **Office data stays on the office computer.** It is not synchronised to ships or other installations (assumption A9). Attachment files are stored in the database, so they are included in every backup.
3. **Office equipment and work orders are separate from the ship asset register and ship work orders.** They can be linked, but office equipment is not moved into the asset register (D73; Release 2).
4. **PDF** comes from the browser's *Save as PDF*. There is no separate PDF generator.
5. **The column headings for paste import** are matched against common names. Unusual headings are shown as "ignored". Rename them in Excel and paste again.
6. **Monthly summary: equipment movement counts** are for the whole office, even for a user limited to one section.
7. **The Excel templates** of the main Excel screen (*Excel import / export*) do not include office records yet. Office imports use paste (*Office → Import existing registers*).
8. **Screens are in English only.** Labels are kept separately, so Sinhala and Tamil can be added without changing the screens.

## Deferred-feature register

Kept up to date as items are requested or deferred. Priority: 1 = next, 3 = later.

| # | Feature | From | Release | Priority | Notes |
|---|---|---|---|---|---|
| D-01 | Move office equipment into the asset register (M03); QR labels for it (M04) | Spec R2.1, R2.7, R2.8 | R2 | 1 | Data model already links `asset_id` |
| D-02 | Preventive maintenance for office/workshop equipment (M06) | R2.2 | R2 | 1 | M06 exists for ships |
| D-03 | Spare parts and inventory, with work-order materials issued from stock (M07) | R2.3 | R2 | 2 | Today: "materials required" text and supply demands |
| D-04 | Procurement progress beyond supply stages (quotations, tenders, local purchase) | R2.4 | R2 | 2 | Builds on supply demands |
| D-05 | Direct link to the existing logistics system (replace paste / helper bot) | User, 21 Nov | R3 | 2 | Supply reference already unique per office |
| D-06 | Technical inspections | R2.5 | R2 | 2 | Could reuse M04 survey forms |
| D-07 | Workshop capacity and workload planning; personnel competency (M08) | R2.6, R2.10 | R2 | 2 | |
| D-08 | Report builder; more report layouts (letterhead, landscape) | R2.9 | R2 | 3 | Waiting for the higher authority's required format (Q6) |
| D-09 | Excel templates for office records in the main Excel screen | Day 6 | R2 | 3 | Paste import covers R1 |
| D-10 | Multi-user on the office network (LAN), with a security review | A3a | R2 | 1 | Today: one computer, localhost only |
| D-11 | Sinhala / Tamil screens | — | R2 | 3 | Labels already separated |
| D-12 | Condition-based maintenance, reliability, cost, turnaround analysis, calibration for office equipment | R3.1–3.5 | R3 | 3 | M06/M12/M13 parts exist for ships |
| D-13 | Projects and infrastructure; drawing and manual repository | R3.6, R3.7 | R3 | 3 | |
| D-14 | Advanced approval workflows (multi-step, delegated authority records) | R3.8 | R3 | 3 | M02 approval gates exist |
| D-15 | Office data on more than one installation (offline sync) | R3.9 | R3 | 3 | Office entities are already sync-ready |
| D-16 | Fleet-level reporting; historical comparisons | R3.11, R3.12 | R3 | 3 | |
| D-17 | AI-assisted functions (classification, draft reports, repeat-defect detection, smart search) | R4 | R4 | 3 | Only suggestions, never approvals; needs a security decision first. Nothing Restricted to leave the office computer |
| D-18 | Real Supply stages, report format, handover annex headings, reference formats | Q1–Q6 | 1.0.x | 1 | Waiting for the office |
