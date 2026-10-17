// The administration's page: numbers, bug reports with their status, accounts (blocking), the action log.
// The server checks the role on every request; this page only shows what it is allowed to.
'use strict';

(async () => {
  const { el, api, toast, fmtDate } = SR;
  const user = await SR.ready;
  const root = document.getElementById('admin');
  if (!user || user.role !== 'admin') {
    root.append(el('div', { class: 'panel empty' }, 'Эта страница — только для администрации.'));
    return;
  }
  const STATUS = { new: 'Новый', seen: 'Принят', progress: 'В работе', fixed: 'Исправлен', wontfix: 'Не баг' };

  // ---------------------------------------------------------------- numbers
  const tiles = el('div', { class: 'tiles' });
  root.append(tiles);
  async function stats() {
    const s = await api('GET', '/api/admin/stats');
    tiles.textContent = '';
    for (const [n, l] of [[s.users, 'аккаунтов'], [s.usersToday, 'новых за сутки'], [s.online, 'сейчас в чате'], [s.messagesToday, 'сообщений за сутки'],
      [s.bugsNew, 'новых багов'], [s.bugs, 'всего отчётов'], [s.reviews, 'оценок'], [s.downloadsToday, 'скачиваний сегодня'], [s.downloads, 'скачиваний всего']]) {
      tiles.append(el('div', { class: 'panel tile' }, el('div', { class: 'n' }, String(n)), el('div', { class: 'l' }, l)));
    }
  }

  // ---------------------------------------------------------------- bug reports
  const bugsBox = el('div');
  const filter = el('select', { class: 'input' }, el('option', { value: '' }, 'Все статусы'), Object.entries(STATUS).map(([v, t]) => el('option', { value: v }, t)));
  filter.value = 'new';
  root.append(el('section', { class: 'section' },
    el('div', { class: 'section-head' }, el('div', {}, el('span', { class: 'caption' }, 'Баги'), el('h2', {}, 'Отчёты игроков')), filter),
    bugsBox));
  async function bugs() {
    bugsBox.textContent = '';
    const d = await api('GET', `/api/bugs?all=1${filter.value ? '&status=' + filter.value : ''}`);
    if (!d.bugs.length) { bugsBox.append(el('div', { class: 'panel empty' }, 'Отчётов нет.')); return; }
    for (const b of d.bugs) {
      const sel = el('select', { class: 'input', 'aria-label': 'Статус' }, Object.entries(STATUS).map(([v, t]) => el('option', { value: v }, t)));
      sel.value = b.status;
      sel.addEventListener('change', async () => {
        try { await api('PATCH', `/api/bugs/${b.id}`, { status: sel.value }); toast('Статус изменён', 'ok'); stats(); }
        catch (e) { toast(e.message, 'error'); }
      });
      const del = el('button', { class: 'btn small danger', type: 'button', onclick: async () => {
        if (!confirm('Удалить отчёт вместе с файлами?')) return;
        try { await api('DELETE', `/api/bugs/${b.id}`); bugs(); stats(); } catch (e) { toast(e.message, 'error'); }
      } }, 'Удалить');
      bugsBox.append(SR.bugCard(b, { showAuthor: true, controls: el('div', { class: 'toolbar' }, sel, del) }));
    }
  }
  filter.addEventListener('change', bugs);

  // ---------------------------------------------------------------- accounts
  const q = el('input', { class: 'input', placeholder: 'Ник', maxlength: 20 });
  const table = el('tbody');
  root.append(el('section', { class: 'section' },
    el('div', { class: 'section-head' }, el('div', {}, el('span', { class: 'caption' }, 'Аккаунты'), el('h2', {}, 'Игроки'))),
    el('div', { class: 'panel' },
      el('form', { class: 'toolbar', onsubmit: (e) => { e.preventDefault(); users(); } }, q, el('button', { class: 'btn small', type: 'submit' }, 'Найти')),
      el('div', { class: 'scroll-x' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, ['Ник', 'С нами с', 'Сообщ.', 'Отчёты', 'Статус', ''].map((h) => el('th', {}, h)))), table)))));

  async function ban(u) {
    const hours = prompt(`Заблокировать ${u.nick} на сколько часов? (24 = сутки, 168 = неделя, 0 = снять блокировку)`, '24');
    if (hours === null) return;
    const h = Number(hours);
    if (!Number.isFinite(h) || h < 0) { toast('Нужно число часов', 'error'); return; }
    const reason = h > 0 ? (prompt('Причина (увидит игрок):', 'Нарушение правил чата') || '') : '';
    const purge = h > 0 && confirm('Удалить все его сообщения в чате?');
    try { await api('POST', `/api/admin/users/${u.id}/ban`, { hours: h, reason, purge }); toast(h > 0 ? 'Заблокирован' : 'Блокировка снята', 'ok'); users(); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function users() {
    const d = await api('GET', `/api/admin/users?q=${encodeURIComponent(q.value)}`);
    table.textContent = '';
    for (const u of d.users) {
      table.append(el('tr', {},
        el('td', {}, el('b', {}, u.nick), u.role === 'admin' ? [' ', el('span', { class: 'role-admin' }, 'АДМИН')] : null),
        el('td', {}, new Date(u.created).toLocaleDateString('ru-RU')),
        el('td', {}, String(u.messages)),
        el('td', {}, String(u.bugs)),
        el('td', {}, u.bannedUntil ? el('span', { class: 'form-error' }, `блок до ${fmtDate(u.bannedUntil)}`) : 'активен'),
        el('td', {}, u.role === 'admin' ? null : el('button', { class: 'btn small ghost', type: 'button', onclick: () => ban(u) }, u.bannedUntil ? 'Изменить блок' : 'Заблокировать'))));
    }
    if (!d.users.length) table.append(el('tr', {}, el('td', { colspan: 6, class: 'dim' }, 'Никого не нашлось')));
  }

  // ---------------------------------------------------------------- log
  const logBox = el('tbody');
  root.append(el('section', { class: 'section' },
    el('div', { class: 'section-head' }, el('div', {}, el('span', { class: 'caption' }, 'Журнал'), el('h2', {}, 'Действия'))),
    el('div', { class: 'panel' }, el('div', { class: 'scroll-x' }, el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, ['Когда', 'Кто', 'Что', 'Подробности'].map((h) => el('th', {}, h)))), logBox)))));
  async function log() {
    const d = await api('GET', '/api/admin/audit');
    logBox.textContent = '';
    for (const a of d.log) logBox.append(el('tr', {}, el('td', {}, fmtDate(a.created)), el('td', {}, a.nick || '—'), el('td', {}, a.action), el('td', { class: 'dim' }, a.detail)));
  }

  try { await Promise.all([stats(), bugs(), users(), log()]); }
  catch (e) { toast(e.message, 'error'); }
})();
