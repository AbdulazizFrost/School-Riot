// The home page: the trailer (the YouTube one when set in site.config.json, loaded only on a click so
// nothing from YouTube runs before; the site's own copy otherwise), the rating, the gallery, the links.
'use strict';

(async () => {
  const { el, api, site, toast, stars, plural, socialButtons } = SR;
  const info = await site();

  document.getElementById('version-chip').textContent = `Версия ${info.version || '—'}`;

  // ---- trailer
  const box = document.getElementById('trailer-box');
  // the cover: the video's own from YouTube (its big one when the video has it; YouTube answers a missing one
  // with a 120 px placeholder, then the standard one), the site's copy otherwise
  const cover = el('img', { class: 'poster-img', alt: '', src: info.trailerId ? `https://i.ytimg.com/vi/${info.trailerId}/maxresdefault.jpg` : '/img/trailer_poster.jpg' });
  if (info.trailerId) {
    cover.addEventListener('load', () => { if (cover.naturalWidth <= 120) cover.src = `https://i.ytimg.com/vi/${info.trailerId}/hqdefault.jpg`; });
    cover.addEventListener('error', () => { cover.src = '/img/trailer_poster.jpg'; }, { once: true });
  }
  const poster = el('button', { class: 'poster-btn', type: 'button', 'aria-label': 'Смотреть трейлер' }, cover, el('span', {}, '▶'));
  poster.addEventListener('click', () => {
    if (info.trailerId) {
      box.replaceChildren(el('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${info.trailerId}?autoplay=1&rel=0`,
        title: 'Трейлер School Riot', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
      }));
    } else {
      const v = el('video', { src: '/video/trailer.mp4', controls: true, autoplay: true, playsinline: true, poster: '/img/trailer_poster.jpg' });
      box.replaceChildren(v);
      v.play().catch(() => {});
    }
  });
  box.append(poster);

  // ---- rating
  try {
    const s = await api('GET', '/api/reviews/summary');
    const chip = document.getElementById('rating-chip');
    chip.textContent = '';
    if (s.count) {
      chip.append(el('span', { class: 'star' }, '★'), ` ${s.average.toFixed(1)} · ${s.count} ${plural(s.count, 'оценка', 'оценки', 'оценок')}`);
      const line = document.getElementById('reviews-line');
      line.textContent = '';
      line.append(stars(s.average), ` ${s.average.toFixed(1)} из 5 — ${s.count} ${plural(s.count, 'оценка', 'оценки', 'оценок')}`);
    } else {
      chip.append(el('span', { class: 'star' }, '★'), ' Оцени первым');
    }
  } catch { /* the chip stays as it is */ }

  // ---- chat: how many are there now (a real count of open chat pages)
  try {
    const c = await api('GET', '/api/chat');
    if (c.online > 0) {
      const p = document.getElementById('chat-online');
      p.append(el('i'), `Сейчас в чате: ${c.online}`);
    }
  } catch { /* nothing */ }

  // ---- gallery
  const gallery = document.getElementById('gallery');
  gallery.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-full]');
    if (!b) return;
    const close = () => { lb.remove(); document.removeEventListener('keydown', onKey); b.focus(); };
    const onKey = (k) => { if (k.key === 'Escape') close(); };
    const lb = el('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', onclick: (ev) => { if (ev.target === lb) close(); } },
      el('img', { src: b.dataset.full, alt: b.querySelector('img').alt }),
      el('button', { class: 'btn small close', type: 'button', onclick: close }, 'Закрыть'));
    document.body.append(lb);
    document.addEventListener('keydown', onKey);
    lb.querySelector('.close').focus();
  });

  // ---- YouTube / Instagram
  if (socialButtons(document.getElementById('social'), info) > 0) document.getElementById('follow').classList.remove('hidden');

  if (new URLSearchParams(location.search).has('deleted')) toast('Аккаунт удалён', 'ok');
})();
