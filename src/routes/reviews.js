'use strict';
// Ratings: one per account (1-5 stars and a few words), changeable; the average and the spread are shown to
// everyone. The administration can hide a review (it stops counting).
const { HttpError, json, readJson } = require('../http');
const sec = require('../security');
const { currentUser, requireActive, requireAdmin } = require('./auth');

function register(router, ctx) {
  const { db, cfg } = ctx;
  const L = new sec.RateLimiter(10, 3600000);

  function summary() {
    const rows = db.all('SELECT stars, COUNT(*) AS n FROM reviews WHERE hidden = 0 GROUP BY stars');
    const dist = [0, 0, 0, 0, 0];
    let count = 0, sum = 0;
    for (const r of rows) { dist[r.stars - 1] = r.n; count += r.n; sum += r.stars * r.n; }
    return { count, average: count ? Math.round((sum / count) * 10) / 10 : 0, dist };
  }

  router.on('GET', '/api/reviews', (req, res) => {
    const u = currentUser(req, ctx);
    const admin = u?.role === 'admin';
    const list = db.all(`SELECT r.user_id, r.stars, r.text, r.created, r.updated, r.hidden, u.nick FROM reviews r
      JOIN users u ON u.id = r.user_id ${admin ? '' : 'WHERE r.hidden = 0'} ORDER BY r.updated DESC LIMIT 100`);
    const mine = u ? db.get('SELECT stars, text, hidden FROM reviews WHERE user_id = ?', u.id) : null;
    json(res, 200, {
      summary: summary(),
      reviews: list.map((r) => ({ user: { id: r.user_id, nick: r.nick }, stars: r.stars, text: r.text, created: r.created, updated: r.updated, hidden: Boolean(r.hidden) })),
      mine: mine ? { stars: mine.stars, text: mine.text, hidden: Boolean(mine.hidden) } : null,
    });
  });

  router.on('GET', '/api/reviews/summary', (req, res) => json(res, 200, summary()));

  router.on('PUT', '/api/reviews/mine', async (req, res) => {
    sec.checkOrigin(req, cfg);
    const u = requireActive(req, ctx);
    sec.limit(L, 'u' + u.id, 'отзывы');
    const b = await readJson(req, 8192);
    const stars = Number(b.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, 'Поставь от 1 до 5 звёзд', 'stars');
    const text = sec.cleanText(b.text, 1000, { multiline: true, maxLines: 20 });
    const now = Date.now();
    db.run(`INSERT INTO reviews (user_id, stars, text, created, updated) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET stars = excluded.stars, text = excluded.text, updated = excluded.updated`, u.id, stars, text, now, now);
    json(res, 200, { ok: true, summary: summary() });
  });

  router.on('DELETE', '/api/reviews/mine', (req, res) => {
    sec.checkOrigin(req, cfg);
    const u = requireActive(req, ctx);
    db.run('DELETE FROM reviews WHERE user_id = ?', u.id);
    json(res, 200, { ok: true, summary: summary() });
  });

  router.on('POST', '/api/reviews/:userId/hide', async (req, res, p) => {
    sec.checkOrigin(req, cfg);
    const admin = requireAdmin(req, ctx);
    const b = await readJson(req);
    const r = db.run('UPDATE reviews SET hidden = ? WHERE user_id = ?', b.hidden ? 1 : 0, Number(p.userId));
    if (!r.changes) throw new HttpError(404, 'Отзыв не найден');
    db.audit(admin.id, b.hidden ? 'review.hide' : 'review.show', p.userId);
    json(res, 200, { ok: true });
  });
}

module.exports = { register };
