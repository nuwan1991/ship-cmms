/** Permission codes `ofc.<noun>.<action>` (CONTRACTS §7), announced at startup (D25). Checked at the office's command scope. */
export type OfcNoun = 'scope' | 'org_unit' | 'link' | 'attachment' | 'timeline' | 'task' | 'correspondence' | 'handover' | 'person' | 'equipment' | 'supply' | 'report' | 'import';
export const perm = (noun: OfcNoun, action: string): string => `ofc.${noun}.${action}`;

export const OFC_PERMISSIONS: readonly string[] = [
  // Sees and works every unit of the office; without it a user sees their own unit and below, and work assigned to them (D72).
  'ofc.scope.all',
  'ofc.org_unit.view', 'ofc.org_unit.create', 'ofc.org_unit.update',
  'ofc.link.view', 'ofc.link.create', 'ofc.link.remove',
  'ofc.attachment.view', 'ofc.attachment.view_restricted', 'ofc.attachment.create', 'ofc.attachment.remove',
  'ofc.timeline.view', 'ofc.timeline.comment',
  // Declared now so roles can be set up once; the records arrive on Days 2-4.
  'ofc.task.view', 'ofc.task.create', 'ofc.task.update', 'ofc.task.assign', 'ofc.task.verify', 'ofc.task.cancel', 'ofc.task.reopen',
  'ofc.correspondence.view', 'ofc.correspondence.view_restricted', 'ofc.correspondence.create', 'ofc.correspondence.update', 'ofc.correspondence.cancel',
  'ofc.handover.view', 'ofc.handover.create', 'ofc.handover.update',
  'ofc.person.view', 'ofc.person.view_contact', 'ofc.person.create', 'ofc.person.update', 'ofc.person.reassign',
  'ofc.equipment.view', 'ofc.equipment.record', 'ofc.equipment.cancel',
  'ofc.supply.view', 'ofc.supply.create', 'ofc.supply.update',
  'ofc.report.view', 'ofc.import.run',
];

/** The five R1 roles (spec §3). Software permissions only: formal approval authority is recorded separately (M02 ApprovalPort). */
export const OFFICE_ROLES: ReadonlyArray<{ code: string; name: string; description: string; permissions: readonly string[] }> = [
  {
    code: 'OFC_ADMIN', name: 'Office system administrator', description: 'Users, roles, units, settings, import. Does not work the records (A6).',
    permissions: ['ofc.scope.all', 'ofc.org_unit.*', 'ofc.import.run', 'ofc.person.view', 'ofc.person.view_contact', 'ofc.person.create', 'ofc.person.update', 'idn.*', 'ops.*'],
  },
  {
    code: 'OFC_OIC', name: 'Officer in charge', description: 'Sees all office work, assigns, verifies within delegated authority, reviews reports.',
    permissions: ['ofc.*', 'wrk.*'],
  },
  {
    code: 'OFC_SUPERVISOR', name: 'Section officer / supervisor', description: 'Manages own unit: registers letters, allocates and verifies work, submits reports.',
    permissions: [
      'ofc.org_unit.view', 'ofc.link.*', 'ofc.attachment.view', 'ofc.attachment.create', 'ofc.timeline.*',
      'ofc.task.view', 'ofc.task.create', 'ofc.task.update', 'ofc.task.assign', 'ofc.task.verify', 'ofc.task.cancel', 'ofc.task.reopen',
      'ofc.correspondence.view', 'ofc.correspondence.create', 'ofc.correspondence.update',
      'ofc.handover.view', 'ofc.handover.update', 'ofc.person.view', 'ofc.person.view_contact', 'ofc.person.update', 'ofc.person.reassign', 'ofc.equipment.*', 'ofc.supply.*', 'ofc.report.view',
    ],
  },
  {
    code: 'OFC_TECH', name: 'Technical staff', description: 'Own tasks and work orders: progress, observations, photos, completion.',
    permissions: ['ofc.org_unit.view', 'ofc.link.view', 'ofc.attachment.view', 'ofc.attachment.create', 'ofc.timeline.*', 'ofc.task.view', 'ofc.task.update', 'ofc.task.create', 'ofc.handover.view', 'ofc.person.view', 'ofc.equipment.view', 'ofc.equipment.record'],
  },
  {
    code: 'OFC_READONLY', name: 'Read-only user', description: 'Views authorised records and reports.',
    permissions: ['ofc.scope.all', 'ofc.org_unit.view', 'ofc.link.view', 'ofc.attachment.view', 'ofc.timeline.view', 'ofc.task.view', 'ofc.person.view', 'ofc.correspondence.view', 'ofc.handover.view', 'ofc.equipment.view', 'ofc.supply.view', 'ofc.report.view'],
  },
];
