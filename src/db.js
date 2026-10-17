'use strict';
// The database: SQLite built into Node (node:sqlite), one file in data/. Every query is a prepared statement
// with bound values (no SQL is ever built from what people type).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  nick TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created INTEGER NOT NULL,
  banned_until INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT NOT NULL DEFAULT '',
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bugs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bugs_user ON bugs(user_id);
CREATE TABLE IF NOT EXISTS bug_files (
  id TEXT PRIMARY KEY,
  bug_id INTEGER NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  name TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bug_files_bug ON bug_files(bug_id);
CREATE TABLE IF NOT EXISTS reviews (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY,
  file TEXT NOT NULL,
  day TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL
);
`;

function open(cfg) {
  fs.mkdirSync(cfg.uploadsDir, { recursive: true });
  const db = new DatabaseSync(path.join(cfg.dataDir, 'site.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  const cache = new Map();
  // prepared statements, kept
  const q = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  return {
    raw: db,
    get: (sql, ...args) => q(sql).get(...args),
    all: (sql, ...args) => q(sql).all(...args),
    run: (sql, ...args) => q(sql).run(...args),
    tx(fn) {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    audit(userId, action, detail = '') {
      q('INSERT INTO audit (user_id, action, detail, created) VALUES (?, ?, ?, ?)').run(userId ?? null, action, String(detail).slice(0, 500), Date.now());
    },
  };
}

module.exports = { open };
