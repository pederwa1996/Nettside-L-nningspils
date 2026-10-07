'use strict';

// Skalerer ned et bilde fra kamera/galleri og gjør det om til JPEG (data-URL),
// så opplastingen blir liten og rask også på mobilnett.
function resizeImage(file, maxSize, quality = 0.82, square = false) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Velg et bilde.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (square) {
        const side = Math.min(sw, sh);
        sx = (sw - side) / 2;
        sy = (sh - side) / 2;
        sw = sh = side;
      }
      const scale = Math.min(1, maxSize / Math.max(sw, sh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Klarte ikke å lese bildet. Prøv igjen.'));
    };
    img.src = url;
  });
}

// Lager et runde profilbilde-element (eller en plassholder med forbokstav)
function avatarEl(url, name, size = 36) {
  const el = document.createElement(url ? 'img' : 'span');
  el.className = 'avatar';
  el.style.width = el.style.height = `${size}px`;
  if (url) {
    el.src = url;
    el.alt = name || '';
    el.loading = 'lazy';
  } else {
    el.textContent = (name || '?').charAt(0).toUpperCase();
    el.style.fontSize = `${Math.round(size * 0.45)}px`;
  }
  return el;
}

function timeAgo(ms) {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return 'nå nettopp';
  if (min < 60) return `${min} min siden`;
  const h = Math.floor(min / 60);
  return h === 1 ? '1 time siden' : `${h} timer siden`;
}

function timeOfDay(ms) {
  return new Date(ms).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
}

// Felles live-tilkobling. Andre skript kan lytte med onLive('chat', fn) osv.
const liveHandlers = {};
function onLive(event, fn) {
  (liveHandlers[event] = liveHandlers[event] || []).push(fn);
}
(function connectLive() {
  if (!window.EventSource) return;
  const es = new EventSource('/api/events');
  ['chat', 'chat-reload', 'stories', 'avatars', 'tasks', 'orders', 'casino-win', 'activity', 'reactions', 'poker', 'presence', 'notify', 'beer-win', 'arena', 'bj', 'roulette', 'wallposts'].forEach((ev) =>
    es.addEventListener(ev, (e) => (liveHandlers[ev] || []).forEach((fn) => fn(JSON.parse(e.data)))));
})();
