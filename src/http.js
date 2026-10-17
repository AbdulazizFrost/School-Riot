'use strict';
// Small HTTP helpers: errors with a status, JSON in and out, a router with :params, static files and file
// streaming with byte ranges (video seeking, resumable downloads).
const fs = require('node:fs');
const path = require('node:path');

class HttpError extends Error {
  constructor(status, message, code = '', headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function json(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

async function readJson(req, limit = 16 * 1024) {
  const type = String(req.headers['content-type'] || '');
  if (!type.startsWith('application/json')) throw new HttpError(415, 'Нужен JSON');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(c);
  }
  let v;
  try { v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new HttpError(400, 'Неверный JSON'); }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new HttpError(400, 'Неверный JSON');
  return v;
}

class Router {
  constructor() { this.routes = []; }
  on(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler });
  }
  match(method, pathname) {
    let allowed = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      if (r.method !== method) { allowed = true; continue; }
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return allowed ? 'method' : null;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.ttf': 'font/ttf',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
};

/** A file inside a folder (never outside it, whatever the path says). */
function inside(dir, rel) {
  const p = path.resolve(dir, '.' + path.posix.normalize('/' + rel));
  return p === dir || p.startsWith(dir + path.sep) ? p : null;
}

/** The site's pages and their files from public/: /download -> download.html. */
function serveStatic(req, res, cfg, pathname, status = 200) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (!path.extname(rel)) rel += '.html';
  const file = inside(cfg.publicDir, rel);
  if (!file) return false;
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // pages, styles and scripts are checked every time (an update reaches everyone at once; unchanged files
    // answer 304 by their ETag); pictures, fonts and the video are kept a day
    'Cache-Control': ['.html', '.css', '.js', '.json'].includes(ext) ? 'no-cache' : 'public, max-age=86400',
    ETag: etag,
  };
  if (status === 200 && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  if (status === 200 && (ext === '.mp4' || ext === '.webm')) return streamFile(req, res, file, st.size, headers), true;
  res.writeHead(status, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

/** A file with byte ranges (a video player seeking, a download manager resuming). */
function streamFile(req, res, file, size, headers) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  let start = 0, end = size - 1, status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1; }
    else { start = Math.max(0, size - Number(range[2])); }
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    status = 206;
  }
  res.writeHead(status, {
    ...headers,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file, { start, end }).pipe(res);
}

module.exports = { HttpError, json, readJson, Router, serveStatic, streamFile, inside, MIME };
