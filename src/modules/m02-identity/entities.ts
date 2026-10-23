import type { EntityDef } from '../../platform/entity-registry.js';

/**
 * Identity data is hub-authored reference data. Credentials and user-installation rows are distributed per
 * provisioning (M10 filters credentials to installations a user is provisioned to), hence distribution 'record'.
 * Approvals and revocations are append-only events that may be created at any installation.
 */
export const IDN_ENTITIES: readonly EntityDef[] = [
  { type: 'idn.user', module: 'M02', table: 'idn_user', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'idn.credential', module: 'M02', table: 'idn_credential', recordClass: 'hub_reference', requires: ['idn.user'], distribution: 'record', redact: ['password_hash'] },
  { type: 'idn.user_installation', module: 'M02', table: 'idn_user_installation', recordClass: 'hub_reference', requires: ['idn.user', 'sys.installation'], distribution: 'record' },
  { type: 'idn.role', module: 'M02', table: 'idn_role', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'idn.role_permission', module: 'M02', table: 'idn_role_permission', recordClass: 'hub_reference', requires: ['idn.role'], distribution: 'fleet' },
  { type: 'idn.role_assignment', module: 'M02', table: 'idn_role_assignment', recordClass: 'hub_reference', requires: ['idn.user', 'idn.role'], distribution: 'fleet' },
  { type: 'idn.offline_grant', module: 'M02', table: 'idn_offline_grant', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'idn.gate_policy', module: 'M02', table: 'idn_gate_policy', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'idn.approval', module: 'M02', table: 'idn_approval', recordClass: 'event', requires: ['idn.user'], distribution: 'record' },
  { type: 'idn.authority_revocation', module: 'M02', table: 'idn_authority_revocation', recordClass: 'event', requires: ['idn.user'], distribution: 'fleet' },
];
