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

export const ORG_PERMISSIONS: readonly string[] = ORG_NOUNS.flatMap((n) => ORG_ACTIONS.map((a) => perm(n, a)));
