/**
 * Command line for provisioning and syncing.
 *   hub:     npm run sync -- provision --kind ship --code SLNS-01 --name "SLNS Example" [--scope <ship uuid>]... [--hub-url http://hub:8080] [--out package.json]
 *   replica: npm run sync -- join --package package.json [--url http://hub:8080]
 *            npm run sync -- run [--url http://hub:8080]
 *   either:  npm run sync -- status | export-bundle [--peer <id>] [--all] --out file | import-bundle --file file
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { boot } from './boot.js';
import { loadConfig } from './platform/config.js';
import { uuidv7 } from './platform/ids.js';
import { exportBundle, httpTransport, hubPeer, importBundle, joinHub, ProvisionInput, provisionPeer, status, syncOnce, type ProvisioningPackage } from './modules/m10-sync/engine.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { kind: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, scope: { type: 'string', multiple: true }, 'hub-url': { type: 'string' }, out: { type: 'string' }, package: { type: 'string' }, url: { type: 'string' }, peer: { type: 'string' }, all: { type: 'boolean' }, file: { type: 'string' } },
});
const cmd = positionals[0];
const { ctx } = boot(loadConfig());
const db = ctx.db;
const write = (path: string | undefined, data: unknown): void => { const text = JSON.stringify(data, null, 2); if (path) { writeFileSync(path, text, { mode: 0o600 }); console.log(`Wrote ${path}`); } else console.log(text); };

try {
  if (cmd === 'provision') {
    const me = ctx.identity;
    if (!me) throw new Error('Run init-installation first');
    const input = ProvisionInput.parse({ kind: values.kind, code: values.code, name: values.name, scopes: (values.scope ?? []).map((id) => ({ kind: values.kind === 'ship' ? 'ship' : values.kind, id })), hubUrl: values['hub-url'] });
    const pkg = provisionPeer(ctx, { db, registry: ctx.entities, installation: me, actor: { userId: 'system' }, correlationId: uuidv7() }, input);
    write(values.out, pkg);
    console.error('The package holds a one-time enrolment secret. Hand it over securely and delete it after use.');
  } else if (cmd === 'join') {
    if (!values.package) throw new Error('--package is required');
    const r = joinHub(ctx, JSON.parse(readFileSync(values.package, 'utf8')) as ProvisioningPackage, values.url);
    console.log(`Joined as installation ${r.installationId}. Now run: npm run sync -- run --url <hub url>   (or exchange bundles)`);
  } else if (cmd === 'run') {
    const hub = hubPeer(db);
    const url = values.url ?? hub?.url;
    if (!url) throw new Error('Give --url of the hub');
    if (values.url && hub) db.prepare('UPDATE syn_peer SET url = ? WHERE installation_id = ?').run(values.url, hub.installation_id);
    console.log(JSON.stringify(await syncOnce(ctx, httpTransport(url)), null, 2));
  } else if (cmd === 'status') {
    console.log(JSON.stringify(status(ctx), null, 2));
  } else if (cmd === 'export-bundle') {
    write(values.out, exportBundle(ctx, { ...(values.peer ? { peerId: values.peer } : {}), ...(values.all ? { all: true } : {}) }));
  } else if (cmd === 'import-bundle') {
    if (!values.file) throw new Error('--file is required');
    console.log(JSON.stringify(importBundle(ctx, JSON.parse(readFileSync(values.file, 'utf8'))), null, 2));
  } else {
    console.error('Usage: npm run sync -- provision|join|run|status|export-bundle|import-bundle (see the header of src/modules/m10-sync/cli.ts)');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
