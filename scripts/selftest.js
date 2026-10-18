'use strict';
// The site's own test against a running server (npm start first):
//   npm test                      (http://localhost:8080)
//   BASE=http://host:port npm test
// Makes two throwaway accounts and checks what one may and may not do to the other, the protection against
// requests from other sites, the file checks, the limits. Leaves the two accounts behind deleted.
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE || 'http://localhost:8080';
let passed = 0, failed = 0;
function check(ok, what) {
  if (ok) { passed++; console.log('  PASS ', what); } else { failed++; console.log('  FAIL ', what); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async req(method, url, { body, headers = {}, raw } = {}) {
    const h = { 'X-SR': '1', ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined && !raw) { h['Content-Type'] = 'application/json'; }
    const res = await fetch(BASE + url, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set && set.startsWith('sr_session=')) this.cookie = set.split(';')[0];
    let data = null;
    const type = res.headers.get('content-type') || '';
    if (type.includes('json')) data = await res.json(); else await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  }
}

async function register(c, nick, password) {
  const t = await c.req('GET', '/api/auth/form');
  await sleep(3200);
  return c.req('POST', '/api/auth/register', { body: { nick, password, rules: true, formToken: t.data.token } });
}

(async () => {
  const stamp = Date.now().toString(36).slice(-5);
  const A = new Client('A'), B = new Client('B'), anon = new Client('anon');
  const pwA = 'Test-pass-' + stamp + 'A', pwB = 'Test-pass-' + stamp + 'B';

  console.log('Accounts');
  const quick = await A.req('POST', '/api/auth/register', { body: { nick: 'quick' + stamp, password: pwA, rules: true, formToken: (await A.req('GET', '/api/auth/form')).data.token } });
  check(quick.status === 400 && quick.data.code === 'form', 'a form sent at once (a bot) is refused');
  const bot = await A.req('POST', '/api/auth/register', { body: { nick: 'bot' + stamp, password: pwA, rules: true, website: 'http://spam', formToken: 'x' } });
  check(bot.status === 400, 'the hidden field filled in (a bot) is refused');
  const weak = await register(A, 'weak' + stamp, '12345678');
  check(weak.status === 400 && weak.data.code === 'password', 'a common password is refused');
  const staff = await register(A, 'Admin_' + stamp.slice(0, 3), pwA);
  check(staff.status === 400 && staff.data.code === 'nick', 'a nickname passing for the staff is refused');
  const ra = await register(A, 'testA' + stamp, pwA);
  check(ra.status === 201 && A.cookie, 'account A registered and logged in');
  const rb = await register(B, 'testB' + stamp, pwB);
  check(rb.status === 201 && B.cookie, 'account B registered and logged in');
  check(ra.data?.user?.role === 'user' && rb.data?.user?.role === 'user', 'a new account is a player, never an administrator by itself');
  const claimBad = await B.req('POST', '/api/auth/claim-admin', { body: { token: 'guess-' + stamp } });
  check(claimBad.status === 403 || claimBad.status === 429, 'a wrong administrator code is refused');
  if (process.env.TEST_ADMIN_TOKEN) {
    // (a third account: A and B must stay players for the checks below)
    const C = new Client('C');
    const pwC = 'Test-pass-' + stamp + 'C';
    await register(C, 'testC' + stamp, pwC);
    const claimOk = await C.req('POST', '/api/auth/claim-admin', { body: { token: process.env.TEST_ADMIN_TOKEN } });
    const me = await C.req('GET', '/api/me');
    check(claimOk.status === 200 && me.data.user.role === 'admin', 'the right administrator code makes an administrator');
    await C.req('POST', '/api/auth/delete', { body: { password: pwC } });
  }
  const dup = await register(anon, 'TESTA' + stamp, pwA);
  check(dup.status === 409, 'the same nickname in other letters case is taken');

  console.log('Requests from other sites');
  const noHeader = await A.req('POST', '/api/chat', { body: { text: 'x' }, headers: { 'X-SR': '' } });
  check(noHeader.status === 403, 'a change without the site header is refused');
  const foreign = await A.req('POST', '/api/chat', { body: { text: 'x' }, headers: { Origin: 'https://evil.example' } });
  check(foreign.status === 403, 'a change from another site (Origin) is refused');

  console.log('Chat');
  const anonChat = await anon.req('POST', '/api/chat', { body: { text: 'hi' } });
  check(anonChat.status === 401, 'writing without an account is refused');
  const html = '<script>alert(1)</script>‮abc';
  const sent = await A.req('POST', '/api/chat', { body: { text: html } });
  check(sent.status === 201 && !sent.data.message.text.includes('‮'), 'a message is kept, the text-direction trick is stripped');
  const fast = await A.req('POST', '/api/chat', { body: { text: 'again' } });
  check(fast.status === 429, 'two messages in a row too fast: the second is refused');
  const long = await (await sleep(1600), A.req('POST', '/api/chat', { body: { text: 'я'.repeat(500) } }));
  check(long.status === 201 && [...long.data.message.text].length === 300, 'a long message is cut to 300 characters');
  const delByUser = await B.req('DELETE', `/api/chat/${sent.data.message.id}`);
  check(delByUser.status === 403, "a player cannot delete someone's message");

  console.log('Bug reports and files');
  const bug = await A.req('POST', '/api/bugs', { body: { title: 'Тестовый баг', body: 'Проверка: что делал и что случилось.', version: '0.9' } });
  check(bug.status === 201, 'A sends a report');
  const id = bug.data.id;
  // a real PNG (1x1)
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const up = await A.req('PUT', `/api/bugs/${id}/files`, { raw: png, headers: { 'X-File-Name': 'pic.png', 'Content-Type': 'image/png' } });
  check(up.status === 201 && up.data.file.mime === 'image/png', 'a real picture is taken');
  const fake = await A.req('PUT', `/api/bugs/${id}/files`, { raw: Buffer.from('<html>not a picture</html>'), headers: { 'X-File-Name': 'x.png', 'Content-Type': 'image/png' } });
  check(fake.status === 415, 'a web page renamed to .png is refused');
  const exe = await A.req('PUT', `/api/bugs/${id}/files`, { raw: Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00'), headers: { 'X-File-Name': 'video.mp4', 'Content-Type': 'video/mp4' } });
  check(exe.status === 415, 'a program renamed to .mp4 is refused');
  const video = path.join(__dirname, '..', 'public', 'video', 'trailer.mp4');
  if (fs.existsSync(video)) {
    const v = await A.req('PUT', `/api/bugs/${id}/files`, { raw: fs.readFileSync(video), headers: { 'X-File-Name': 'trailer.mp4', 'Content-Type': 'video/mp4' } });
    check(v.status === 201 && v.data.file.kind === 'video', 'a real MP4 video is taken');
  }
  const byB = await B.req('PUT', `/api/bugs/${id}/files`, { raw: png, headers: { 'X-File-Name': 'p.png', 'Content-Type': 'image/png' } });
  check(byB.status === 404, "B cannot add files to A's report");
  const fileId = up.data.file.id;
  check((await A.req('GET', `/media/${fileId}`)).status === 200, 'A sees the picture of its report');
  check((await B.req('GET', `/media/${fileId}`)).status === 404, "B cannot see A's picture");
  check((await anon.req('GET', `/media/${fileId}`)).status === 404, 'without an account the picture is not shown');
  const listB = await B.req('GET', '/api/bugs?all=1');
  check(listB.status === 200 && listB.data.bugs.every((b) => b.user.nick !== 'testA' + stamp), "B's list has no reports of A (asking for all does not help)");
  check((await B.req('PATCH', `/api/bugs/${id}`, { body: { status: 'fixed' } })).status === 403, 'a player cannot change a status');
  check((await B.req('DELETE', `/api/bugs/${id}`)).status === 404, "B cannot delete A's report");

  console.log('Reviews');
  const r1 = await A.req('PUT', '/api/reviews/mine', { body: { stars: 5, text: 'Класс!' } });
  check(r1.status === 200 && r1.data.summary.count >= 1, 'A rates the game');
  const r2 = await A.req('PUT', '/api/reviews/mine', { body: { stars: 4, text: 'Чуть подумал' } });
  const all = await anon.req('GET', '/api/reviews');
  check(r2.status === 200 && all.data.reviews.filter((r) => r.user.nick === 'testA' + stamp).length === 1, 'one rating per account (a second one replaces it)');
  check((await A.req('PUT', '/api/reviews/mine', { body: { stars: 9 } })).status === 400, 'stars outside 1-5 are refused');
  check((await B.req('POST', '/api/reviews/1/hide', { body: { hidden: true } })).status === 403, 'a player cannot hide reviews');

  console.log('Administration');
  check((await B.req('GET', '/api/admin/stats')).status === 403, 'a player is not let into the administration');
  check((await anon.req('GET', '/api/admin/users')).status === 401, 'nobody without an account either');

  console.log('Passwords');
  for (let i = 0; i < 8; i++) await anon.req('POST', '/api/auth/login', { body: { nick: 'testB' + stamp, password: 'wrong-' + i } });
  const locked = await anon.req('POST', '/api/auth/login', { body: { nick: 'testB' + stamp, password: pwB } });
  check(locked.status === 429 && locked.data.code === 'locked', 'after 8 wrong passwords the account waits (even the right one)');
  const ghost = await anon.req('POST', '/api/auth/login', { body: { nick: 'nobody' + stamp, password: 'x' } });
  check(ghost.status === 401 || ghost.status === 429, 'a missing account gets the same answer as a wrong password');

  console.log('Pages');
  const page = await fetch(BASE + '/');
  check(page.status === 200 && (page.headers.get('content-security-policy') || '').includes("script-src 'self'"), 'pages carry the content security policy');
  check(page.headers.get('x-frame-options') === 'DENY', 'the site cannot be framed by others');
  check((await fetch(BASE + '/../server.js')).status === 404 && (await fetch(BASE + '/%2e%2e/server.js')).status === 404, 'files outside public/ are not served');
  check((await fetch(BASE + '/../data/site.db')).status === 404, 'the database is not served');

  console.log('Cleanup');
  check((await A.req('POST', '/api/auth/delete', { body: { password: pwA } })).status === 200, 'A deletes its account (with its report and files)');
  check((await anon.req('GET', `/media/${fileId}`)).status === 404, "the deleted account's file is gone");
  // B is locked out now (the test above): removed straight from the database when it is on this machine
  try {
    const { load } = require('../src/config');
    const { open } = require('../src/db');
    const db = open(load());
    db.run('DELETE FROM users WHERE nick = ?', 'testB' + stamp);
    check(!db.get('SELECT 1 FROM users WHERE nick = ?', 'testB' + stamp), 'B removed');
  } catch { console.log('  (B stays: the database is not on this machine)'); }
  console.log(`\n${passed} PASS, ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
