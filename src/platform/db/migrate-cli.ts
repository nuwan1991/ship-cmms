import { loadConfig } from '../config.js';
import { applyMigrations, discoverMigrations } from './migrate.js';
import { openDatabase } from './open.js';

const cfg = loadConfig();
const db = openDatabase(cfg.dbFile);
const applied = applyMigrations(db, discoverMigrations());
console.log(applied.length ? `Applied:\n  ${applied.join('\n  ')}` : 'Database is up to date.');
db.close();
