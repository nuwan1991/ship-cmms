/**
 * Installer and recovery commands. Run with the application stopped unless noted.
 *   npm run ops -- check                                   look at the machine: Node version, data folder, disk space, web app
 *   npm run ops -- setup --kind hub --code HQ --name "Fleet HQ" --admin admin [--password ...]
 *   npm run ops -- status                                  (also while running)
 *   npm run ops -- backup                                  (also while running)
 *   npm run ops -- backups                                 list backup files
 *   npm run ops -- verify --file <backup.sqlite>           check a backup without restoring it
 *   npm run ops -- restore --file <backup.sqlite> [--allow-other-installation]
 *   npm run ops -- integrity                               (also while running)
 */
import { randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { boot } from './boot.js';
import { createFirstAdmin } from './modules/m02-identity/bootstrap.js';
import { backupDirOf, createBackup, filesOnDisk, opsStatus, restoreBackup, runIntegrity, verifyBackupFile } from './modules/m14-operations/index.js';
import { INSTALLATION_KINDS } from './platform/contracts.js';
import { loadConfig } from './platform/config.js';
import { setLocalIdentity } from './platform/identity.js';
import { uuidv7 } from './platform/ids.js';
import { createRecord } from './platform/records.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { kind: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, id: { type: 'string' }, admin: { type: 'string' }, password: { type: 'string' }, file: { type: 'string' }, 'allow-other-installation': { type: 'boolean' } },
});
const cmd = positionals[0];
const config = loadConfig();
const say = (o: unknown): void => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2));
const fail = (m: string, code = 1): never => { console.error(m); process.exit(code); };

async function main(): Promise<void> {
  if (cmd === 'check') {
    const problems: string[] = [];
    const major = Number(process.versions.node.split('.')[0]);
    const [maj, min] = process.versions.node.split('.').map(Number) as [number, number];
    if (maj !== 22 || min < 12) problems.push(`Node ${process.versions.node} is not supported; install Node 22.12 or a later 22.x`);
    try { mkdirSync(config.dataDir, { recursive: true }); accessSync(config.dataDir, constants.W_OK); say(`Data folder: ${config.dataDir} (writable)`); } catch { problems.push(`Data folder ${config.dataDir} is not writable`); }
    try { const s = statfsSync(config.dataDir); const free = Number(s.bavail) * Number(s.bsize); say(`Free disk space: ${(free / 1e9).toFixed(1)} GB`); if (free < 1e9) problems.push('Less than 1 GB of free disk space'); } catch { say('Free disk space: unknown on this system'); }
    const web = process.env.CMMS_WEB_DIR ?? join(process.cwd(), 'web', 'dist');
    say(existsSync(join(web, 'index.html')) ? `Web app: built (${web})` : 'Web app: not built (run npm run web:build); the API still works');
    say(`Database file: ${config.dbFile}${existsSync(config.dbFile) ? ' (exists)' : ' (will be created)'}`);
    void major;
    if (problems.length) fail(`Problems:\n  ${problems.join('\n  ')}`);
    say('The machine is ready.');
  } else if (cmd === 'setup') {
    if (!values.kind || !values.code || !values.name || !INSTALLATION_KINDS.includes(values.kind as never)) fail('Usage: npm run ops -- setup --kind hub --code <CODE> --name "<Name>" --admin <username> [--password <10+ chars>]\n(Ships, commands and workshops are created by the hub: use "npm run sync -- join".)', 2);
    if (values.kind !== 'hub') fail('Only the hub is set up here. A ship, command or workshop receives its identity from the hub: ask the hub administrator for a provisioning package and run "npm run sync -- join --package <file>".', 2);
    const { ctx } = boot(config);
    if (ctx.identity) say(`Already initialized as ${ctx.identity.kind} ${ctx.identity.code}.`);
    else {
      const identity = setLocalIdentity(ctx.db, { kind: 'hub', code: values.code!, name: values.name! });
      ctx.identity = identity;
      createRecord({ db: ctx.db, registry: ctx.entities, installation: identity, actor: { userId: 'system' }, correlationId: uuidv7() }, 'sys.installation', { id: identity.installationId, kind: 'hub', code: identity.code, name: identity.name });
      say(`Initialized hub ${identity.code} (${identity.installationId})`);
    }
    if (values.admin) {
      const password = values.password ?? randomBytes(12).toString('base64url');
      try {
        await createFirstAdmin(ctx, { username: values.admin, password, displayName: values.admin });
        say(`Created administrator "${values.admin}".${values.password ? '' : ` Initial password (shown once, change it after signing in): ${password}`}`);
      } catch (e) { say(`Administrator not created: ${(e as Error).message}`); }
    }
    say('Next: npm run web:build (once), then npm run build:server and npm start (or npm run dev while developing).');
    ctx.db.close();
  } else if (cmd === 'status' || cmd === 'backup' || cmd === 'integrity') {
    const { ctx } = boot(config);
    if (cmd === 'status') say(opsStatus(ctx));
    else if (cmd === 'backup') { const m = createBackup(ctx, 'manual', 'cli'); say(`Backup written: ${join(backupDirOf(config.dataDir), m.fileName)} (${m.bytes} bytes, SHA-256 ${m.sha256.slice(0, 16)}…)`); }
    else { const r = runIntegrity(ctx, 'cli'); say(r.ok ? `No errors (${r.findings.length} warning group(s)).` : 'Errors found.'); say(r.findings); if (!r.ok) process.exitCode = 1; }
    ctx.db.close();
  } else if (cmd === 'backups') {
    const files = filesOnDisk(config.dataDir);
    say(files.length ? files.map((f) => join(backupDirOf(config.dataDir), f)).join('\n') : `No backups in ${backupDirOf(config.dataDir)}`);
  } else if (cmd === 'verify') {
    if (!values.file) fail('--file is required', 2);
    const r = verifyBackupFile(values.file!);
    say(r.ok ? `OK: ${values.file} can be restored${r.manifest ? ` (made ${r.manifest.createdAt}, ${r.manifest.installationCode ?? 'no identity'})` : ''}.` : `NOT USABLE:\n  ${r.problems.join('\n  ')}`);
    if (!r.ok) process.exitCode = 1;
  } else if (cmd === 'restore') {
    if (!values.file) fail('--file is required', 2);
    const r = restoreBackup({ dbFile: config.dbFile, dataDir: config.dataDir, backupFile: values.file!, ...(values['allow-other-installation'] ? { allowOtherInstallation: true } : {}) });
    say(`Restored ${r.restoredFrom}.${r.safetyBackup ? ` The previous database was kept as ${join(backupDirOf(config.dataDir), r.safetyBackup)}.` : ''}`);
    say('Start the application, then run a synchronization: the hub tells this installation what it already holds, and anything newer is sent again. Do not hand out new number ranges until every installation has synchronized.');
  } else {
    say('Usage: npm run ops -- check | setup | status | backup | backups | verify | restore | integrity (see the header of src/ops-cli.ts)');
    process.exitCode = 2;
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
