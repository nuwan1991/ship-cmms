/** Permission codes `syn.<noun>.<action>` (CONTRACTS §7), announced on the event bus at startup (D25). The peer endpoints are not user actions: they are authenticated by installation signatures. */
export type SynNoun = 'status' | 'peer' | 'subscription' | 'session' | 'conflict' | 'bundle';
export const perm = (noun: SynNoun, action: string): string => `syn.${noun}.${action}`;

export const SYN_PERMISSIONS: readonly string[] = [
  'syn.status.view', 'syn.peer.view', 'syn.peer.provision', 'syn.peer.decommission', 'syn.subscription.update',
  'syn.session.view', 'syn.session.run', 'syn.conflict.view', 'syn.conflict.resolve', 'syn.bundle.export', 'syn.bundle.import',
];
