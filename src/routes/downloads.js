'use strict';
// The game's files: whatever downloads/manifest.json lists and is really in downloads/. Each file's size and
// SHA-256 are worked out once at the start (so players can check what they got), and downloads are counted
// per day (no personal data kept).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { HttpError, json, streamFile, inside } = require('../http');

function register(router, ctx) {
  const { cfg, db } = ctx;
  let items = [];

  function load() {
    const p = path.join(cfg.downloadsDir, 'manifest.json');
    let list = [];
    try { list = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    items = list.filter((x) => x && typeof x.file === 'string' && /^[\w.\- ()]+$/.test(x.file)).map((x) => {
      const file = inside(cfg.downloadsDir, x.file);
      let size = 0;
      try { size = file ? fs.statSync(file).size : 0; } catch { size = 0; }
      return { file: x.file, title: String(x.title || x.file), version: String(x.version || cfg.game.version), platform: String(x.platform || 'Windows'),
        notes: String(x.notes || ''), released: String(x.released || ''), size, sha256: '', available: size > 0, path: file };
    });
    // checksums in the background (a big archive takes a few seconds)
    for (const it of items) {
      if (!it.available) continue;
      const h = crypto.createHash('sha256');
      fs.createReadStream(it.path).on('data', (c) => h.update(c)).on('end', () => { it.sha256 = h.digest('hex'); }).on('error', () => {});
    }
  }
  load();
  fs.watch(cfg.downloadsDir, { persistent: false }, () => { clearTimeout(load.t); load.t = setTimeout(load, 1500); });

  router.on('GET', '/api/downloads', (req, res) => {
    const total = db.get('SELECT COUNT(*) AS n FROM downloads').n;
    json(res, 200, {
      version: cfg.game.version,
      requirements: cfg.game.requirements,
      total,
      files: items.map(({ path: _p, ...pub }) => pub),
    });
  });

  router.on('GET', '/download/:file', (req, res, p) => {
    const it = items.find((x) => x.file === p.file && x.available);
    if (!it) throw new HttpError(404, 'Файл пока не выложен');
    let st;
    try { st = fs.statSync(it.path); } catch { throw new HttpError(404, 'Файл пока не выложен'); }
    // one count per download started from the beginning (resumed parts are not counted again)
    if (req.method === 'GET' && (!req.headers.range || /^bytes=0-/.test(req.headers.range))) db.run('INSERT INTO downloads (file, day) VALUES (?, ?)', it.file, new Date().toISOString().slice(0, 10));
    streamFile(req, res, it.path, st.size, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${it.file}"`,
      'Cache-Control': 'public, max-age=3600',
    });
  });
}

module.exports = { register };
