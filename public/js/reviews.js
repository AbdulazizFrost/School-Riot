// Ratings: the average and the spread, my rating (stars and a few words), everyone's reviews. The
// administration sees hidden ones too and can hide / show them.
'use strict';

(async () => {
  const { el, api, toast, stars, fmtDay, plural, icon, ICONS, initial, nickColor, loginPrompt } = SR;
  const user = await SR.ready;
  const summaryBox = document.getElementById('summary');
  const myBox = document.getElementById('my-review');
  const list = document.getElementById('list');
  const admin = user?.role === 'admin';

  function renderSummary(s) {
    summaryBox.textContent = '';
    const dist = el('div', { class: 'dist' });
    for (let i = 5; i >= 1; i--) {
      const n = s.dist[i - 1];
      const fill = el('i');
      fill.style.width = s.count ? `${(n / s.count) * 100}%` : '0';
      dist.append(el('div', { class: 'row' }, el('span', {}, `${i}★`), el('span', { class: 'bar' }, fill), el('span', {}, String(n))));
    }
    summaryBox.append(
      el('span', { class: 'caption' }, 'Средняя оценка'),
      el('div', { class: 'score' },
        el('div', {}, el('div', { class: 'big' }, s.count ? s.average.toFixed(1) : '—'), stars(s.average),
          el('p', { class: 'dim small' }, s.count ? `${s.count} ${plural(s.count, 'оценка', 'оценки', 'оценок')}` : 'Пока никто не оценил')),
        dist));
  }

  function renderMine(mine) {
    myBox.textContent = '';
    myBox.append(el('span', { class: 'caption' }, 'Моя оценка'), el('h3', {}, mine ? 'Ты уже оценил' : 'Оцени игру'), el('hr', { class: 'rule' }));
    if (!user) { myBox.append(loginPrompt('Чтобы поставить оценку, войди в аккаунт.')); return; }
    let value = mine?.stars || 0;
    const pick = el('div', { class: 'star-pick', role: 'radiogroup', 'aria-label': 'Звёзды' });
    const buttons = [];
    const paint = (v) => buttons.forEach((b, i) => { b.classList.toggle('on', i < v); b.setAttribute('aria-checked', String(i + 1 === value)); });
    for (let i = 1; i <= 5; i++) {
      const b = el('button', { type: 'button', role: 'radio', 'aria-label': `${i} из 5` }, icon(ICONS.star));
      b.addEventListener('click', () => { value = i; paint(value); });
      b.addEventListener('mouseenter', () => paint(i));
      b.addEventListener('mouseleave', () => paint(value));
      buttons.push(b);
      pick.append(b);
    }
    paint(value);
    const text = el('textarea', { class: 'input', maxlength: 1000, rows: 4, placeholder: 'Что понравилось, что улучшить (необязательно)' });
    text.value = mine?.text || '';
    const error = el('p', { class: 'form-error', role: 'alert' });
    const save = el('button', { class: 'btn', type: 'submit' }, mine ? 'Сохранить' : 'Оценить');
    const form = el('form', {}, pick, el('label', { class: 'field' }, el('span', {}, 'Отзыв'), text), error, save,
      mine ? el('button', { class: 'btn ghost small', type: 'button', onclick: del }, 'Удалить мою оценку') : null);
    if (mine?.hidden) myBox.append(el('p', { class: 'form-error' }, 'Твой отзыв скрыт администрацией и не учитывается.'));
    myBox.append(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      if (!value) { error.textContent = 'Выбери от 1 до 5 звёзд'; return; }
      save.disabled = true;
      try {
        await api('PUT', '/api/reviews/mine', { stars: value, text: text.value });
        toast('Спасибо за оценку!', 'ok');
        await load();
      } catch (err) { error.textContent = err.message; }
      finally { save.disabled = false; }
    });
  }

  async function del() {
    if (!confirm('Удалить твою оценку?')) return;
    try { await api('DELETE', '/api/reviews/mine'); await load(); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function hide(r) {
    try { await api('POST', `/api/reviews/${r.user.id}/hide`, { hidden: !r.hidden }); await load(); }
    catch (e) { toast(e.message, 'error'); }
  }

  function renderList(reviews) {
    list.textContent = '';
    const withText = reviews.filter((r) => r.text || admin);
    if (!withText.length) { list.append(el('div', { class: 'panel empty' }, 'Здесь появятся отзывы игроков.')); return; }
    list.append(el('div', { class: 'section-head' }, el('div', {}, el('span', { class: 'caption' }, 'Что пишут'), el('h2', {}, 'Отзывы'))));
    for (const r of withText) {
      const av = el('span', { class: 'avatar' }, initial(r.user.nick));
      av.style.background = nickColor(r.user.nick);
      list.append(el('article', { class: 'panel review' + (r.hidden ? ' hidden-review' : '') },
        el('div', { class: 'bug-top' },
          el('div', { class: 'meta' }, el('div', { class: 'profile-line' }, av, ' ', el('b', {}, r.user.nick)), stars(r.stars)),
          el('span', { class: 'dim small' }, fmtDay(r.updated))),
        r.text ? el('div', { class: 'text' }, r.text) : null,
        admin ? el('button', { class: 'btn small ghost', type: 'button', onclick: () => hide(r) }, r.hidden ? 'Показать' : 'Скрыть') : null));
    }
  }

  async function load() {
    try {
      const d = await api('GET', '/api/reviews');
      renderSummary(d.summary);
      renderMine(d.mine);
      renderList(d.reviews);
    } catch (e) { list.append(el('div', { class: 'panel empty' }, e.message)); }
  }
  await load();
})();
