'use strict';
// A consistent copy of the database while the site runs (SQLite's online backup), into a folder:
//   node scripts/backup.js <folder>          (the server's daily backup runs it, deploy/backup.sh)
// The uploaded files are copied by the caller (they never change once written).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const { load } = require('../src/config');

(async () => {
  const cfg = load();
  const dir = path.resolve(process.argv[2] || path.join(cfg.dataDir, 'backups'));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(dir, `site-${stamp}.db`);
  const db = new DatabaseSync(path.join(cfg.dataDir, 'site.db'), { readOnly: true });
  const pages = await backup(db, dest);
  db.close();
  console.log(`backup: ${dest} (${pages} pages)`);
})().catch((e) => { console.error(e); process.exit(1); });
