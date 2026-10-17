'use strict';
// The administration: numbers at a glance, finding accounts, blocking them for a while (with their chat
// messages removed if wanted), and the log of what the administration did.
const { HttpError, json, readJson } = require('../http');
const sec = require('../security');
const { requireAdmin } = require('./auth');

function register(router, ctx) {
  const { db, cfg } = ctx;

  router.on('GET', '/api/admin/stats', (req, res) => {
    requireAdmin(req, ctx);
    const day = Date.now() - 86400000;
    json(res, 200, {
      users: db.get('SELECT COUNT(*) AS n FROM users').n,
      usersToday: db.get('SELECT COUNT(*) AS n FROM users WHERE created > ?', day).n,
      messagesToday: db.get('SELECT COUNT(*) AS n FROM messages WHERE created > ? AND deleted = 0', day).n,
      bugsNew: db.get("SELECT COUNT(*) AS n FROM bugs WHERE status = 'new'").n,
      bugs: db.get('SELECT COUNT(*) AS n FROM bugs').n,
      reviews: db.get('SELECT COUNT(*) AS n FROM reviews').n,
      downloads: db.get('SELECT COUNT(*) AS n FROM downloads').n,
      downloadsToday: db.get('SELECT COUNT(*) AS n FROM downloads WHERE day = ?', new Date().toISOString().slice(0, 10)).n,
      online: ctx.chat ? ctx.chat.online() : 0,
    });
  });

  router.on('GET', '/api/admin/users', (req, res) => {
    requireAdmin(req, ctx);
    const q = sec.cleanText(new URL(req.url, 'http://x').searchParams.get('q') || '', 20);
    const like = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
    const rows = db.all(`SELECT u.id, u.nick, u.role, u.created, u.banned_until, u.ban_reason,
      (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id AND m.deleted = 0) AS messages,
      (SELECT COUNT(*) FROM bugs b WHERE b.user_id = u.id) AS bugs
      FROM users u WHERE u.nick LIKE ? ESCAPE '\\' ORDER BY u.id DESC LIMIT 100`, like);
    json(res, 200, { users: rows.map((r) => ({ id: r.id, nick: r.nick, role: r.role, created: r.created,
      bannedUntil: r.banned_until > Date.now() ? r.banned_until : 0, banReason: r.ban_reason, messages: r.messages, bugs: r.bugs })) });
  });

  router.on('POST', '/api/admin/users/:id/ban', async (req, res, p) => {
    sec.checkOrigin(req, cfg);
    const admin = requireAdmin(req, ctx);
    const id = Number(p.id);
    const target = db.get('SELECT id, role FROM users WHERE id = ?', id);
    if (!target) throw new HttpError(404, 'Нет такого аккаунта');
    if (target.role === 'admin') throw new HttpError(400, 'Администратора заблокировать нельзя');
    const b = await readJson(req);
    const hours = Number(b.hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 3650) throw new HttpError(400, 'Срок в часах: от 0 (снять) до 10 лет');
    const until = hours === 0 ? 0 : Date.now() + hours * 3600000;
    const reason = sec.cleanText(b.reason, 200);
    db.run('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?', until, reason, id);
    if (hours > 0 && b.purge) {
      db.run('UPDATE messages SET deleted = 1 WHERE user_id = ?', id);
      ctx.chat?.removedUser(id);
    }
    db.audit(admin.id, hours === 0 ? 'unban' : 'ban', `${id} ${hours}h ${reason}`);
    json(res, 200, { ok: true });
  });

  router.on('GET', '/api/admin/audit', (req, res) => {
    requireAdmin(req, ctx);
    const rows = db.all(`SELECT a.id, a.action, a.detail, a.created, u.nick FROM audit a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.action NOT IN ('register') ORDER BY a.id DESC LIMIT 100`);
    json(res, 200, { log: rows });
  });
}

module.exports = { register };
