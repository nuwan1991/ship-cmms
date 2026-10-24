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
| M07 | Parts, stores, stock transactions | m07-stores | `stk_` | /api/v1/stores | M01, M03, M05 | R1 |
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
| M01 | `getShipCommandAt(db, shipId, at?)`, `listShipsByCommand(db, commandId, at?)`, `getLocation(db, id)`, `resolveParty` / `resolveParties` (PartyRef → live org unit or null), `ORG_PERMISSIONS`, `orgPermission`, `ORG_ENTITIES`, result types | entity registrations (`org.*`) | Authorizer (via `req.principal` set by M02) |
| M02 | none for other modules (they use the ports); exports for the composition root, CLI and tests: `IDN_PERMISSIONS`, `PermissionCatalogue`, `checkAuthority`, `effectivePermissions`, `recordApproval`, `evaluateGate`, `ratifyApproval` | `Authorizer` (`idn-authorizer`), `ApprovalPort`; session hook sets `req.principal` | event `sys.permissions.declared`, M01 `ORG_PERMISSIONS` |
| M03 | `getAsset`, `getPosition`, `currentInstallation(assetId)`, `assetAtPosition`, `getAssetState`, `positionChain`, `resolveTag`, `responsibilityAt`, `rebuildAssetCurrent`, `resolveClassificationCode`, `standardEquivalent`, `astPermission`, asset types | entity registrations, `ImportExportPort` (assets, classifications, classification-map) | ranges, Authorizer |
| M04 | `resolveLabel`, `labelForAsset`, `LABEL_SEQUENCE`, `qrPermission` | `ImportExportPort` (labels) | ranges, M03 (`createAsset`, `getAsset`, `resolveTag`) |
| M05 | `WorkOrderRef`, `getWorkOrder`, `resolveWorkOrderNo`, `openWorkOrdersForAsset`, `createWorkOrder` (command), `workOrderClosedAt`, `currentAxes`, `advisoriesForAsset`, number sequence codes, `GATE_APPROVE`, `GATE_ACCEPT` | gate codes `wrk.work_order.approve` and `wrk.acceptance.accept` (declared with the permissions, D25) | ApprovalPort, ranges, M03 (`getAsset`, `getPosition`), M01 (`resolveParty`) |
| M06 | `currentMeterValue`, `dueForAsset`, `templatesForAsset`, `generateDue`, `pmPermission`, `PM_PERMISSIONS` | views `pm_v_*` for M13 | M05 (`createWorkOrder`, `getWorkOrder`, `workOrderClosedAt`), M03 (`getAsset`, `getPosition`, `standardEquivalent`), ranges; later event `mon.condition.breached` (R2) |
| M07 | `getPart`, `findPartByNo`, `getBalance`, `partsForAsset`, `onHandAtSite`, `partsIssuedTo`, `issueToWorkOrder`, `TRANSFER_SEQUENCE` | views `stk_v_*` for M13 | ranges, M05 (`getWorkOrder`), M03 (`getAsset`, `standardEquivalent`), M01 (`getLocation`, `resolveParty`) |
| M08 | capability/skill/capacity lookups | — | — |
| M09 | window/plan API | — | read models |
| M10 | `syncOnce`, `syncStatus`, `freshness`, `provisionPeer`, `joinHub`, `exportBundle`, `importBundle`, `retryQuarantined`, event `sys.sync.applied`, `synPermission` | views `syn_v_*` for M13 and M14 | entity registry, schema versions, change log (`sys_change_log`) |
| M11 | — | — | `ImportExportPort` registry (`ctx.importExport`), filled by M01 (`locations`), M03 (`assets`, `classifications`, `classification-map`) and M07 (`parts`) in their `register()` |
| M12 | latest-state lookup | event publisher | M03 |
| M13 | `runReport`, `dashboard`, `refreshNotifications`, `localFreshness`, `REPORTS` | — | `<prefix>_v_*` views of M01, M02, M03, M05, M06, M07, M10 |
| M14 | `createBackup`, `verifyBackupFile`, `restoreBackup`, `upgradeWithBackup`, `runIntegrity`, `opsStatus`, `startBackupScheduler` | — | database file, entity registry, `org_v_assignment_overlap`, `ast_v_position_conflicts`, `stk_v_balance`, `syn_v_health` |

## API conventions per module

Each module mounts routes only under its API prefix, REST resources in kebab-case plural (`/api/v1/org/ships/:id`), camelCase JSON, `expectedVersion` on every update (CONTRACTS §9).
