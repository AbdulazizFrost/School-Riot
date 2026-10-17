'use strict';
// The live chat: everyone can read it, accounts can write. New messages reach the open pages at once over
// Server-Sent Events (one long HTTP response per page, no extra libraries). The administration can delete a
// message; it disappears on every open page.
const { HttpError, json, readJson } = require('../http');
const sec = require('../security');
const { currentUser, requireActive, requireAdmin } = require('./auth');

const MAX_LEN = 300;
const HISTORY = 80;

function register(router, ctx) {
  const clients = new Set();
  const perIp = new Map();
  const L = { burst: new sec.RateLimiter(1, 1500), minute: new sec.RateLimiter(15, 60000) };

  function send(client, event, data) {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function broadcast(event, data) {
    for (const c of clients) send(c, event, data);
  }
  function online() { return clients.size; }

  const row = (m) => ({ id: m.id, text: m.text, created: m.created, user: { id: m.user_id, nick: m.nick, role: m.role } });

  ctx.chat = {
    online,
    removedUser(userId) { broadcast('purge', { userId }); },
  };

  router.on('GET', '/api/chat', (req, res) => {
    const list = ctx.db.all(`SELECT m.id, m.text, m.created, m.user_id, u.nick, u.role FROM messages m
      JOIN users u ON u.id = m.user_id WHERE m.deleted = 0 ORDER BY m.id DESC LIMIT ?`, HISTORY).reverse();
    json(res, 200, { messages: list.map(row), online: online() });
  });

  router.on('GET', '/api/chat/stream', (req, res) => {
    const ip = sec.clientIp(req, ctx.cfg);
    const n = perIp.get(ip) || 0;
    if (n >= 6 || clients.size >= 2000) throw new HttpError(429, 'Слишком много открытых окон чата', 'rate');
    perIp.set(ip, n + 1);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',   // nginx: pass events through at once
    });
    res.write('retry: 4000\n\n');
    const client = { res };
    clients.add(client);
    broadcast('online', { online: online() });
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(client);
      const left = (perIp.get(ip) || 1) - 1;
      if (left <= 0) perIp.delete(ip); else perIp.set(ip, left);
      broadcast('online', { online: online() });
    });
  });

  router.on('POST', '/api/chat', async (req, res) => {
    sec.checkOrigin(req, ctx.cfg);
    const u = requireActive(req, ctx);
    sec.limit(L.burst, 'u' + u.id, 'сообщения');
    sec.limit(L.minute, 'u' + u.id, 'сообщения');
    const b = await readJson(req, 4096);
    const text = sec.cleanText(b.text, MAX_LEN, { multiline: true, maxLines: 4 });
    if (!text) throw new HttpError(400, 'Пустое сообщение', 'text');
    const created = Date.now();
    const id = Number(ctx.db.run('INSERT INTO messages (user_id, text, created) VALUES (?, ?, ?)', u.id, text, created).lastInsertRowid);
    const msg = { id, text, created, user: { id: u.id, nick: u.nick, role: u.role } };
    broadcast('message', msg);
    json(res, 201, { message: msg });
  });

  router.on('DELETE', '/api/chat/:id', (req, res, p) => {
    sec.checkOrigin(req, ctx.cfg);
    const admin = requireAdmin(req, ctx);
    const id = Number(p.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Неверный номер');
    ctx.db.run('UPDATE messages SET deleted = 1 WHERE id = ?', id);
    ctx.db.audit(admin.id, 'chat.delete', id);
    broadcast('delete', { id });
    json(res, 200, { ok: true });
  });

  // so the page knows whether it may write (and as whom) without another request
  router.on('GET', '/api/chat/me', (req, res) => {
    const u = currentUser(req, ctx);
    json(res, 200, { canWrite: Boolean(u && u.bannedUntil <= Date.now()), admin: u?.role === 'admin' });
  });
}

module.exports = { register };
