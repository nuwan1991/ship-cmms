/**
 * Office (M15) setup. Lives at the composition level because it writes M02 roles from M15's role data (D71).
 *   npm run office -- setup [--numbers 5000]    define office numbering, give this installation numbers, create/refresh the 5 office roles
 *   npm run office -- roles                     list the office roles and their permissions
 * Safe to repeat: existing roles keep their extra permissions; missing ones are added.
 */
import { parseArgs } from 'node:util';
import { boot } from './boot.js';
import { OFFICE_ROLES, OFFICE_SEQUENCES, ensureOfficeSequences } from './modules/m15-office/index.js';
import { loadConfig } from './platform/config.js';
import { uuidv7 } from './platform/ids.js';
import { grantRange, rangeRemaining } from './platform/ranges.js';
import { createRecord, tombstoneRecord, type WriteContext } from './platform/records.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { numbers: { type: 'string' } } });
const cmd = positionals[0];
const { ctx } = boot(loadConfig());

function setup(w: WriteContext, numbers: number): void {
  const made = ensureOfficeSequences(w);
  console.log(made.length ? `Defined numbering: ${made.join(', ')}` : 'Office numbering already defined');
  for (const s of OFFICE_SEQUENCES) {
    if (rangeRemaining(w.db, w.installation, s.code) > 0) continue;
    grantRange(w, { sequenceCode: s.code, installationId: w.installation.installationId, size: numbers });
    console.log(`  ${s.code}: ${numbers} numbers granted to this installation`);
  }
  for (const r of OFFICE_ROLES) {
    let role = w.db.prepare('SELECT id FROM idn_role WHERE code = ? AND deleted_at IS NULL').get(r.code) as { id: string } | undefined;
    if (!role) {
      role = { id: createRecord(w, 'idn.role', { code: r.code, name: r.name, description: r.description }).id as string };
      console.log(`Created role ${r.code} (${r.name})`);
    }
    const have = new Set((w.db.prepare('SELECT permission FROM idn_role_permission WHERE role_id = ? AND deleted_at IS NULL').all(role.id) as Array<{ permission: string }>).map((x) => x.permission));
    // Earlier versions wrote sub-module wildcards (ofc.equipment.*) that M02 does not accept: replace them with explicit codes.
    const bad = w.db.prepare("SELECT id, version, permission FROM idn_role_permission WHERE role_id = ? AND deleted_at IS NULL AND permission LIKE 'ofc.%.*'").all(role.id) as Array<{ id: string; version: number; permission: string }>;
    for (const b of bad) { tombstoneRecord(w, 'idn.role_permission', b.id, b.version, 'Replaced by explicit permission codes'); have.delete(b.permission); }
    if (bad.length) console.log(`  ${r.code}: removed ${bad.map((b) => b.permission).join(', ')}`);
    const missing = r.permissions.filter((p) => !have.has(p));
    for (const p of missing) createRecord(w, 'idn.role_permission', { role_id: role.id, permission: p });
    if (missing.length) console.log(`  ${r.code}: added ${missing.join(', ')}`);
  }
  console.log('Done. Assign the roles to users in Administration > Users, scoped to the dockyard command.');
}

try {
  const me = ctx.identity;
  if (!me) throw new Error('Run init-installation first');
  const w: WriteContext = { db: ctx.db, registry: ctx.entities, installation: me, actor: { userId: 'system', snapshot: { displayName: 'Office setup' } }, correlationId: uuidv7() };
  if (cmd === 'setup') {
    const n = Number(values.numbers ?? 5000);
    if (!Number.isInteger(n) || n < 1) throw new Error('--numbers must be a positive whole number');
    setup(w, n);
  } else if (cmd === 'roles') {
    for (const r of OFFICE_ROLES) console.log(`${r.code}  ${r.name}\n  ${r.description}\n  ${r.permissions.join(', ')}\n`);
  } else {
    console.log('Usage: npm run office -- setup [--numbers 5000] | roles');
    process.exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  ctx.db.close();
}
