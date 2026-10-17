'use strict';
// School Riot - the game's website. One Node.js process, no third-party packages:
//   npm start            (http://localhost:8080; settings in site.config.json)
// Pages and their files are in public/, the game's builds in downloads/, the database and uploaded files in
// data/ (made on the first start; keep it out of public folders and back it up).
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { load } = require('./src/config');
const { open } = require('./src/db');
const { HttpError, json, Router, serveStatic } = require('./src/http');
const sec = require('./src/security');

const cfg = load();
fs.mkdirSync(cfg.downloadsDir, { recursive: true });
const db = open(cfg);
const ctx = { cfg, db, secret: sec.loadSecret(cfg.dataDir), chat: null };

const router = new Router();
require('./src/routes/auth').register(router, ctx);
require('./src/routes/chat').register(router, ctx);
require('./src/routes/bugs').register(router, ctx);
require('./src/routes/reviews').register(router, ctx);
require('./src/routes/downloads').register(router, ctx);
require('./src/routes/admin').register(router, ctx);

// what the pages need to know about the site: its links and the game's version
router.on('GET', '/api/site', (req, res) => {
  json(res, 200, {
    version: cfg.game.version,
    youtube: cfg.youtube.channel,
    trailerId: cfg.youtube.trailerId,
    instagram: cfg.instagram,
    limits: { imageMB: cfg.limits.imageMB, videoMB: cfg.limits.videoMB, filesPerReport: cfg.limits.filesPerReport },
  });
});

// a general limit per address against floods (pages and their files are not counted)
const flood = new sec.RateLimiter(300, 60000);

async function handle(req, res) {
  sec.securityHeaders(res, req, cfg);
  let url;
  try { url = new URL(req.url, 'http://local'); } catch { throw new HttpError(400, 'Неверный адрес'); }
  const pathname = url.pathname;
  const api = pathname.startsWith('/api/') || pathname.startsWith('/media/') || pathname.startsWith('/download/');
  if (api) {
    if (!pathname.startsWith('/api/chat/stream')) sec.limit(flood, sec.clientIp(req, cfg), 'запросы');
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const m = router.match(method, pathname);
    if (m === 'method') throw new HttpError(405, 'Метод не поддерживается');
    if (!m) throw new HttpError(404, 'Не найдено');
    await m.handler(req, res, m.params);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается');
  if (serveStatic(req, res, cfg, pathname)) return;
  // not a page: the site's own "not found" page
  if (!serveStatic(req, res, cfg, '/404', 404)) json(res, 404, { error: 'Не найдено' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(new Date().toISOString(), req.method, req.url, e);
    if (res.headersSent) { res.destroy(); return; }
    json(res, status, { error: status === 500 ? 'Ошибка на сервере. Попробуй ещё раз.' : e.message, code: e.code || '' }, e.headers || {});
  });
});
// slow or stalled requests are cut off (uploads of big videos still have a quarter of an hour)
server.headersTimeout = 20000;
server.requestTimeout = 15 * 60000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 60;

server.listen(cfg.port, cfg.host, () => {
  console.log(`School Riot site: http://localhost:${cfg.port}  (data: ${path.relative(process.cwd(), cfg.dataDir) || cfg.dataDir})`);
  if (process.env.ADMIN_NICK) {
    db.run("UPDATE users SET role = 'admin', banned_until = 0 WHERE nick = ? COLLATE NOCASE", process.env.ADMIN_NICK.trim());
  }
  if (!db.get("SELECT 1 FROM users WHERE role = 'admin'")) console.log('No administrator yet: register an account on the site (the first user becomes admin).');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    try { db.raw.close(); } catch { /* closing anyway */ }
    process.exit(0);
  });
}
