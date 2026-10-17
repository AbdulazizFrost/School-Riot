// Shared by every page: the top bar and the footer, talking to the server, small DOM helpers, notices.
// Everything people typed is put on the page as text (textContent), never as HTML.
'use strict';

const SR = (() => {
  // ---------------------------------------------------------------- DOM
  /** el('div', {class: 'x', onclick: f}, 'text', child, ...) */
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** A small icon from path data (no markup strings anywhere). */
  function icon(paths, viewBox = '0 0 24 24', cls = '') {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', viewBox);
    s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    for (const d of [].concat(paths)) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'currentColor');
      s.append(p);
    }
    return s;
  }
  const ICONS = {
    star: 'M12 2.5l2.95 6.2 6.8.8-5 4.7 1.3 6.7L12 17.6l-6.05 3.3 1.3-6.7-5-4.7 6.8-.8z',
    youtube: 'M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1c.4-1.6.5-3.2.5-4.8s-.1-3.2-.5-4.8zM9.7 15.1V8.9l5.8 3.1z',
    instagram: 'M12 2.2c3.2 0 3.6 0 4.8.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 3.9 2.4 7.2 2.3 8.4 2.2 8.8 2.2 12 2.2zM12 0C8.7 0 8.3 0 7.1.1 2.7.3.3 2.7.1 7.1 0 8.3 0 8.7 0 12s0 3.7.1 4.9c.2 4.4 2.6 6.8 7 7 1.2.1 1.6.1 4.9.1s3.7 0 4.9-.1c4.4-.2 6.8-2.6 7-7 .1-1.2.1-1.6.1-4.9s0-3.7-.1-4.9c-.2-4.4-2.6-6.8-7-7C15.7 0 15.3 0 12 0zm0 5.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.8a1.4 1.4 0 1 0 0 2.9 1.4 1.4 0 0 0 0-2.9z',
    menu: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z',
    crosshair: 'M12 2a1 1 0 0 1 1 1v2.06A7 7 0 0 1 18.94 11H21a1 1 0 1 1 0 2h-2.06A7 7 0 0 1 13 18.94V21a1 1 0 1 1-2 0v-2.06A7 7 0 0 1 5.06 13H3a1 1 0 1 1 0-2h2.06A7 7 0 0 1 11 5.06V3a1 1 0 0 1 1-1zm0 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 3.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z',
  };

  function stars(value, max = 5) {
    const box = el('span', { class: 'stars', 'aria-label': `${value} из ${max}` });
    for (let i = 1; i <= max; i++) box.append(icon(ICONS.star, '0 0 24 24', i <= Math.round(value) ? '' : 'off'));
    return box;
  }

  // ---------------------------------------------------------------- server
  async function api(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-SR': '1' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try { res = await fetch(url, opts); }
    catch { throw new Error('Нет связи с сервером. Проверь интернет.'); }
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) {
      const err = new Error(data.error || `Ошибка ${res.status}`);
      err.status = res.status;
      err.code = data.code || '';
      throw err;
    }
    return data;
  }

  let mePromise = null;
  const me = (fresh) => {
    if (!mePromise || fresh) mePromise = api('GET', '/api/me').then((d) => d.user).catch(() => null);
    return mePromise;
  };
  let sitePromise = null;
  const site = () => (sitePromise ||= api('GET', '/api/site').catch(() => ({})));

  // ---------------------------------------------------------------- formatting
  const fmtDate = (ts) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const fmtDay = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  function fmtSize(b) {
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' ГБ';
    if (b >= 1048576) return (b / 1048576).toFixed(b >= 104857600 ? 0 : 1) + ' МБ';
    if (b >= 1024) return Math.round(b / 1024) + ' КБ';
    return b + ' Б';
  }
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  const initial = (nick) => ((nick || '?').match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  /** A stable colour per nickname, from the game's palette. */
  function nickColor(nick) {
    const palette = ['#4599ff', '#ff801f', '#54e675', '#ffcc29', '#e5484d', '#9b7bff', '#3fd0d0', '#ff7ab6'];
    let h = 0;
    for (const ch of String(nick)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return palette[h % palette.length];
  }

  // ---------------------------------------------------------------- notices
  function toast(text, kind = '') {
    let box = document.querySelector('.toasts');
    if (!box) { box = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
    const t = el('div', { class: 'toast ' + kind }, text);
    box.append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3500);
  }

  // ---------------------------------------------------------------- the top bar and the footer
  const PAGES = [
    ['/', 'Главная', 'home'],
    ['/download', 'Скачать', 'download'],
    ['/chat', 'Чат', 'chat'],
    ['/bugs', 'Баги', 'bugs'],
    ['/reviews', 'Отзывы', 'reviews'],
  ];

  async function frame() {
    const page = document.body.dataset.page || '';
    const bar = el('header', { class: 'topbar' },
      el('a', { class: 'logo', href: '/', 'aria-label': 'School Riot — на главную' },
        el('img', { class: 'shield', src: '/img/logo.svg', alt: '' }),
        el('span', { class: 'name' }, el('b', {}, 'SCHOOL RIOT'), el('span', {}, 'CAMPUS WAR'))),
      el('nav', { class: 'nav', 'aria-label': 'Разделы' },
        PAGES.map(([href, label, id]) => el('a', { href, class: id === page ? 'active' : '', 'aria-current': id === page ? 'page' : null }, label))),
      el('div', { class: 'account' }),
      el('button', { class: 'menu-toggle', 'aria-label': 'Меню', 'aria-expanded': 'false', onclick: (e) => {
        const open = bar.classList.toggle('open');
        e.currentTarget.setAttribute('aria-expanded', String(open));
      } }, icon(ICONS.menu)));
    document.body.prepend(bar);

    const footer = el('footer', { class: 'footer' },
      el('div', { class: 'wrap' },
        el('div', { class: 'studio' },
          el('img', { src: '/img/azforge.jpg', alt: 'AZ Forge', width: 64, height: 64 }),
          el('div', {}, el('b', {}, 'School Riot'), el('br'), el('span', { class: 'small' }, `Студия AZ Forge · ${new Date().getFullYear()}`))),
        el('nav', { 'aria-label': 'Внизу страницы' },
          el('a', { href: '/download' }, 'Скачать'), el('a', { href: '/chat' }, 'Чат'), el('a', { href: '/bugs' }, 'Сообщить о баге'),
          el('a', { href: '/reviews' }, 'Отзывы'), el('a', { href: '/rules' }, 'Правила'), el('a', { href: '/account' }, 'Аккаунт')),
        el('div', { class: 'social', id: 'footer-social' })));
    document.body.append(footer);

    const [user, info] = await Promise.all([me(), site()]);
    const acc = bar.querySelector('.account');
    if (user) {
      acc.append(el('a', { class: 'profile', href: user.role === 'admin' ? '/admin' : '/account' },
        el('span', { class: 'avatar' }, initial(user.nick)),
        el('span', { class: 'who' }, el('b', {}, user.nick), el('span', {}, user.role === 'admin' ? 'администрация' : 'мой аккаунт'))));
      if (user.role === 'admin') acc.append(el('a', { class: 'btn small ghost', href: '/account' }, 'Аккаунт'));
    } else {
      acc.append(el('a', { class: 'btn small', href: '/account' }, 'Войти'));
    }
    socialButtons(document.getElementById('footer-social'), info, true);
    return user;
  }

  /** YouTube / Instagram buttons for the links set in site.config.json (nothing when a link is not set). */
  function socialButtons(box, info, small = false) {
    if (!box) return 0;
    box.textContent = '';
    let n = 0;
    if (info.youtube) {
      box.append(el('a', { class: 'btn' + (small ? ' small ghost' : ''), href: info.youtube, target: '_blank', rel: 'noopener noreferrer' }, icon(ICONS.youtube), 'YouTube'));
      n++;
    }
    if (info.instagram) {
      box.append(el('a', { class: 'btn' + (small ? ' small ghost' : ''), href: info.instagram, target: '_blank', rel: 'noopener noreferrer' }, icon(ICONS.instagram), 'Instagram'));
      n++;
    }
    return n;
  }

  /** "Log in to do this" in place of a form. */
  function loginPrompt(text) {
    const back = encodeURIComponent(location.pathname);
    return el('div', { class: 'empty' }, el('p', {}, text), el('a', { class: 'btn', href: `/account?next=${back}` }, 'Войти или создать аккаунт'));
  }

  const ready = frame();
  return { el, icon, ICONS, stars, api, me, site, ready, toast, fmtDate, fmtDay, fmtTime, fmtSize, plural, initial, nickColor, socialButtons, loginPrompt };
})();
