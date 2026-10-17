'use strict';
// Settings: site.config.json next to server.js, a few overridable from the environment (PORT, HOST, PUBLIC_URL,
// TRUST_PROXY, DATA_DIR) so a hosting panel or the server's service file can set them without editing files.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const defaults = {
  port: 8080,
  host: '0.0.0.0',
  // The address people open (https://...): used to check where requests come from and to mark cookies Secure.
  publicUrl: '',
  // Behind a proxy (nginx, Cloudflare, a hosting's front): trust X-Forwarded-For / X-Forwarded-Proto.
  trustProxy: false,
  youtube: { channel: '', trailerId: '' },
  instagram: '',
  game: { version: '0.9', requirements: [] },
  limits: { imageMB: 10, videoMB: 100, filesPerReport: 5, uploadMBPerDay: 400 },
};

function load() {
  let file = {};
  const p = path.join(ROOT, 'site.config.json');
  if (fs.existsSync(p)) {
    try { file = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { throw new Error('site.config.json: ' + e.message); }
  }
  const cfg = {
    ...defaults, ...file,
    youtube: { ...defaults.youtube, ...(file.youtube || {}) },
    game: { ...defaults.game, ...(file.game || {}) },
    limits: { ...defaults.limits, ...(file.limits || {}) },
  };
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.env.HOST) cfg.host = process.env.HOST;
  if (process.env.PUBLIC_URL) cfg.publicUrl = process.env.PUBLIC_URL;
  if (process.env.TRUST_PROXY) cfg.trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
  cfg.root = ROOT;
  cfg.publicDir = path.join(ROOT, 'public');
  cfg.downloadsDir = path.join(ROOT, 'downloads');
  cfg.dataDir = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
  cfg.uploadsDir = path.join(cfg.dataDir, 'uploads');
  cfg.https = cfg.publicUrl.startsWith('https://');
  // only plain https links to the two sites are accepted (nothing else ends up in the page)
  cfg.youtube.channel = safeLink(cfg.youtube.channel, ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be']);
  cfg.instagram = safeLink(cfg.instagram, ['www.instagram.com', 'instagram.com']);
  cfg.youtube.trailerId = /^[A-Za-z0-9_-]{6,20}$/.test(cfg.youtube.trailerId || '') ? cfg.youtube.trailerId : '';
  return cfg;
}

function safeLink(url, hosts) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hosts.includes(u.hostname) ? u.toString() : '';
  } catch { return ''; }
}

module.exports = { load };
