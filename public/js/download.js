// The download page: what is in downloads/ (version, size, SHA-256) and the requirements from the config.
'use strict';

(async () => {
  const { el, api, fmtSize, toast, plural } = SR;
  const box = document.getElementById('files');
  let d;
  try { d = await api('GET', '/api/downloads'); }
  catch (e) { box.append(el('div', { class: 'panel empty' }, e.message)); return; }

  for (const r of d.requirements || []) document.getElementById('reqs').append(el('li', {}, r));

  const files = d.files.length ? d.files : [{ title: 'School Riot для Windows', version: d.version, platform: 'Windows', available: false }];
  for (const f of files) {
    const hash = el('dd', { class: 'hash' }, f.available ? (f.sha256 || 'считается…') : '—');
    const card = el('section', { class: 'panel dl-card' },
      el('div', {},
        el('span', { class: 'caption' }, `Версия ${f.version}`),
        el('h2', {}, f.title),
        f.notes ? el('p', { class: 'dim' }, f.notes) : null,
        el('dl', { class: 'kv' },
          el('dt', {}, 'Система'), el('dd', {}, f.platform),
          el('dt', {}, 'Размер'), el('dd', {}, f.available ? fmtSize(f.size) : '—'),
          f.released ? [el('dt', {}, 'Выход'), el('dd', {}, f.released)] : null,
          el('dt', {}, 'SHA-256'), hash)),
      f.available
        ? el('a', { class: 'btn-play', href: `/download/${encodeURIComponent(f.file)}`, download: f.file, onclick: () => toast('Загрузка началась', 'ok') }, 'Скачать', el('span', { class: 'chevrons' }, '›››'))
        : el('span', { class: 'btn-play', 'aria-disabled': 'true' }, 'Скоро'));
    box.append(card);
    if (f.available && f.sha256) {
      hash.textContent = '';
      hash.append(f.sha256, ' ', el('button', { class: 'btn small ghost', type: 'button', onclick: () => navigator.clipboard?.writeText(f.sha256).then(() => toast('Скопировано', 'ok')) }, 'Копировать'));
    }
  }
  if (d.total > 0) box.append(el('p', { class: 'dim small' }, `Уже скачали: ${d.total} ${plural(d.total, 'раз', 'раза', 'раз')}`));
})();
