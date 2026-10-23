# BUILD_STATUS

Updated by each module chat before it stops. Keep rows to one line.

| ID | Module | Release | Status | Notes |
|---|---|---|---|---|
| M00 | Architecture, contracts, skeleton | R1 | **done** | 9 canonical docs; kernel (ids, time, units, errors, contracts, records/audit/change log, ranges, authz port, events, migrations, boundary checker); `npm run verify` green |
| M01 | Organizations, ships, commands, locations | R1 | **done** | 8 org tables, `org_v_ship_current_command`, services, routes, permissions, PartyRef helpers, demo seed, `web/` shell and org screens; `npm run verify` and `npm run verify:web` green |
| M02 | Identity, roles, permissions, offline authority | R1 | **done** | 11 idn tables, `idn_v_approval_status`, scrypt sign-in and sessions, Authorizer + ApprovalPort, offline lease/revocation/ratification, `create-admin` CLI, web sign-in, account and admin screens; verify and verify:web green |
| M03 | Asset register | R1 | **done** | 6 ast tables, 2 views, movement folding, tag ranges + `asset-tags` CLI, demo seed, classification/position-tree/asset screens; verify (133 server tests) and verify:web green |
| M04 | QR labels and surveys | R1 | **done** | 5 qr tables, `qr_v_survey_summary`, label issue/assign/void/print (QR SVG, A4 grid), survey templates, surveys and item conversion via M03, `label-numbers` CLI, demo survey, web labels/surveys/forms screens; verify (150 server tests) and verify:web green |
| M05 | Defects, job cards, reviews | R1 | **done** | 11 wrk tables, 4 views, defects → repair cases → work orders, four status axes, approval and acceptance gates via ApprovalPort, job cards, labour/findings/tests, hand-over, advisories, recurring faults, `work-numbers` CLI, demo work, web defects/cases/work orders/advisories; verify (179 server tests incl. real M02 gates) and verify:web green |
| M06 | Planned maintenance, meters, calibration | R1 | **done** | 5 pm tables, 4 views, task templates, calendar and running-hour plans, meters with replacement, calibration records, idempotent work-order generation via M05, `seed:demo-pm`, web due list/plans/meters/calibration/templates; 232 server tests, 33 web tests (needs `npm run work-numbers -- setup` first) |
| M07 | Parts, stores | R1 | **done** | 7 stk tables, 6 views, parts catalogue and compatibility, stock locations and minimum levels, receipts/issues/returns/adjustments as events, work-order reservations, transfers (dispatch, receive, call back), `store-numbers` CLI, demo stores, web stock/transfers/parts/locations; 197 server tests incl. HTTP, verify:web green (28 tests) |
| M08 | Workshops, skills, resources | R2 | not started | |
| M09 | Coordinated planning | R2 | not started | |
| M10 | Provisioning, selective sync, conflicts | R1 | **done** | 5 syn tables, 3 views; signed envelopes (Ed25519), provisioning package and enrolment, hello/push/pull with cursors, selective delivery by scope, quarantine and conflict decisions, signed bundle files both ways, emergency export, hub-restore detection, freshness and clock skew, `npm run sync`, web status/installations/conflicts/files; 17 tests incl. two-installation flows. User credentials are delivered only to provisioned installations (D61). Not built: ownership hand-over, re-homing, dependency closure (D55) |
| M11 | Excel import/export | R1 | **done** | R1 templates: locations (M01), assets (M03), parts (M07); xlsx and CSV, blank template with instructions sheet, export in the same layout, rolled-back preview then all-or-nothing commit, error report, export log, web screen; 218 server tests, 31 web tests, files checked with LibreOffice and openpyxl |
| M12 | Monitoring | R2 | not started | |
| M13 | Reports, readiness, notifications | R1 | **done** | 6 reports (backlog, pending reviews, maintenance due, stock below minimum, recurring faults, sync health), dashboard, CSV, "data as of" on every report, in-app notifications with self-clearing rules; reads views only (tested); web overview/reports/notifications. Readiness and cost reports are R2 |
| M14 | Deployment, backup, recovery | R1 | **done** | consistent backups with manifest and SHA-256, verify, scheduled backups with pruning, backup before every upgrade, restore (stopped application, safety copy), integrity query set, system health, compiled production run, web app served by the same process, `npm run ops` installer; web health/backups/data checks; see OPERATIONS.md |

## Verification

`npm run verify` → typecheck, `check:boundaries`, server tests (M00–M07 and M10–M14). `npm run web:install` once, then `npm run verify:web` → web typecheck, tests, production build. Run `npm ci` first on a clean checkout.

Demo: `npm run init-installation -- --kind hub --code HQ --name "Fleet HQ"`, `npm run seed:demo-org`, then `CMMS_DEV_AUTH=1 npm run dev` and `npm run web:dev` (port 5173, proxies `/api` to 8080).

## Pinned toolchain

Node 22 · fastify 5.12.7 · zod 4.6.7 · better-sqlite3 13.0.3 · typescript 7.0.2 · vitest 5.0.5 · tsx 4.23.15. Web: react 19.3.1 · react-router-dom 7.18.4 · vite 8.3.5 (exact versions in `package.json` and `web/package.json`, lockfiles committed).

## Open items carried forward

- Owner answers to DECISIONS "open questions" (tag prefix, lease length, replica needs, languages, classification).
- Production start registers the identity Authorizer and answers anonymous calls with 401. `CMMS_DEV_AUTH=1` (allow-all dev user, no sign-in) is for development only and is refused in production.
- Bootstrap: `npm run create-admin -- --username admin --name "Fleet Administrator"` once at the hub (prints a one-time password if none given).
- Role assignment scope ids are typed as ids in the UI; pickers for commands/ships/workshops need an org lookup that does not make M02 import M01's UI (M10/M13 era).
- Other modules' lists still use their own placeholder freshness banner; M10 provides the real values (`GET /api/v1/sync/freshness`, `freshness()`) and M13 reports already use them. Switching the other lists over is mechanical.
- Many modules do not yet stamp `home_scope_id` on what they create, which limits what selective sync can deliver to other ships (D52).
- Encryption at rest is left to the operating system (D17); backups are owner-readable only.
- First additions when a ship needs them: ownership hand-over and ship re-homing, dependency closure (D55).
- R2 modules not started: M08 workshops and skills, M09 coordinated planning, M12 monitoring; readiness and cost reports (M13).
