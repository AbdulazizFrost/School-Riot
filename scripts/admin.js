'use strict';
// The administration from the server's console (the site has no way to make an administrator itself):
//   npm run admin -- make-admin <nick>
//   npm run admin -- remove-admin <nick>
//   npm run admin -- list
//   npm run admin -- unlock <nick>          (after too many wrong passwords)
//   npm run admin -- reset-password <nick>  (a forgotten password: prints a temporary one to pass on)
const crypto = require('node:crypto');
const { load } = require('../src/config');
const { open } = require('../src/db');
const { hashPassword } = require('../src/security');

const [cmd, nick] = process.argv.slice(2);
const db = open(load());

function user() {
  const u = db.get('SELECT id, nick, role FROM users WHERE nick = ?', nick || '');
  if (!u) { console.error(`No account "${nick}". Register it on the site first.`); process.exit(1); }
  return u;
}

switch (cmd) {
  case 'make-admin': {
    const u = user();
    db.run("UPDATE users SET role = 'admin', banned_until = 0 WHERE id = ?", u.id);
    db.audit(u.id, 'make-admin', 'console');
    console.log(`${u.nick} is an administrator now.`);
    break;
  }
  case 'remove-admin': {
    const u = user();
    db.run("UPDATE users SET role = 'user' WHERE id = ?", u.id);
    db.audit(u.id, 'remove-admin', 'console');
    console.log(`${u.nick} is a regular account now.`);
    break;
  }
  case 'unlock': {
    const u = user();
    db.run('UPDATE users SET failed = 0, locked_until = 0 WHERE id = ?', u.id);
    console.log(`${u.nick} can log in again.`);
    break;
  }
  case 'reset-password': {
    const u = user();
    // readable, no look-alike letters: give it to the player privately, they change it on the account page
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    const temp = Array.from(crypto.randomBytes(12), (x) => abc[x % abc.length]).join('');
    hashPassword(temp).then((hash) => {
      db.run('UPDATE users SET pass = ?, failed = 0, locked_until = 0 WHERE id = ?', hash, u.id);
      db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
      db.audit(u.id, 'reset-password', 'console');
      console.log(`Temporary password for ${u.nick}: ${temp}`);
      console.log('They are logged out everywhere; ask them to change it on the account page.');
    });
    break;
  }
  case 'list':
    for (const u of db.all("SELECT nick, created FROM users WHERE role = 'admin' ORDER BY id")) console.log(u.nick, new Date(u.created).toISOString());
    break;
  default:
    console.log('npm run admin -- make-admin <nick> | remove-admin <nick> | unlock <nick> | reset-password <nick> | list');
}
