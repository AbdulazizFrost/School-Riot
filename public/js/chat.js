// The chat page: the last messages, new ones live (Server-Sent Events, reconnecting by itself), writing
// for accounts, deleting for the administration.
'use strict';

(async () => {
  const { el, api, toast, fmtTime, fmtDate, initial, nickColor, loginPrompt } = SR;
  const list = document.getElementById('messages');
  const onlineEl = document.getElementById('online');
  const compose = document.getElementById('compose');
  const user = await SR.ready;
  const shown = new Map();
  let admin = user?.role === 'admin';

  function setOnline(n) {
    onlineEl.textContent = '';
    onlineEl.append(el('i'), `Сейчас в чате: ${n}`);
  }

  function nearBottom() { return list.scrollHeight - list.scrollTop - list.clientHeight < 120; }

  function render(m) {
    if (shown.has(m.id)) return;
    const color = nickColor(m.user.nick);
    const av = el('span', { class: 'av' }, initial(m.user.nick));
    av.style.background = color;
    const meta = el('div', { class: 'meta' },
      el('b', {}, m.user.nick),
      m.user.role === 'admin' ? el('span', { class: 'role-admin' }, 'АДМИН') : null,
      el('time', { datetime: new Date(m.created).toISOString(), title: fmtDate(m.created) }, fmtTime(m.created)),
      admin ? el('button', { class: 'del', type: 'button', title: 'Удалить сообщение', onclick: () => remove(m.id) }, 'удалить') : null);
    meta.querySelector('b').style.color = color;
    const row = el('div', { class: 'msg', dataset: { id: m.id, user: m.user.id } }, av, el('div', {}, meta, el('div', { class: 'text' }, m.text)));
    shown.set(m.id, row);
    const stick = nearBottom();
    list.querySelector('.empty')?.remove();
    list.append(row);
    if (stick) list.scrollTop = list.scrollHeight;
  }

  async function remove(id) {
    if (!confirm('Удалить это сообщение?')) return;
    try { await api('DELETE', `/api/chat/${id}`); }
    catch (e) { toast(e.message, 'error'); }
  }

  // ---- history
  try {
    const d = await api('GET', '/api/chat');
    if (!d.messages.length) list.append(el('div', { class: 'empty' }, 'Пока тихо. Напиши первым!'));
    d.messages.forEach(render);
    setOnline(d.online);
    list.scrollTop = list.scrollHeight;
  } catch (e) { list.append(el('div', { class: 'empty' }, e.message)); }

  // ---- live
  const es = new EventSource('/api/chat/stream');
  es.addEventListener('message', (e) => render(JSON.parse(e.data)));
  es.addEventListener('delete', (e) => {
    const { id } = JSON.parse(e.data);
    shown.get(id)?.remove();
    shown.delete(id);
  });
  es.addEventListener('purge', (e) => {
    const { userId } = JSON.parse(e.data);
    for (const [id, row] of shown) if (Number(row.dataset.user) === userId) { row.remove(); shown.delete(id); }
  });
  es.addEventListener('online', (e) => setOnline(JSON.parse(e.data).online));

  // ---- writing
  if (!user) { compose.append(el('div', { class: 'chat-login' }, loginPrompt('Чтобы писать в чат, войди в аккаунт.'))); return; }
  if (user.bannedUntil) {
    compose.append(el('div', { class: 'chat-login' }, `Писать нельзя до ${fmtDate(user.bannedUntil)}${user.banReason ? ': ' + user.banReason : ''}`));
    return;
  }
  const input = el('textarea', { class: 'input', maxlength: 300, rows: 1, placeholder: 'Сообщение… (Enter — отправить, Shift+Enter — новая строка)', 'aria-label': 'Сообщение' });
  const count = el('span', { class: 'counter' }, '0/300');
  const btn = el('button', { class: 'btn', type: 'submit' }, 'Отправить');
  const form = el('form', { class: 'chat-form' }, el('div', { class: 'field' }, input, count), btn);
  compose.append(form);
  input.addEventListener('input', () => {
    count.textContent = `${[...input.value].length}/300`;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight + 2, 140) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    btn.disabled = true;
    try {
      const d = await api('POST', '/api/chat', { text });
      render(d.message);
      input.value = '';
      input.dispatchEvent(new Event('input'));
      list.scrollTop = list.scrollHeight;
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; input.focus(); }
  });
})();
