'use strict';

// «Hvem er her»: viser profilbildene til de andre som er på samme side akkurat nå.
// Trenger media.js (onLive, avatarEl).
(function () {
  const ROOM_NAMES = {
    hjem: 'forsiden',
    'kasino-wheel': 'lykkehjulet',
    'kasino-slot': 'automaten',
    'kasino-roulette': 'rouletten',
    'kasino-blackjack': 'blackjack-bordet',
    'kasino-poker': 'pokerbordet',
    'kasino-bar': 'baren',
    chat: 'chatten',
    pvp: 'PvP',
    duell: 'duell',
    mogg: 'mogg-off',
    oppgaver: 'oppgavene',
    flappy: 'Flappy Sjef',
    profil: 'profilene',
  };

  function currentRoom() {
    const path = location.pathname.replace(/\/$/, '') || '/';
    if (path === '/' || path === '/index.html') return 'hjem';
    if (path === '/kasino.html') return `kasino-${document.body.dataset.tab || 'wheel'}`;
    if (path === '/spill.html') return 'flappy';
    const page = path.replace(/^\//, '').replace(/\.html$/, '');
    return ROOM_NAMES[page] ? page : null;
  }

  let room = currentRoom();
  let rooms = {};
  let me = null;
  const known = new Set(); // hvem vi allerede har vist i dette rommet

  // ---------- Visning ----------
  const box = document.createElement('div');
  box.className = 'presence hidden';
  box.innerHTML = '<button type="button" class="presence-stack" title="Hvem er her"></button><div class="presence-list hidden"></div>';
  document.body.appendChild(box);
  const stack = box.querySelector('.presence-stack');
  const list = box.querySelector('.presence-list');
  stack.addEventListener('click', () => list.classList.toggle('hidden'));
  document.addEventListener('click', (e) => {
    if (!box.contains(e.target)) list.classList.add('hidden');
  });

  function toast(text, avatar, name) {
    const t = document.createElement('div');
    t.className = 'presence-toast';
    t.append(avatarEl(avatar, name, 26), document.createTextNode(text));
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function render() {
    const here = (rooms[room] || []).filter((x) => !me || x.name !== me);
    box.classList.toggle('hidden', !here.length);
    stack.innerHTML = '';
    here.slice(0, 5).forEach((x, i) => {
      const a = avatarEl(x.avatar, x.name, 32);
      a.style.zIndex = 10 - i;
      if (!known.has(x.name)) a.classList.add('pop');
      stack.appendChild(a);
    });
    if (here.length > 5) {
      const more = document.createElement('span');
      more.className = 'presence-more';
      more.textContent = `+${here.length - 5}`;
      stack.appendChild(more);
    }
    const eye = document.createElement('span');
    eye.className = 'presence-count';
    eye.textContent = `👀 ${here.length}`;
    stack.appendChild(eye);

    list.innerHTML = '';
    const title = document.createElement('p');
    title.className = 'presence-title';
    title.textContent = `Her på ${ROOM_NAMES[room] || 'siden'} nå:`;
    list.appendChild(title);
    here.forEach((x) => {
      const a = document.createElement('a');
      a.href = `/profil.html?navn=${encodeURIComponent(x.name)}`;
      a.className = 'presence-person';
      a.append(avatarEl(x.avatar, x.name, 28), document.createTextNode(x.name));
      list.appendChild(a);
    });

    // Si ifra når noen nye kommer inn (ikke ved første lasting)
    here.forEach((x) => {
      if (known.has('__loaded') && !known.has(x.name)) {
        toast(`${x.name.split(' ')[0]} kom inn 👋`, x.avatar, x.name);
      }
    });
    known.clear();
    known.add('__loaded');
    here.forEach((x) => known.add(x.name));

    // Fortell resten av siden (f.eks. flisene på forsiden) hvor folk er
    document.dispatchEvent(new CustomEvent('presence', { detail: { rooms, me } }));
  }

  // ---------- Livstegn ----------
  async function ping() {
    room = currentRoom();
    if (!room) return;
    try {
      const res = await fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room }),
      });
      const json = await res.json();
      rooms = json.rooms || {};
      render();
    } catch { /* ignorer */ }
  }

  // Bytte av rom uten ny side (fanene i kasinoet)
  window.updatePresenceRoom = () => {
    if (currentRoom() === room) return;
    known.clear();
    ping();
  };

  onLive('presence', (r) => {
    rooms = r || {};
    render();
  });

  window.addEventListener('pagehide', () => {
    if (navigator.sendBeacon) navigator.sendBeacon('/api/presence/leave', new Blob(['{}'], { type: 'application/json' }));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ping();
  });

  // Hvem er jeg (så jeg ikke vises for meg selv)
  fetch('/api/state').then((r) => r.json()).then((d) => {
    me = d.me ? d.me.name : null;
    render();
  }).catch(() => {});

  ping();
  setInterval(() => document.visibilityState === 'visible' && ping(), 20000);
})();
