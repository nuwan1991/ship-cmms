# PROJECT_SPEC — Ship & Fleet CMMS

Offline-first computerized maintenance management for a navy: seven commands, many ships, command and specialist workshops, external repair providers. Every ship and workshop installation must keep working, including approvals, with no internet, and later synchronize selectively with a central hub.

The original requirement brief is the source of truth for wording. This file only fixes **numbering, module mapping and release scope** so other documents can refer to `REQ-n` instead of copying text.

## Requirements → modules

| REQ | Topic | Primary module(s) | Platform support (M00) |
|---|---|---|---|
| 1 | Equipment structure (Fleet→Ship→System→Group→Equipment→Component); responsibility, location, command attachment separate | M01 (fleet, ship, location), M03 (position tree, responsibility) | — |
| 2 | Permanent asset identity, tags, serials, install/removal/custody history | M03 | UUIDv7 ids, number ranges |
| 3 | Commands, dated ship↔command assignments, ownership/operating/executing separation, workshop capability | M01, M08 | `PartyRef` contract |
| 4 | Offline operation, local server, provisioning, selective sync | M10 | record classes, change log, ownership |
| 5 | Authorization, approvals, gates, four status axes, offline authority | M02 | `Authorizer` port, approval port, audit envelope |
| 6 | Defects, repair cases, job cards, PM, recurring faults, advisories | M05, M06 | write path |
| 7 | Planning windows, dependencies, capacity, distinct dates, stale data | M09 (+M08) | `Freshness` contract |
| 8 | Stores and stock transactions | M07 | append-only events |
| 9 | QR labels, number ranges, surveys, A4 printing | M04 | number ranges |
| 10 | Excel import/export | M11 | `ImportExportPort` |
| 11 | Monitoring and PLC integration | M12 (+M06 meters) | event bus |
| 12 | Reporting, readiness, notifications | M13 | read-model views |

## Release scope

**R1 — Disconnected core (the bounded first release).** M00–M07, plus:
- M06: calendar and running-hour PM, manual meter readings, calibration due/records. Condition-based triggers are R2.
- M10: hub-and-spoke sync over the network and by signed bundle file, provisioning, selective sync, conflict queue.
- M11: templates for locations, assets and parts only.
- M13: backlog, pending reviews, sync health and data freshness per scope.
- M14: backup/restore, installer, upgrade-with-backup.
- Workshops exist as master data (M01); a workshop without its own replica works as a client of the hub.

**R2 — Coordination.** M08 (skills, capacity, capability), M09 (coordinated windows), M12 (manual readings, operating state, alarms), condition-based PM, readiness and cost reports (M13), remaining Excel templates.

**R3 — Integration.** Read-only PLC/instrument connectors, notifications beyond in-app, optional direct ship↔workshop sync.

**Out of scope for all releases above:** microservices, PLC write/control, purchasing and supplier procurement, finance/accounting ledgers, personnel/HR, native mobile apps, any mandatory cloud or paid service, field-level automatic merge of concurrent edits.

## Glossary

- **Installation** — one deployed instance with its own database: `hub`, `command`, `ship` or `workshop`.
- **Hub** — the central installation (one per fleet). Authoritative for reference data and number ranges; sync relay.
- **Replica** — any non-hub installation; holds only its subscribed scopes.
- **Home scope** — the ship/workshop/command a record belongs to; drives selective sync.
- **Owner installation** — the single installation allowed to modify a mutable record.
- **Position** — a place in a ship's functional tree (system … component); **asset** — the physical item installed in it.
- **Tag** — permanent readable equipment tag (`SLN-EQ-00000001`); **position tag** — the installation-position label. Never the same field.
