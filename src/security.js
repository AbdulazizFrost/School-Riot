'use strict';
// Protection in one place: password hashing, request limits, where a request comes from, the response headers,
// cleaning of what people type.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const { HttpError } = require('./http');

const scrypt = util.promisify(crypto.scrypt);
// scrypt with 32 MB of memory per hash: slow to brute-force, fast enough to log in
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(key, expected);
}

// a hash to check against when the nickname does not exist: the answer takes as long either way, so the
// time does not tell whether an account exists
let dummyHash = null;
async function dummyVerify(password) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
  return false;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** The server's own secret (data/secret.key, made on the first start): signs the registration form tokens. */
function loadSecret(dataDir) {
  const p = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(p)) fs.writeFileSync(p, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(p, 'utf8').trim(), 'hex');
}

/**
 * A form token: when the form was opened, signed. Registration accepts it only between 3 s and 2 h old - a
 * script that posts at once (or replays an old token) is turned away without a CAPTCHA.
 */
function formToken(secret) {
  const ts = Date.now().toString(36);
  const sig = crypto.createHmac('sha256', secret).update('form:' + ts).digest('base64url').slice(0, 22);
  return `${ts}.${sig}`;
}

function checkFormToken(secret, token) {
  const [ts, sig] = String(token || '').split('.');
  if (!ts || !sig) return false;
  const want = crypto.createHmac('sha256', secret).update('form:' + ts).digest('base64url').slice(0, 22);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return false;
  const age = Date.now() - parseInt(ts, 36);
  return age >= 3000 && age <= 2 * 3600 * 1000;
}

/** Sliding-window limits kept in memory: key -> recent hit times. */
class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
    setInterval(() => this.sweep(), Math.min(windowMs, 60000)).unref();
  }
  hit(key) {
    const now = Date.now();
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return { ok: false, retryAfter: Math.ceil((this.windowMs - (now - list[0])) / 1000) };
    }
    list.push(now);
    this.hits.set(key, list);
    return { ok: true, retryAfter: 0 };
  }
  sweep() {
    const now = Date.now();
    for (const [k, list] of this.hits) if (!list.length || now - list[list.length - 1] > this.windowMs) this.hits.delete(k);
  }
}

function limit(limiter, key, what) {
  const r = limiter.hit(key);
  if (!r.ok) throw new HttpError(429, `Слишком часто: ${what}. Попробуй через ${r.retryAfter} с.`, 'rate', { 'Retry-After': String(r.retryAfter) });
}

function clientIp(req, cfg) {
  if (cfg.trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  }
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function isHttps(req, cfg) {
  if (cfg.https) return true;
  if (cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https') return true;
  return Boolean(req.socket.encrypted);
}

/**
 * Requests that change something must come from the site's own pages: they carry the X-SR header (a page on
 * another site cannot add it without the browser asking first, which this server never allows), and when the
 * browser names the page's origin it must be this site.
 */
function checkOrigin(req, cfg) {
  if (req.headers['x-sr'] !== '1') throw new HttpError(403, 'Запрос не со страницы сайта', 'origin');
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers.host;
  const allowed = new Set([`http://${host}`, `https://${host}`]);
  if (cfg.publicUrl) { try { allowed.add(new URL(cfg.publicUrl).origin); } catch { /* ignored */ } }
  if (!allowed.has(origin)) throw new HttpError(403, 'Запрос с чужого сайта', 'origin');
}

function securityHeaders(res, req, cfg) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob: https://i.ytimg.com",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    'frame-src https://www.youtube-nocookie.com',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isHttps(req, cfg)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

/**
 * What people type, made safe to keep: Unicode normalized, control characters out (newlines kept where
 * allowed), length capped. It is shown with textContent on the pages, never as HTML.
 */
function cleanText(value, maxLen, { multiline = false, maxLines = 30 } = {}) {
  let s = typeof value === 'string' ? value : '';
  s = s.normalize('NFC').replace(/\r\n?/g, '\n');
  // control characters and the bidi overrides used to disguise text
  s = s.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F‪-‮⁦-⁩]/g : /[\u0000-\u001F\u007F‪-‮⁦-⁩]/g, '');
  if (multiline) {
    s = s.split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n');
    const lines = s.split('\n');
    if (lines.length > maxLines) s = lines.slice(0, maxLines).join('\n');
  }
  s = s.trim();
  return [...s].slice(0, maxLen).join('');
}

module.exports = {
  hashPassword, verifyPassword, dummyVerify, sha256, randomToken, loadSecret, formToken, checkFormToken,
  RateLimiter, limit, clientIp, isHttps, checkOrigin, securityHeaders, cleanText,
};
