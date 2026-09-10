/**
 * Deletes the local database file so the portal can be reseeded from scratch.
 * Development helper only - it is deliberately not reachable from the API.
 */
import fs from 'node:fs';
import { config } from '../config.js';

if (config.isProduction) {
  console.error('Refusing to reset the database while NODE_ENV=production.');
  process.exit(1);
}

let removed = 0;
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${config.databaseFile}${suffix}`;
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    removed += 1;
  }
}

console.log(removed ? `Removed ${removed} database file(s): ${config.databaseFile}` : 'No database file found.');
console.log('Run `npm run seed` to recreate the schema and demonstration data.');
