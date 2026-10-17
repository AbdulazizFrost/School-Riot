'use strict';
// Bug reports: a title, what happened, the game's version, and up to a few photos / videos. A report and its
// files are seen by the one who sent it and by the administration only.
// Files are checked by their contents (the first bytes), not by their name or the type the browser claims;
// they are stored under random names outside the site's folder and only ever served as the image / video they are.
const fs = require('node:fs');
const path = require('node:path');
const { HttpError, json, readJson, streamFile } = require('../http');
const sec = require('../security');
const { currentUser, requireActive, requireAdmin } = require('./auth');

const STATUSES = ['new', 'seen', 'progress', 'fixed', 'wontfix'];

/** What a file really is, from its first bytes. */
function sniff(head) {
  const b = head;
  const ascii = (s, e) => b.subarray(s, e).toString('latin1');
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mime: 'image/png' };
  if (b.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return { kind: 'image', mime: 'image/gif' };
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (b.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime' };
    return { kind: 'video', mime: 'video/mp4' };
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', mime: 'video/webm' };
  return null;
}

function register(router, ctx) {
  const { cfg, db } = ctx;
  const L = { report: new sec.RateLimiter(8, 3600000), upload: new sec.RateLimiter(30, 3600000) };
  const MB = 1024 * 1024;

  function bugFor(req, id) {
    const u = currentUser(req, ctx);
    if (!u) throw new HttpError(401, 'Войди в аккаунт', 'auth');
    const bug = db.get('SELECT * FROM bugs WHERE id = ?', id);
    if (!bug || (bug.user_id !== u.id && u.role !== 'admin')) throw new HttpError(404, 'Отчёт не найден');
    return { u, bug };
  }

  const view = (b) => ({
    id: b.id, title: b.title, body: b.body, version: b.version, status: b.status, created: b.created, updated: b.updated,
    user: { id: b.user_id, nick: b.nick },
    files: db.all('SELECT id, kind, mime, size, name FROM bug_files WHERE bug_id = ? ORDER BY created', b.id),
  });

  router.on('POST', '/api/bugs', async (req, res) => {
    sec.checkOrigin(req, cfg);
    const u = requireActive(req, ctx);
    sec.limit(L.report, 'u' + u.id, 'отчёты');
    const b = await readJson(req, 16 * 1024);
    const title = sec.cleanText(b.title, 120);
    const body = sec.cleanText(b.body, 4000, { multiline: true, maxLines: 60 });
    const version = sec.cleanText(b.version, 20);
    if (title.length < 4) throw new HttpError(400, 'Опиши баг в заголовке (хотя бы пара слов)', 'title');
    if (body.length < 10) throw new HttpError(400, 'Расскажи подробнее: что делал и что пошло не так', 'body');
    const now = Date.now();
    const id = Number(db.run('INSERT INTO bugs (user_id, title, body, version, created, updated) VALUES (?, ?, ?, ?, ?, ?)',
      u.id, title, body, version, now, now).lastInsertRowid);
    json(res, 201, { id });
  });

  // one file per request: the raw bytes as the body, its name in X-File-Name
  router.on('PUT', '/api/bugs/:id/files', async (req, res, p) => {
    sec.checkOrigin(req, cfg);
    const u = requireActive(req, ctx);
    const id = Number(p.id);
    const bug = Number.isInteger(id) ? db.get('SELECT * FROM bugs WHERE id = ?', id) : null;
    if (!bug || bug.user_id !== u.id) throw new HttpError(404, 'Отчёт не найден');
    if (Date.now() - bug.created > 3600000) throw new HttpError(400, 'Файлы добавляются в течение часа после отправки отчёта');
    sec.limit(L.upload, 'u' + u.id, 'загрузка файлов');
    const count = db.get('SELECT COUNT(*) AS n FROM bug_files WHERE bug_id = ?', id).n;
    if (count >= cfg.limits.filesPerReport) throw new HttpError(400, `Не больше ${cfg.limits.filesPerReport} файлов в одном отчёте`);
    const length = Number(req.headers['content-length']);
    const maxAny = Math.max(cfg.limits.imageMB, cfg.limits.videoMB) * MB;
    if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, 'Нужен размер файла');
    if (length > maxAny) throw new HttpError(413, `Файл больше ${cfg.limits.videoMB} МБ`);
    const today = db.get('SELECT COALESCE(SUM(size), 0) AS s FROM bug_files WHERE user_id = ? AND created > ?', u.id, Date.now() - 86400000).s;
    if (today + length > cfg.limits.uploadMBPerDay * MB) throw new HttpError(413, 'Лимит загрузок на сегодня исчерпан');
    let name = '';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { name = ''; }
    name = sec.cleanText(name, 80).replace(/[\\/]/g, '_') || 'файл';

    const fileId = sec.randomToken(18);
    const tmp = path.join(cfg.uploadsDir, `tmp-${fileId}`);
    const out = fs.createWriteStream(tmp, { flags: 'wx' });
    let size = 0, kind = null, head = Buffer.alloc(0), failed = false;
    try {
      await new Promise((resolve, reject) => {
        // (the rest of a refused upload is read and dropped, so the answer still reaches the page)
        const fail = (e) => { if (failed) return; failed = true; req.resume(); out.destroy(); reject(e); };
        req.on('data', (chunk) => {
          if (failed) return;
          size += chunk.length;
          if (!kind) {
            head = Buffer.concat([head, chunk]).subarray(0, 64);
            if (head.length >= 12 || size >= length) {
              kind = sniff(head);
              if (!kind) return fail(new HttpError(415, 'Можно только фото (JPG, PNG, GIF, WebP) и видео (MP4, MOV, WebM)'));
            }
          }
          const max = (kind?.kind === 'image' ? cfg.limits.imageMB : cfg.limits.videoMB) * MB;
          if (size > max || size > length) return fail(new HttpError(413, kind?.kind === 'image' ? `Фото больше ${cfg.limits.imageMB} МБ` : `Видео больше ${cfg.limits.videoMB} МБ`));
          if (!out.write(chunk)) { req.pause(); out.once('drain', () => req.resume()); }
        });
        req.on('end', () => {
          if (failed) return;
          if (!kind) kind = sniff(head);
          if (!kind) return fail(new HttpError(415, 'Можно только фото и видео'));
          if (size !== length) return fail(new HttpError(400, 'Файл пришёл не полностью'));
          out.end(resolve);
        });
        req.on('error', fail);
        out.on('error', fail);
      });
      fs.renameSync(tmp, path.join(cfg.uploadsDir, fileId));
    } catch (e) {
      fs.rm(tmp, { force: true }, () => {});
      throw e;
    }
    db.run('INSERT INTO bug_files (id, bug_id, user_id, kind, mime, size, name, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      fileId, id, u.id, kind.kind, kind.mime, size, name, Date.now());
    json(res, 201, { file: { id: fileId, kind: kind.kind, mime: kind.mime, size, name } });
  });

  router.on('GET', '/api/bugs', (req, res) => {
    const u = currentUser(req, ctx);
    if (!u) throw new HttpError(401, 'Войди в аккаунт', 'auth');
    const url = new URL(req.url, 'http://x');
    const all = url.searchParams.get('all') === '1' && u.role === 'admin';
    const status = url.searchParams.get('status');
    let list;
    if (all) {
      list = STATUSES.includes(status)
        ? db.all('SELECT b.*, u.nick FROM bugs b JOIN users u ON u.id = b.user_id WHERE b.status = ? ORDER BY b.id DESC LIMIT 200', status)
        : db.all('SELECT b.*, u.nick FROM bugs b JOIN users u ON u.id = b.user_id ORDER BY b.id DESC LIMIT 200');
    } else {
      list = db.all('SELECT b.*, u.nick FROM bugs b JOIN users u ON u.id = b.user_id WHERE b.user_id = ? ORDER BY b.id DESC LIMIT 100', u.id);
    }
    json(res, 200, { bugs: list.map(view) });
  });

  router.on('PATCH', '/api/bugs/:id', async (req, res, p) => {
    sec.checkOrigin(req, cfg);
    const admin = requireAdmin(req, ctx);
    const b = await readJson(req);
    if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Неизвестный статус');
    const r = db.run('UPDATE bugs SET status = ?, updated = ? WHERE id = ?', b.status, Date.now(), Number(p.id));
    if (!r.changes) throw new HttpError(404, 'Отчёт не найден');
    db.audit(admin.id, 'bug.status', `${p.id} ${b.status}`);
    json(res, 200, { ok: true });
  });

  router.on('DELETE', '/api/bugs/:id', (req, res, p) => {
    sec.checkOrigin(req, cfg);
    const { u, bug } = bugFor(req, Number(p.id));
    const files = db.all('SELECT id FROM bug_files WHERE bug_id = ?', bug.id);
    db.run('DELETE FROM bugs WHERE id = ?', bug.id);
    for (const f of files) fs.rm(path.join(cfg.uploadsDir, f.id), { force: true }, () => {});
    db.audit(u.id, 'bug.delete', bug.id);
    json(res, 200, { ok: true });
  });

  // a report's photo / video: to its author and the administration only, always as what it was checked to be
  router.on('GET', '/media/:id', (req, res, p) => {
    const u = currentUser(req, ctx);
    if (!u || !/^[A-Za-z0-9_-]{10,40}$/.test(p.id)) throw new HttpError(404, 'Нет такого файла');
    const f = db.get('SELECT * FROM bug_files WHERE id = ?', p.id);
    if (!f || (f.user_id !== u.id && u.role !== 'admin')) throw new HttpError(404, 'Нет такого файла');
    const file = path.join(cfg.uploadsDir, f.id);
    let st;
    try { st = fs.statSync(file); } catch { throw new HttpError(404, 'Нет такого файла'); }
    streamFile(req, res, file, st.size, {
      'Content-Type': f.mime,
      'Cache-Control': 'private, max-age=600',
      'Content-Disposition': `inline; filename="file"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      // (opened on its own, the browser's image / video viewer may style itself; scripts stay off: sandbox)
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
  });
}

module.exports = { register, sniff };
