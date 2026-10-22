import { describe, expect, it } from 'vitest';
import type { Rec } from './api';
import { summarizeFreshness } from './freshness';
import { groupByModule, visibleNav, type NavItem } from './nav';
import { localInputToUtcIso, toLocalDisplay, utcIsoToLocalInput } from './time';
import { buildTree, descendantIds } from '../modules/org/tree';

const rec = (id: string, parentId: string | null, code: string, sortOrder = 0): Rec => ({ id, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', parentId, code, sortOrder });

describe('time', () => {
  it('shows UTC instants in Asia/Colombo (UTC+05:30) and round-trips form input', () => {
    expect(toLocalDisplay('2026-10-21T17:59:00.000Z')).toBe('2026-10-21 23:29');
    expect(localInputToUtcIso('2026-10-21T23:29')).toBe('2026-10-21T17:59:00.000Z');
    expect(utcIsoToLocalInput('2026-10-21T17:59:00.000Z')).toBe('2026-10-21T23:29');
  });
  it('rejects impossible local dates', () => {
    expect(localInputToUtcIso('2026-02-30T10:00')).toBeNull();
    expect(localInputToUtcIso('garbage')).toBeNull();
  });
});

describe('navigation registry', () => {
  const items: NavItem[] = [
    { module: 'org', path: '/org/ships', labelKey: 'a', requiredPermission: 'org.ship.view', order: 20 },
    { module: 'org', path: '/org/commands', labelKey: 'b', requiredPermission: 'org.command.view', order: 10 },
    { module: 'ast', path: '/ast', labelKey: 'c', order: 30 },
  ];
  it('filters by permission, orders, and groups by module', () => {
    const v = visibleNav(items, (p) => p !== 'org.ship.view');
    expect(v.map((i) => i.path)).toEqual(['/org/commands', '/ast']);
    expect(groupByModule(visibleNav(items, () => true)).map((g) => [g.module, g.items.length])).toEqual([['org', 2], ['ast', 1]]);
  });
});

describe('freshness banner state', () => {
  it('never/stale outrank ok; hub is authoritative; empty shows nothing', () => {
    expect(summarizeFreshness([], 'ship')).toBeNull();
    const scope = { kind: 'fleet' };
    expect(summarizeFreshness([{ scope, asOf: null, stale: true, pendingOutbound: 2 }], 'ship')).toEqual({ level: 'never', asOf: null, pendingOutbound: 2 });
    expect(summarizeFreshness([{ scope, asOf: '2026-10-01T00:00:00.000Z', stale: true, pendingOutbound: 0 }], 'ship')?.level).toBe('stale');
    expect(summarizeFreshness([{ scope, asOf: null, stale: false, pendingOutbound: 0 }], 'hub')?.level).toBe('authoritative');
    expect(summarizeFreshness([{ scope, asOf: null, stale: false, pendingOutbound: 0 }], 'ship')?.level).toBe('ok');
  });
});

describe('location tree', () => {
  const items = [rec('c', 'b', 'C'), rec('a', null, 'A', 2), rec('b', 'a', 'B'), rec('z', null, 'Z', 1), rec('o', 'missing', 'O')];
  it('orders depth-first by sortOrder then code, and shows orphans as roots', () => {
    expect(buildTree(items).map((r) => `${r.rec.code}${r.depth}`)).toEqual(['O0', 'Z0', 'A0', 'B1', 'C2']);
  });
  it('a node and its descendants cannot become its parent; cycles in bad data do not hang', () => {
    expect([...descendantIds(items, 'a')].sort()).toEqual(['a', 'b', 'c']);
    expect(buildTree([rec('x', 'y', 'X'), rec('y', 'x', 'Y')])).toEqual([]);
  });
});
