/** Permission codes `org.<noun>.<action>` (CONTRACTS §7). M02 reads this list to seed its permission catalogue. */
export const ORG_NOUNS = [
  'fleet',
  'command',
  'ship',
  'ship_command_assignment',
  'department',
  'workshop',
  'external_provider',
  'location',
] as const;
export type OrgNoun = (typeof ORG_NOUNS)[number];

export const ORG_ACTIONS = ['view', 'create', 'update', 'remove'] as const;
export type OrgAction = (typeof ORG_ACTIONS)[number];

export const perm = (noun: OrgNoun, action: OrgAction): string => `org.${noun}.${action}`;

/**
 * Operational status and sea deployments (D66). Recording a status is `org.ship_status.record`; withdrawing a mistaken entry is
 * `org.ship_status.void`. Grant them to Command and NHQ roles (command- or fleet-scoped); during roll-out they may be granted to anyone.
 */
export const ORG_OPS_PERMISSIONS: readonly string[] = [
  'org.ship_status.view', 'org.ship_status.record', 'org.ship_status.void',
  'org.deployment.view', 'org.deployment.create', 'org.deployment.update', 'org.deployment.remove',
];

export const ORG_PERMISSIONS: readonly string[] = [...ORG_NOUNS.flatMap((n) => ORG_ACTIONS.map((a) => perm(n, a))), ...ORG_OPS_PERMISSIONS];
