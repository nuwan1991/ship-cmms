import { loadConfig } from './platform/config.js';
import { upgradeWithBackup } from './modules/m14-operations/index.js';
import { openDatabase } from './platform/db/open.js';

const cfg = loadConfig();
const db = openDatabase(cfg.dbFile);
const { applied, backup } = upgradeWithBackup(db, cfg.dataDir);
if (backup) console.log(`Backed up first: ${backup.fileName}`);
console.log(applied.length ? `Applied:\n  ${applied.join('\n  ')}` : 'Database is up to date.');
db.close();
