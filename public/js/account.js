// The account page: log in / register when logged out; the profile, password change, logging out
// everywhere and deleting the account when logged in.
'use strict';

(async () => {
  const { el, api, toast, fmtDay } = SR;
  const user = await SR.ready;
  const box = document.getElementById('box');
  const title = document.getElementById('title');
  const next = (() => {
    const n = new URLSearchParams(location.search).get('next') || '/';
    return /^\/[a-z]*$/.test(n) ? n : '/';     // only this site's own pages
  })();

  const field = (label, input, hint) => el('label', { class: 'field' }, el('span', {}, label), input, hint ? el('small', { class: 'dim' }, hint) : null);
  const pass = (auto) => el('input', { class: 'input', type: 'password', autocomplete: auto, maxlength: 128, required: true });

  if (!user) {
    // ---------------------------------------------------------------- logged out
    const panel = el('section', { class: 'panel' });
    const aside = el('aside', { class: 'panel' },
      el('span', { class: 'caption' }, 'Зачем аккаунт'),
      el('h3', {}, 'Твой ник на сайте'),
      el('hr', { class: 'rule' }),
      el('ul', { class: 'facts small' },
        el('li', {}, 'Писать в чат'), el('li', {}, 'Отправлять отчёты о багах с фото и видео'),
        el('li', {}, 'Оценивать игру'), el('li', {}, 'Почта и телефон не нужны')),
      el('p', { class: 'dim small' }, 'Пароль хранится только в виде защищённого хеша — его не видит даже администрация. Не используй пароль от других сайтов.'));
    box.append(panel, aside);
    const tabs = el('div', { class: 'tabs', role: 'tablist' });
    const loginTab = el('button', { type: 'button', role: 'tab' }, 'Вход');
    const regTab = el('button', { type: 'button', role: 'tab' }, 'Регистрация');
    tabs.append(loginTab, regTab);
    const formBox = el('div');
    panel.append(tabs, formBox);

    function showLogin() {
      title.textContent = 'Вход';
      loginTab.classList.add('active'); regTab.classList.remove('active');
      const nick = el('input', { class: 'input', autocomplete: 'username', maxlength: 20, required: true });
      const pw = pass('current-password');
      const error = el('p', { class: 'form-error', role: 'alert' });
      const btn = el('button', { class: 'btn', type: 'submit' }, 'Войти');
      const form = el('form', {}, field('Ник', nick), field('Пароль', pw), error, btn);
      formBox.replaceChildren(form);
      nick.focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.textContent = '';
        btn.disabled = true;
        try {
          await api('POST', '/api/auth/login', { nick: nick.value, password: pw.value });
          location.href = next;
        } catch (err) { error.textContent = err.message; pw.value = ''; }
        finally { btn.disabled = false; }
      });
    }

    async function showRegister() {
      title.textContent = 'Регистрация';
      regTab.classList.add('active'); loginTab.classList.remove('active');
      const nick = el('input', { class: 'input', autocomplete: 'username', maxlength: 20, required: true });
      const pw = pass('new-password');
      const pw2 = pass('new-password');
      const rules = el('input', { type: 'checkbox', required: true });
      // a field people never see (hidden by the style sheet): bots fill everything in
      const trap = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' });
      const error = el('p', { class: 'form-error', role: 'alert' });
      const btn = el('button', { class: 'btn', type: 'submit' }, 'Создать аккаунт');
      const form = el('form', {},
        field('Ник', nick, '3–20 символов: буквы, цифры, _ и -'),
        field('Пароль', pw, 'Не короче 8 символов. Не используй пароль от других сайтов.'),
        field('Пароль ещё раз', pw2),
        el('label', { class: 'hp', 'aria-hidden': 'true' }, 'Сайт', trap),
        el('label', { class: 'check' }, rules, el('span', {}, 'Я прочитал ', el('a', { href: '/rules', target: '_blank' }, 'правила'), ' и согласен с ними')),
        error, btn);
      formBox.replaceChildren(form);
      nick.focus();
      let formToken = '';
      try { formToken = (await api('GET', '/api/auth/form')).token; } catch { /* the server will say */ }
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.textContent = '';
        if (pw.value !== pw2.value) { error.textContent = 'Пароли не совпадают'; return; }
        if (!rules.checked) { error.textContent = 'Нужно согласиться с правилами'; return; }
        btn.disabled = true;
        try {
          await api('POST', '/api/auth/register', { nick: nick.value, password: pw.value, rules: true, website: trap.value, formToken });
          location.href = next;
        } catch (err) {
          error.textContent = err.message;
          if (err.code === 'form') { try { formToken = (await api('GET', '/api/auth/form')).token; } catch { /* nothing */ } }
        } finally { btn.disabled = false; }
      });
    }

    loginTab.addEventListener('click', showLogin);
    regTab.addEventListener('click', showRegister);
    if (location.hash === '#register') showRegister(); else showLogin();
    return;
  }

  // ---------------------------------------------------------------- logged in
  title.textContent = user.nick;
  const profile = el('section', { class: 'panel' },
    el('span', { class: 'caption' }, 'Профиль'),
    el('h3', {}, user.nick),
    el('hr', { class: 'rule' }),
    el('dl', { class: 'kv' },
      el('dt', {}, 'С нами с'), el('dd', {}, fmtDay(user.created)),
      el('dt', {}, 'Роль'), el('dd', {}, user.role === 'admin' ? 'Администрация' : 'Игрок'),
      user.bannedUntil ? [el('dt', {}, 'Блокировка'), el('dd', { class: 'form-error' }, `до ${new Date(user.bannedUntil).toLocaleString('ru-RU')}${user.banReason ? ': ' + user.banReason : ''}`)] : null),
    el('hr', { class: 'rule' }),
    el('div', { class: 'toolbar' },
      user.role === 'admin' ? el('a', { class: 'btn', href: '/admin' }, 'Админка') : null,
      el('button', { class: 'btn ghost', type: 'button', onclick: async () => { await api('POST', '/api/auth/logout').catch(() => {}); location.href = '/'; } }, 'Выйти'),
      el('button', { class: 'btn ghost', type: 'button', onclick: async () => {
        if (!confirm('Выйти на всех устройствах?')) return;
        await api('POST', '/api/auth/logout-all').catch(() => {});
        location.href = '/';
      } }, 'Выйти везде')));

  const oldPw = pass('current-password'), newPw = pass('new-password'), newPw2 = pass('new-password');
  const pwError = el('p', { class: 'form-error', role: 'alert' });
  const pwForm = el('form', {}, field('Старый пароль', oldPw), field('Новый пароль', newPw, 'Не короче 8 символов'), field('Новый ещё раз', newPw2), pwError,
    el('button', { class: 'btn', type: 'submit' }, 'Сменить пароль'));
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    pwError.textContent = '';
    if (newPw.value !== newPw2.value) { pwError.textContent = 'Новые пароли не совпадают'; return; }
    try {
      await api('POST', '/api/auth/password', { oldPassword: oldPw.value, newPassword: newPw.value });
      pwForm.reset();
      toast('Пароль изменён. На других устройствах нужно войти заново.', 'ok');
    } catch (err) { pwError.textContent = err.message; }
  });

  const delPw = pass('current-password');
  const delError = el('p', { class: 'form-error', role: 'alert' });
  const delForm = el('form', {}, el('p', { class: 'dim small' }, 'Удалятся аккаунт, твои сообщения в чате, отзыв и отчёты о багах с файлами. Это нельзя отменить.'),
    field('Пароль для подтверждения', delPw), delError, el('button', { class: 'btn danger', type: 'submit' }, 'Удалить аккаунт'));
  delForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    delError.textContent = '';
    if (!confirm('Точно удалить аккаунт навсегда?')) return;
    try { await api('POST', '/api/auth/delete', { password: delPw.value }); location.href = '/?deleted=1'; }
    catch (err) { delError.textContent = err.message; }
  });

  if (location.hash === '#admin' && user.role !== 'admin') {
    const code = el('input', { class: 'input', type: 'password', autocomplete: 'off', maxlength: 200, required: true });
    const err = el('p', { class: 'form-error', role: 'alert' });
    const claim = el('form', {}, field('Код администратора', code, 'Секретный код из настроек сервера (ADMIN_TOKEN)'), err,
      el('button', { class: 'btn', type: 'submit' }, 'Стать администратором'));
    claim.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      try { await api('POST', '/api/auth/claim-admin', { token: code.value }); location.href = '/admin'; }
      catch (er) { err.textContent = er.message; code.value = ''; }
    });
    box.append(el('section', { class: 'panel' }, el('span', { class: 'caption' }, 'Администрация'), el('h3', {}, 'Код администратора'), el('hr', { class: 'rule' }), claim));
  }

  box.append(profile,
    el('section', { class: 'panel' }, el('span', { class: 'caption' }, 'Безопасность'), el('h3', {}, 'Сменить пароль'), el('hr', { class: 'rule' }), pwForm),
    el('section', { class: 'panel' }, el('span', { class: 'caption' }, 'Опасная зона'), el('h3', {}, 'Удалить аккаунт'), el('hr', { class: 'rule' }), delForm));
})();
