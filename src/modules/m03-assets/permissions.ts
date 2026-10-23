/** Permission codes `ast.<noun>.<action>` (CONTRACTS §7). Announced on the event bus at startup so M02 can offer them to roles (D25). */
export const AST_NOUNS = ['classification', 'position', 'position_responsibility', 'asset', 'asset_movement'] as const;
export type AstNoun = (typeof AST_NOUNS)[number];

export const AST_ACTIONS = ['view', 'create', 'update', 'remove'] as const;
export type AstAction = (typeof AST_ACTIONS)[number];

export const perm = (noun: AstNoun, action: AstAction | 'void'): string => `ast.${noun}.${action}`;

/** Movements are events: they are appended and corrected by a void event, never edited or removed. */
export const AST_PERMISSIONS: readonly string[] = [
  ...AST_NOUNS.filter((n) => n !== 'asset_movement').flatMap((n) => AST_ACTIONS.map((a) => perm(n, a))),
  perm('asset_movement', 'view'),
  perm('asset_movement', 'create'),
  perm('asset_movement', 'void'),
];
