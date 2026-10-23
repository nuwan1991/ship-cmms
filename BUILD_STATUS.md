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
| M06 | Planned maintenance, meters, calibration | R1 | not started | next |
| M07 | Parts, stores | R1 | not started | |
| M08 | Workshops, skills, resources | R2 | not started | |
| M09 | Coordinated planning | R2 | not started | |
| M10 | Provisioning and sync | R1 | not started | write path already emits change log (M00) |
| M11 | Excel import/export | R1 | not started | |
| M12 | Monitoring | R2 | not started | |
| M13 | Reports and readiness | R1 | not started | |
| M14 | Deployment, backup, recovery | R1 | not started | |

## Verification

`npm run verify` → typecheck, `check:boundaries`, server tests (M00–M05). `npm run web:install` once, then `npm run verify:web` → web typecheck, tests, production build. Run `npm ci` first on a clean checkout.

Demo: `npm run init-installation -- --kind hub --code HQ --name "Fleet HQ"`, `npm run seed:demo-org`, then `CMMS_DEV_AUTH=1 npm run dev` and `npm run web:dev` (port 5173, proxies `/api` to 8080).

## Pinned toolchain

Node 22 · fastify 5.12.7 · zod 4.6.7 · better-sqlite3 13.0.3 · typescript 7.0.2 · vitest 5.0.5 · tsx 4.23.15. Web: react 19.3.1 · react-router-dom 7.18.4 · vite 8.3.5 (exact versions in `package.json` and `web/package.json`, lockfiles committed).

## Open items carried forward

- Owner answers to DECISIONS "open questions" (tag prefix, lease length, replica needs, languages, classification).
- Production start registers the identity Authorizer and answers anonymous calls with 401. `CMMS_DEV_AUTH=1` (allow-all dev user, no sign-in) is for development only and is refused in production.
- Bootstrap: `npm run create-admin -- --username admin --name "Fleet Administrator"` once at the hub (prints a one-time password if none given).
- Role assignment scope ids are typed as ids in the UI; pickers for commands/ships/workshops need an org lookup that does not make M02 import M01's UI (M10/M13 era).
- Freshness is a placeholder (hub authoritative, others stale/never) until M10 supplies sync state.
- Production run mode and encryption at rest: M14.
