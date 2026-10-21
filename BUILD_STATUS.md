# BUILD_STATUS

Updated by each module chat before it stops. Keep rows to one line.

| ID | Module | Release | Status | Notes |
|---|---|---|---|---|
| M00 | Architecture, contracts, skeleton | R1 | **done** | 9 canonical docs; kernel (ids, time, units, errors, contracts, records/audit/change log, ranges, authz port, events, migrations, boundary checker); `npm run verify` green |
| M01 | Organizations, ships, commands, locations | R1 | not started | next |
| M02 | Identity, roles, permissions, offline authority | R1 | not started | |
| M03 | Asset register | R1 | not started | |
| M04 | QR labels and surveys | R1 | not started | |
| M05 | Defects, job cards, reviews | R1 | not started | |
| M06 | Planned maintenance, meters, calibration | R1 | not started | |
| M07 | Parts, stores | R1 | not started | |
| M08 | Workshops, skills, resources | R2 | not started | |
| M09 | Coordinated planning | R2 | not started | |
| M10 | Provisioning and sync | R1 | not started | write path already emits change log (M00) |
| M11 | Excel import/export | R1 | not started | |
| M12 | Monitoring | R2 | not started | |
| M13 | Reports and readiness | R1 | not started | |
| M14 | Deployment, backup, recovery | R1 | not started | |

## Verification (M00)

`npm run verify` → typecheck, `check:boundaries`, 42 tests across 7 files (run it for the current count). Run `npm ci` first on a clean checkout.

## Pinned toolchain

Node 22 · fastify 5.12.7 · zod 4.6.7 · better-sqlite3 13.0.3 · typescript 7.0.2 · vitest 5.0.5 · tsx 4.23.15 (exact versions in `package.json`, lockfile committed).

## Open items carried forward

- Owner answers to DECISIONS "open questions" (tag prefix, lease length, replica needs, languages, classification).
- `src/main.ts` refuses to start without an `Authorizer`; use `CMMS_DEV_AUTH=1` until M02.
- Web UI scaffold (`web/`) is created in M01 with versions pinned at that time.
- Production run mode and encryption at rest: M14.
