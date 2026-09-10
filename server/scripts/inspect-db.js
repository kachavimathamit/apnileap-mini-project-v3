/**
 * Prints the current state of the operational database: file, integrity, schema
 * and row counts. Read-only — safe to run while the API is serving.
 *
 *   npm run db:inspect
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../src/config.js';

if (!fs.existsSync(config.databaseFile)) {
  console.error(`No database at ${config.databaseFile}`);
  console.error('Run `npm run seed` to create and populate it.');
  process.exit(1);
}

const db = new Database(config.databaseFile, { readonly: true, fileMustExist: true });

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((row) => row.name);

const indexCount = db
  .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
  .get().n;

const triggers = db
  .prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
  .all()
  .map((row) => row.name);

console.log('DATABASE');
console.log(`  path           ${config.databaseFile}`);
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${config.databaseFile}${suffix}`;
  if (fs.existsSync(file)) {
    console.log(`  ${path.basename(file).padEnd(14)} ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
  }
}
console.log(`  journal mode   ${db.pragma('journal_mode', { simple: true })}`);
console.log(`  integrity      ${db.pragma('integrity_check', { simple: true })}`);
console.log(`  fk violations  ${db.pragma('foreign_key_check').length}`);
console.log(`  indexes        ${indexCount}`);

console.log(`\nTABLES (${tables.length})`);
let total = 0;
for (const table of tables) {
  const rows = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
  const cols = db.prepare('SELECT COUNT(*) AS n FROM pragma_table_info(?)').get(table).n;
  total += rows;
  console.log(`  ${table.padEnd(24)} ${String(rows).padStart(5)} rows  ${String(cols).padStart(2)} cols`);
}
console.log(`  ${''.padEnd(24)} ${String(total).padStart(5)} rows total`);

console.log(`\nAPPEND-ONLY TRIGGERS (${triggers.length})`);
for (const trigger of triggers) console.log(`  ${trigger}`);

console.log('\nCONTENT');
console.log('  institutes:');
for (const row of db.prepare('SELECT code, short_name FROM institutes ORDER BY code').all()) {
  console.log(`    ${row.code.padEnd(8)} ${row.short_name}`);
}
console.log('  roles granted:');
for (const row of db.prepare('SELECT role, COUNT(*) AS n FROM access_grants WHERE is_active = 1 GROUP BY role ORDER BY role').all()) {
  console.log(`    ${row.role.padEnd(26)} ${row.n}`);
}
console.log('  active projects by status:');
for (const row of db.prepare("SELECT rag_status, COUNT(*) AS n FROM projects WHERE is_archived = 0 GROUP BY rag_status ORDER BY rag_status").all()) {
  console.log(`    ${row.rag_status.padEnd(8)} ${row.n}`);
}

db.close();
