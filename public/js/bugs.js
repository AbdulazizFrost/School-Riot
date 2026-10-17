// Bug reports: the form (text first, then the photos / videos one by one with a progress bar) and the list
// of your own reports with their status. The same list rendering is used by the admin page (SR.bugCard).
'use strict';

const STATUS = { new: 'Новый', seen: 'Принят', progress: 'В работе', fixed: 'Исправлен', wontfix: 'Не баг' };

/** One report as a card: text, status, its photos / videos. */
SR.bugCard = function bugCard(b, extra) {
  const { el, fmtDate, fmtSize } = SR;
  return el('article', { class: 'panel bug' },
    el('div', { class: 'bug-top' },
      el('div', {},
        el('h3', {}, b.title),
        el('p', { class: 'dim small' }, `№ ${b.id} · ${fmtDate(b.created)}${b.version ? ' · версия ' + b.version : ''}${extra?.showAuthor ? ' · ' + b.user.nick : ''}`)),
      el('span', { class: `status ${b.status}` }, STATUS[b.status] || b.status)),
    el('div', { class: 'body' }, b.body),
    b.files.length ? el('div', { class: 'media' }, b.files.map((f) => f.kind === 'image'
      ? el('a', { href: `/media/${f.id}`, target: '_blank', rel: 'noopener', title: `${f.name} · ${fmtSize(f.size)}` }, el('img', { src: `/media/${f.id}`, alt: f.name, loading: 'lazy' }))
      : el('video', { src: `/media/${f.id}`, controls: true, preload: 'metadata', title: `${f.name} · ${fmtSize(f.size)}` }))) : null,
    extra?.controls || null);
};

(async () => {
  if (!document.getElementById('form-box')) return;   // (the admin page only borrows bugCard)
  const { el, api, toast, fmtSize, loginPrompt } = SR;
  const [user, info] = await Promise.all([SR.ready, SR.site()]);
  const formBox = document.getElementById('form-box');
  const mine = document.getElementById('mine');
  const lim = info.limits || { imageMB: 10, videoMB: 100, filesPerReport: 5 };

  if (!user) {
    formBox.append(loginPrompt('Чтобы отправить отчёт, войди в аккаунт — так мы сможем ответить и сообщить, когда исправим.'));
    mine.append(el('div', { class: 'panel empty' }, 'Здесь появятся твои отчёты.'));
    return;
  }

  // ---- the form
  const title = el('input', { class: 'input', maxlength: 120, required: true, placeholder: 'Например: застрял в стене у лестницы в главном зале' });
  const body = el('textarea', { class: 'input', maxlength: 4000, required: true, rows: 7, placeholder: 'Что делал, что случилось, как должно было быть' });
  const version = el('select', { class: 'input' },
    el('option', { value: info.version }, `${info.version} (последняя)`), el('option', { value: 'старая' }, 'Более старая'), el('option', { value: '' }, 'Не знаю'));
  const picker = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm', multiple: true, class: 'sr-only', id: 'files-input' });
  const drop = el('label', { class: 'drop', for: 'files-input' },
    el('b', {}, 'Перетащи сюда фото или видео'), el('br'),
    el('span', { class: 'small' }, `или нажми, чтобы выбрать · до ${lim.filesPerReport} файлов · фото до ${lim.imageMB} МБ, видео до ${lim.videoMB} МБ`));
  const filesBox = el('div', { class: 'files' });
  const error = el('p', { class: 'form-error', role: 'alert' });
  const send = el('button', { class: 'btn', type: 'submit' }, 'Отправить отчёт');
  const form = el('form', { novalidate: true },
    el('label', { class: 'field' }, el('span', {}, 'Коротко, что за баг'), title),
    el('label', { class: 'field' }, el('span', {}, 'Подробно'), body),
    el('label', { class: 'field' }, el('span', {}, 'Версия игры'), version),
    el('div', { class: 'field' }, el('span', {}, 'Фото и видео'), picker, drop, filesBox),
    error, send);
  formBox.append(el('span', { class: 'caption' }, 'Новый отчёт'), el('h3', {}, 'Опиши баг'), el('hr', { class: 'rule' }), form);

  let files = [];
  const IMG = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const VID = ['video/mp4', 'video/quicktime', 'video/webm'];

  function add(list) {
    for (const f of list) {
      if (files.length >= lim.filesPerReport) { toast(`Не больше ${lim.filesPerReport} файлов`, 'error'); break; }
      const isImg = IMG.includes(f.type), isVid = VID.includes(f.type);
      if (!isImg && !isVid) { toast(`${f.name}: можно только фото и видео`, 'error'); continue; }
      const max = (isImg ? lim.imageMB : lim.videoMB) * 1048576;
      if (f.size > max) { toast(`${f.name}: больше ${isImg ? lim.imageMB : lim.videoMB} МБ`, 'error'); continue; }
      const url = URL.createObjectURL(f);
      const progress = el('progress', { max: 100, value: 0 });
      const card = el('div', { class: 'file' },
        isImg ? el('img', { src: url, alt: '' }) : el('video', { src: url, muted: true, preload: 'metadata' }),
        el('div', {}, f.name.length > 28 ? f.name.slice(0, 25) + '…' : f.name, ' · ', fmtSize(f.size)),
        progress,
        el('button', { class: 'x', type: 'button', 'aria-label': 'Убрать файл', onclick: () => { files = files.filter((x) => x.file !== f); card.remove(); URL.revokeObjectURL(url); } }, '×'));
      files.push({ file: f, progress, card });
      filesBox.append(card);
    }
  }
  picker.addEventListener('change', () => { add(picker.files); picker.value = ''; });
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', (e) => add(e.dataTransfer.files));

  /** One file with a progress bar (XMLHttpRequest reports upload progress, fetch does not). */
  function upload(bugId, item) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('PUT', `/api/bugs/${bugId}/files`);
      x.setRequestHeader('X-SR', '1');
      x.setRequestHeader('X-File-Name', encodeURIComponent(item.file.name));
      x.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream');
      x.upload.onprogress = (e) => { if (e.lengthComputable) item.progress.value = Math.round((e.loaded / e.total) * 100); };
      x.onload = () => {
        let d = {};
        try { d = JSON.parse(x.responseText); } catch { d = {}; }
        if (x.status >= 200 && x.status < 300) resolve(d); else reject(new Error(d.error || `Ошибка ${x.status}`));
      };
      x.onerror = () => reject(new Error('Связь прервалась'));
      x.send(item.file);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (title.value.trim().length < 4) { error.textContent = 'Опиши баг в заголовке (хотя бы пара слов)'; title.focus(); return; }
    if (body.value.trim().length < 10) { error.textContent = 'Расскажи подробнее: что делал и что пошло не так'; body.focus(); return; }
    send.disabled = true;
    send.textContent = 'Отправляю…';
    try {
      const { id } = await api('POST', '/api/bugs', { title: title.value, body: body.value, version: version.value });
      const failed = [];
      for (const item of files) {
        try { await upload(id, item); item.progress.value = 100; }
        catch (err) { failed.push(`${item.file.name}: ${err.message}`); }
      }
      if (failed.length) toast(`Отчёт отправлен, но не все файлы загрузились — ${failed.join('; ')}`, 'error');
      else toast('Спасибо! Отчёт отправлен.', 'ok');
      form.reset();
      files.forEach((f) => f.card.remove());
      files = [];
      await loadMine();
    } catch (err) { error.textContent = err.message; }
    finally { send.disabled = false; send.textContent = 'Отправить отчёт'; }
  });

  // ---- my reports
  async function loadMine() {
    mine.textContent = '';
    try {
      const d = await api('GET', '/api/bugs');
      if (!d.bugs.length) { mine.append(el('div', { class: 'panel empty' }, 'Ты ещё не отправлял отчётов.')); return; }
      for (const b of d.bugs) mine.append(SR.bugCard(b));
    } catch (e) { mine.append(el('div', { class: 'panel empty' }, e.message)); }
  }
  await loadMine();
})();
