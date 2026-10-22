/**
 * DEMO data only - never production data (the real fleet is entered or imported by the owner).
 * Runs at the hub through the normal services, so ownership, audit and change log are exercised.
 */
import { createEntity, reassignShip } from './service.js';
import type { Actor } from './actor.js';
import { allowAllAuthorizer } from './seed-authz.js';

export interface DemoSeedResult {
  commands: number;
  ships: number;
  locations: number;
}

const ENTITIES = (a: Actor) => (noun: Parameters<typeof createEntity>[1], v: Record<string, unknown>) => createEntity(a, noun, v);

export function seedDemoOrganization(actor: Actor): DemoSeedResult {
  const a: Actor = { ...actor, authz: allowAllAuthorizer };
  if (a.wctx.installation.kind !== 'hub') throw new Error('Demo data is seeded at the hub only');
  const make = ENTITIES(a);
  const id = (r: Record<string, unknown>) => r.id as string;

  make('fleet', { code: 'DEMO-FLEET', name: 'Demo Fleet' });

  const commands = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l, i) => make('command', { code: `DEMO-CMD-${l}`, name: `Demo Command ${l}`, shortName: `DC-${l}`, sortOrder: i + 1 }));

  const deptDefs: Array<[string, string]> = [['ME', 'Marine Engineering'], ['EE', 'Electrical Engineering'], ['WPN', 'Weapons Engineering'], ['COM', 'Communications']];
  deptDefs.forEach(([code, name], i) => make('department', { code, name, sortOrder: i + 1 }));

  const ships = [
    { code: 'DEMO-101', name: 'Demo Patrol 101', pennantNo: 'P101', shipClass: 'Demo patrol class', shipType: 'Patrol vessel' },
    { code: 'DEMO-102', name: 'Demo Patrol 102', pennantNo: 'P102', shipClass: 'Demo patrol class', shipType: 'Patrol vessel' },
    { code: 'DEMO-201', name: 'Demo Support 201', pennantNo: 'A201', shipClass: 'Demo support class', shipType: 'Support vessel' },
  ].map((s) => make('ship', s));

  const t0 = '2025-01-01T00:00:00.000Z';
  make('ship_command_assignment', { shipId: id(ships[0]!), commandId: id(commands[0]!), effectiveFrom: t0, reason: 'Initial attachment' });
  make('ship_command_assignment', { shipId: id(ships[1]!), commandId: id(commands[0]!), effectiveFrom: t0, reason: 'Initial attachment' });
  make('ship_command_assignment', { shipId: id(ships[2]!), commandId: id(commands[1]!), effectiveFrom: t0, reason: 'Initial attachment' });
  // One change of attachment so history and effective-dated lookups have something to show.
  reassignShip(a, { shipId: id(ships[1]!), commandId: id(commands[2]!), effectiveFrom: '2026-03-01T00:00:00.000Z', reason: 'Demo: reattached for refit support' });

  make('workshop', { code: 'DEMO-WS-A', name: 'Command A Workshop', kind: 'command', commandId: id(commands[0]!) });
  make('workshop', { code: 'DEMO-WS-ELEC', name: 'Specialist Electrical Workshop', kind: 'specialist', hasReplica: true });
  make('workshop', { code: 'DEMO-WS-101', name: 'Demo Patrol 101 Onboard Workshop', kind: 'onboard', shipId: id(ships[0]!) });
  make('external_provider', { code: 'DEMO-EXT-1', name: 'Demo Marine Services Ltd', contactName: 'Demo Contact', contactEmail: 'contact@example.invalid' });

  let locations = 0;
  const loc = (siteId: string, code: string, name: string, kind: string, parentId?: string) => {
    locations += 1;
    return id(make('location', { siteKind: 'ship', siteId, code, name, kind, ...(parentId ? { parentId } : {}) }));
  };
  for (const ship of ships) {
    const sid = id(ship);
    const main = loc(sid, 'MAIN', 'Main Deck', 'deck');
    const lower = loc(sid, 'LOWER', 'Lower Deck', 'deck');
    loc(sid, 'BRIDGE', 'Bridge', 'compartment', main);
    const er = loc(sid, 'ER', 'Engine Room', 'compartment', lower);
    loc(sid, 'ER-PS', 'Engine Room Port Side', 'space', er);
    loc(sid, 'GEN', 'Generator Room', 'compartment', lower);
  }
  return { commands: commands.length, ships: ships.length, locations };
}
