/** Permission codes `stk.<noun>.<action>` (CONTRACTS §7), announced on the event bus at startup (D25). */
export type StkNoun = 'part' | 'compatibility' | 'location' | 'stock_level' | 'transaction' | 'reservation' | 'transfer';
export const perm = (noun: StkNoun, action: string): string => `stk.${noun}.${action}`;

export const STK_PERMISSIONS: readonly string[] = [
  'stk.part.view', 'stk.part.create', 'stk.part.update', 'stk.part.remove',
  'stk.compatibility.view', 'stk.compatibility.create', 'stk.compatibility.remove',
  'stk.location.view', 'stk.location.create', 'stk.location.update', 'stk.location.remove',
  'stk.stock_level.view', 'stk.stock_level.create', 'stk.stock_level.update', 'stk.stock_level.remove',
  'stk.transaction.view', 'stk.transaction.receive', 'stk.transaction.issue', 'stk.transaction.return', 'stk.transaction.adjust',
  'stk.reservation.view', 'stk.reservation.reserve', 'stk.reservation.release',
  'stk.transfer.view', 'stk.transfer.dispatch', 'stk.transfer.receive', 'stk.transfer.cancel',
];
