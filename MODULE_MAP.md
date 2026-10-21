# MODULE_MAP

Source of truth for the mechanical parts is `src/platform/modules.ts`; `test/boundaries.test.ts` fails if this file drifts from it.

| ID | Name | Directory (`src/modules/`) | Table prefix | API prefix | Depends on | Release |
|---|---|---|---|---|---|---|
| M01 | Organizations, ships, commands, locations | m01-organization | `org_` | /api/v1/org | — | R1 |
| M02 | Identity, roles, permissions, offline authority | m02-identity | `idn_` | /api/v1/identity | M01 | R1 |
| M03 | Asset register, classifications, installations, transfers | m03-assets | `ast_` | /api/v1/assets | M01 | R1 |
| M04 | QR labels and compartment surveys | m04-labels-survey | `qr_` | /api/v1/labels | M01, M03 | R1 |
| M05 | Defects, job cards, reviews, repair acceptance | m05-work | `wrk_` | /api/v1/work | M01, M03 | R1 |
| M06 | Planned maintenance, meters, calibration | m06-planned-maintenance | `pm_` | /api/v1/pm | M01, M03, M05 | R1 (condition-based R2) |
| M07 | Parts, stores, stock transactions | m07-stores | `stk_` | /api/v1/stores | M01, M03 | R1 |
| M08 | Workshops, skills, resources, external providers | m08-workshops | `res_` | /api/v1/workshops | M01, M02 | R2 |
| M09 | Coordinated ship/fleet maintenance planning | m09-planning | `pln_` | /api/v1/planning | M01, M03, M05, M06, M07, M08 | R2 |
| M10 | Provisioning, selective sync, conflict handling | m10-sync | `syn_` | /api/v1/sync | — (registry) | R1 |
| M11 | Excel import/export | m11-excel | `xls_` | /api/v1/excel | — (ports) | R1 limited |
| M12 | Monitoring, alarms, operating readings | m12-monitoring | `mon_` | /api/v1/monitoring | M01, M03 | R2 (PLC R3) |
| M13 | Reports, readiness, notifications | m13-reports | `rpt_` | /api/v1/reports | — (views) | R1 limited |
| M14 | Integration, deployment, backup, recovery | m14-operations | `ops_` | /api/v1/ops | — | R1 |

Platform (M00) owns `src/platform/**`, prefix `sys_`, API `/api/v1/system`.

## Rules

1. **Imports**: platform, self, or a declared dependency's `index.ts` only. Platform never imports modules.
2. **Dependency inversion**: M02 supplies the `Authorizer` and `ApprovalPort` at startup, so no module imports M02 (M08 may, for user skills). M10 and M11 act on other modules only through the entity registry and `ImportExportPort`; M13 reads only `<prefix>_v_*` views. M12 signals M06 through the event bus (`mon.condition.breached`), not imports.
3. **Cross-module references** are `EntityRef {type,id}` or plain ids validated in services; no database foreign keys on synced tables (DECISIONS D07).
4. **Materials and cost**: M07 owns stock transactions referencing a work order by `EntityRef`; M05 owns labour. Job cost is aggregated by M13 from both modules' views.
5. **Build order** follows the table; each module's chat may modify only its own directory, its own migrations, its row in this file, `src/modules/index.ts` (one line) and BUILD_STATUS.md. Changes to `src/platform/**`, CONTRACTS.md or SYNC_RULES.md need a DECISIONS entry and are made in a dedicated small change.

## Public surface per module (what other modules may rely on)

| Module | Exports from `index.ts` (target) | Ports implemented | Ports/events consumed |
|---|---|---|---|
| M01 | `getShipCommandAt(shipId, date)`, `listShipsByCommand`, `getLocation`, org types, `PartyRef` resolvers | entity registrations | Authorizer |
| M02 | user/role lookups for M08 | `Authorizer`, `ApprovalPort` | audit, registry |
| M03 | `getAsset`, `getPosition`, `currentInstallation(assetId)`, `resolveTag`, asset types | entity registrations, `ImportExportPort` | ranges, Authorizer |
| M04 | label issue/assign API | `ImportExportPort` (labels) | ranges, M03 |
| M05 | `WorkOrderRef`, `createWorkOrder` (command), status-axis helpers | gate codes registered with M02 | ApprovalPort |
| M06 | plan/meter API | PM generation via M05 commands | event `mon.condition.breached` |
| M07 | `getBalance`, `issueToWorkOrder`, part lookup | views for M13 | — |
| M08 | capability/skill/capacity lookups | — | — |
| M09 | window/plan API | — | read models |
| M10 | sync status for UI | — | entity registry, schema versions |
| M11 | — | — | `ImportExportPort` registry |
| M12 | latest-state lookup | event publisher | M03 |
| M13 | — | read-model registry | `<prefix>_v_*` views |
| M14 | — | — | — |

## API conventions per module

Each module mounts routes only under its API prefix, REST resources in kebab-case plural (`/api/v1/org/ships/:id`), camelCase JSON, `expectedVersion` on every update (CONTRACTS §9).
