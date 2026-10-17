'use strict';
// Accounts: registration, login, logout, the current user, password change, deleting the account.
// Sessions are random tokens in an HttpOnly cookie; the database keeps only their SHA-256 (a stolen database
// file does not log anyone in).
const fs = require('node:fs');
const path = require('node:path');
const { HttpError, json, readJson } = require('../http');
const sec = require('../security');

const COOKIE = 'sr_session';
const SESSION_DAYS = 30;
const NICK_RE = /^[A-Za-zА-Яа-яЁё0-9_-]{3,20}$/u;
const RESERVED = ['admin', 'administrator', 'moderator', 'support', 'schoolriot', 'school_riot', 'azforge', 'админ',
  'администратор', 'модератор', 'поддержка', 'system', 'система'];
const COMMON = new Set(['12345678', '123456789', '1234567890', 'password', 'qwertyui', 'qwerty123', '11111111',
  '00000000', '87654321', 'йцукенгш', 'password1', 'qwertyuiop', 'abcdefgh', '1q2w3e4r', '1qaz2wsx', 'iloveyou']);

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function sessionCookie(token, maxAge, secure) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/** The user this request is logged in as, or null. */
function currentUser(req, ctx) {
  const token = parseCookies(req)[COOKIE];
  if (!token || token.length > 100) return null;
  const row = ctx.db.get(`SELECT u.id, u.nick, u.role, u.banned_until, u.ban_reason, u.created, s.expires
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sec.sha256(token));
  if (!row) return null;
  if (row.expires < Date.now()) {
    ctx.db.run('DELETE FROM sessions WHERE token_hash = ?', sec.sha256(token));
    return null;
  }
  return { id: row.id, nick: row.nick, role: row.role, bannedUntil: row.banned_until, banReason: row.ban_reason, created: row.created };
}

function requireUser(req, ctx) {
  const u = currentUser(req, ctx);
  if (!u) throw new HttpError(401, 'Войди в аккаунт', 'auth');
  return u;
}

function requireActive(req, ctx) {
  const u = requireUser(req, ctx);
  if (u.bannedUntil > Date.now()) {
    const till = new Date(u.bannedUntil).toLocaleString('ru-RU');
    throw new HttpError(403, `Аккаунт заблокирован до ${till}${u.banReason ? ': ' + u.banReason : ''}`, 'banned');
  }
  return u;
}

function requireAdmin(req, ctx) {
  const u = requireUser(req, ctx);
  if (u.role !== 'admin') throw new HttpError(403, 'Только для администрации', 'admin');
  return u;
}

function publicUser(u) {
  return u && { id: u.id, nick: u.nick, role: u.role, created: u.created, bannedUntil: u.bannedUntil > Date.now() ? u.bannedUntil : 0, banReason: u.bannedUntil > Date.now() ? u.banReason : '' };
}

function checkPassword(password, nick) {
  if (typeof password !== 'string' || password.length < 8) return 'Пароль — не короче 8 символов';
  if (password.length > 128) return 'Пароль слишком длинный';
  if (/^(.)\1+$/.test(password)) return 'Пароль из одного повторённого символа — слишком простой';
  if (COMMON.has(password.toLowerCase())) return 'Этот пароль слишком распространён — придумай другой';
  if (nick && password.toLowerCase().includes(nick.toLowerCase())) return 'Пароль не должен содержать ник';
  return null;
}

async function startSession(res, req, ctx, userId) {
  const token = sec.randomToken();
  const now = Date.now();
  ctx.db.run('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)',
    sec.sha256(token), userId, now, now + SESSION_DAYS * 86400000);
  // old sessions of this user beyond the newest ten go
  ctx.db.run(`DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN
    (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created DESC LIMIT 10)`, userId, userId);
  res.setHeader('Set-Cookie', sessionCookie(token, SESSION_DAYS * 86400, sec.isHttps(req, ctx.cfg)));
}

function register(router, ctx) {
  // (one address can be a whole school behind one connection: the limits per address are loose, an account
  // is guarded by its own lock after wrong passwords)
  const L = {
    register: new sec.RateLimiter(30, 3600000),
    created: new sec.RateLimiter(10, 3600000),
    login: new sec.RateLimiter(60, 15 * 60000),
    password: new sec.RateLimiter(6, 15 * 60000),
  };

  router.on('GET', '/api/me', (req, res) => {
    const u = currentUser(req, ctx);
    json(res, 200, { user: publicUser(u) });
  });

  router.on('GET', '/api/auth/form', (req, res) => {
    json(res, 200, { token: sec.formToken(ctx.secret) });
  });

  router.on('POST', '/api/auth/register', async (req, res) => {
    sec.checkOrigin(req, ctx.cfg);
    const ip = sec.clientIp(req, ctx.cfg);
    sec.limit(L.register, ip, 'регистрация');
    const b = await readJson(req);
    // a hidden field people never see: filled in, it was a bot
    if (b.website) throw new HttpError(400, 'Не получилось', 'bot');
    if (!sec.checkFormToken(ctx.secret, b.formToken)) throw new HttpError(400, 'Форма устарела или отправлена слишком быстро — обнови страницу', 'form');
    const nick = typeof b.nick === 'string' ? b.nick.normalize('NFC').trim() : '';
    if (!NICK_RE.test(nick)) throw new HttpError(400, 'Ник: 3–20 символов — буквы, цифры, _ и -', 'nick');
    // names that would pass for the game's staff ("Admin_2", "Модератор") are kept free; "Badminton" is fine
    const bare = nick.toLowerCase().replace(/[-_0-9]/g, '');
    if (RESERVED.some((r) => bare.startsWith(r.replace(/[-_]/g, '')))) throw new HttpError(400, 'Такой ник занят', 'nick');
    const bad = checkPassword(b.password, nick);
    if (bad) throw new HttpError(400, bad, 'password');
    if (b.rules !== true) throw new HttpError(400, 'Нужно согласиться с правилами', 'rules');
    if (ctx.db.get('SELECT 1 FROM users WHERE nick = ?', nick)) throw new HttpError(409, 'Такой ник уже занят', 'nick');
    sec.limit(L.created, ip, 'новые аккаунты');
    const hash = await sec.hashPassword(b.password);
    const hasAdmin = Boolean(ctx.db.get("SELECT 1 FROM users WHERE role = 'admin'"));
    const envAdmin = process.env.ADMIN_NICK ? process.env.ADMIN_NICK.trim().toLowerCase() : '';
    const makeAdmin = !hasAdmin || (envAdmin && nick.toLowerCase() === envAdmin);
    const role = makeAdmin ? 'admin' : 'user';
    let id;
    try { id = Number(ctx.db.run('INSERT INTO users (nick, pass, role, created) VALUES (?, ?, ?, ?)', nick, hash, role, Date.now()).lastInsertRowid); }
    catch { throw new HttpError(409, 'Такой ник уже занят', 'nick'); }
    ctx.db.audit(id, 'register');
    await startSession(res, req, ctx, id);
    json(res, 201, { user: publicUser(currentUserById(ctx, id)) });
  });

  router.on('POST', '/api/auth/login', async (req, res) => {
    sec.checkOrigin(req, ctx.cfg);
    const ip = sec.clientIp(req, ctx.cfg);
    sec.limit(L.login, ip, 'вход');
    const b = await readJson(req);
    const nick = typeof b.nick === 'string' ? b.nick.normalize('NFC').trim() : '';
    const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
    const u = nick ? ctx.db.get('SELECT * FROM users WHERE nick = ?', nick) : null;
    const generic = new HttpError(401, 'Неверный ник или пароль', 'login');
    if (!u) { await sec.dummyVerify(password); throw generic; }
    if (u.locked_until > Date.now()) {
      const min = Math.ceil((u.locked_until - Date.now()) / 60000);
      throw new HttpError(429, `Слишком много неудачных попыток. Попробуй через ${min} мин.`, 'locked');
    }
    if (!(await sec.verifyPassword(password, u.pass))) {
      const failed = u.failed + 1;
      // after 8 wrong passwords in a row the account waits 15 minutes
      ctx.db.run('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?', failed >= 8 ? 0 : failed, failed >= 8 ? Date.now() + 15 * 60000 : 0, u.id);
      if (failed >= 8) ctx.db.audit(u.id, 'locked');
      throw generic;
    }
    ctx.db.run('UPDATE users SET failed = 0, locked_until = 0 WHERE id = ?', u.id);
    if (process.env.ADMIN_NICK && u.nick.toLowerCase() === process.env.ADMIN_NICK.trim().toLowerCase() && u.role !== 'admin') {
      ctx.db.run("UPDATE users SET role = 'admin' WHERE id = ?", u.id);
      u.role = 'admin';
    }
    await startSession(res, req, ctx, u.id);
    json(res, 200, { user: publicUser(currentUserById(ctx, u.id)) });
  });

  router.on('POST', '/api/auth/logout', (req, res) => {
    sec.checkOrigin(req, ctx.cfg);
    const token = parseCookies(req)[COOKIE];
    if (token) ctx.db.run('DELETE FROM sessions WHERE token_hash = ?', sec.sha256(token));
    res.setHeader('Set-Cookie', sessionCookie('', 0, sec.isHttps(req, ctx.cfg)));
    json(res, 200, { ok: true });
  });

  router.on('POST', '/api/auth/logout-all', (req, res) => {
    sec.checkOrigin(req, ctx.cfg);
    const u = requireUser(req, ctx);
    ctx.db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    res.setHeader('Set-Cookie', sessionCookie('', 0, sec.isHttps(req, ctx.cfg)));
    json(res, 200, { ok: true });
  });

  router.on('POST', '/api/auth/password', async (req, res) => {
    sec.checkOrigin(req, ctx.cfg);
    const u = requireUser(req, ctx);
    sec.limit(L.password, 'u' + u.id, 'смена пароля');
    const b = await readJson(req);
    const row = ctx.db.get('SELECT pass FROM users WHERE id = ?', u.id);
    if (!(await sec.verifyPassword(String(b.oldPassword || '').slice(0, 200), row.pass))) throw new HttpError(400, 'Старый пароль неверный', 'password');
    const bad = checkPassword(b.newPassword, u.nick);
    if (bad) throw new HttpError(400, bad, 'password');
    ctx.db.run('UPDATE users SET pass = ? WHERE id = ?', await sec.hashPassword(b.newPassword), u.id);
    // every other device is logged out
    ctx.db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    await startSession(res, req, ctx, u.id);
    ctx.db.audit(u.id, 'password');
    json(res, 200, { ok: true });
  });

  router.on('POST', '/api/auth/delete', async (req, res) => {
    sec.checkOrigin(req, ctx.cfg);
    const u = requireUser(req, ctx);
    sec.limit(L.password, 'u' + u.id, 'удаление аккаунта');
    const b = await readJson(req);
    const row = ctx.db.get('SELECT pass FROM users WHERE id = ?', u.id);
    if (!(await sec.verifyPassword(String(b.password || '').slice(0, 200), row.pass))) throw new HttpError(400, 'Пароль неверный', 'password');
    // the account and everything it posted (messages, reviews, bug reports with their files)
    const files = ctx.db.all('SELECT id FROM bug_files WHERE user_id = ?', u.id);
    ctx.db.run('DELETE FROM users WHERE id = ?', u.id);
    for (const f of files) fs.rm(path.join(ctx.cfg.uploadsDir, f.id), { force: true }, () => {});
    ctx.chat?.removedUser(u.id);
    res.setHeader('Set-Cookie', sessionCookie('', 0, sec.isHttps(req, ctx.cfg)));
    json(res, 200, { ok: true });
  });
}

function currentUserById(ctx, id) {
  const r = ctx.db.get('SELECT id, nick, role, banned_until, ban_reason, created FROM users WHERE id = ?', id);
  return r && { id: r.id, nick: r.nick, role: r.role, bannedUntil: r.banned_until, banReason: r.ban_reason, created: r.created };
}

module.exports = { register, currentUser, requireUser, requireActive, requireAdmin, publicUser };
