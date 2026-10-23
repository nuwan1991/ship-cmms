import type { AppContext } from '../../platform/app-context.js';
import type { Freshness } from '../../platform/contracts.js';
import { nowUtc } from '../../platform/time.js';

const STALE_DAYS: Record<string, number> = { ship: 7, workshop: 2, command: 2 };
export const staleAfterMs = (kind: string): number => (STALE_DAYS[kind] ?? 2) * 86_400_000;

type Row = Record<string, unknown>;

/**
 * "Data as of" for this installation (SYNC_RULES §7). The hub is authoritative for reference data and holds the newest copy of everything it has received,
 * so it is never stale; every other installation is as fresh as its last exchange with the hub.
 */
export function localFreshness(ctx: AppContext): Freshness {
  const kind = ctx.identity?.kind ?? 'hub';
  if (kind === 'hub') return { scope: { kind: 'fleet' }, asOf: nowUtc(), stale: false, pendingOutbound: 0 };
  const hub = ctx.db.prepare("SELECT last_sync_at, pending_outbound FROM syn_v_peer_health WHERE role = 'hub'").get() as Row | undefined;
  const asOf = (hub?.last_sync_at as string | null | undefined) ?? null;
  return { scope: { kind: 'fleet' }, asOf, stale: !asOf || Date.now() - Date.parse(asOf) > staleAfterMs(kind), pendingOutbound: Number(hub?.pending_outbound ?? 0) };
}
