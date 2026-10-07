'use strict';

// 🔔 Varsler til den innloggede brukeren: godkjente oppgaver, likes, kommentarer,
// duell-utfordringer, levert pils osv. Boble nede til venstre på alle sider,
// og en liten melding som spretter opp når noe nytt kommer live.
(function () {
  let me = null;
  let unread = 0;
  let items = [];
  let seen = null; // id-ene vi allerede har vist, så bare nye gir melding
  let bubble;
  let panel;
  let toasts;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function ago(ms) {
    const min = Math.floor((Date.now() - ms) / 60000);
    if (min < 1) return 'nå nettopp';
    if (min < 60) return `${min} min siden`;
    const h = Math.floor(min / 60);
    return h < 24 ? `${h} t siden` : new Date(ms).toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
  }

  function icon(n) {
    // Profilbilde av den som gjorde noe, med ikonet som et lite merke
    const wrap = el('span', 'nt-icon');
    if (n.avatar) {
      const img = el('img', 'avatar nt-avatar');
      img.src = n.avatar;
      img.alt = '';
      wrap.append(img, el('span', 'nt-emoji small', n.icon));
    } else {
      wrap.appendChild(el('span', 'nt-emoji', n.icon));
    }
    return wrap;
  }

  function go(n) {
    if (!n.url) return;
    location.href = n.url;
    // Lenke til samme side med bare ny #-del laster ikke siden på nytt
    if (n.url.includes('#') && n.url.split('#')[0] === location.pathname) closePanel();
  }

  function build() {
    bubble = el('button', 'notify-bubble');
    bubble.type = 'button';
    bubble.title = 'Varsler';
    bubble.innerHTML = '🔔<span class="admin-badge hidden">0</span>';
    panel = el('div', 'notify-panel hidden');
    panel.innerHTML = '<div class="ao-head"><strong>🔔 Varsler</strong><button type="button" class="ao-close" title="Lukk">✕</button></div><div class="nt-list"></div>';
    toasts = el('div', 'notify-toasts');
    document.body.append(bubble, panel, toasts);
    bubble.addEventListener('click', () => (panel.classList.contains('hidden') ? openPanel() : closePanel()));
    panel.querySelector('.ao-close').addEventListener('click', closePanel);
  }

  function render() {
    const badge = bubble.querySelector('.admin-badge');
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.classList.toggle('hidden', !unread);
    bubble.classList.toggle('has-unread', unread > 0);
    const list = panel.querySelector('.nt-list');
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(el('p', 'muted', 'Ingen varsler ennå. Her dukker det opp når noen liker eller kommenterer bildene dine, når oppgaver blir godkjent og mye mer.'));
      return;
    }
    items.forEach((n) => {
      const row = el(n.url ? 'a' : 'div', 'nt-item' + (n.read ? '' : ' unread'));
      if (n.url) row.href = n.url;
      const text = el('div', 'nt-text');
      text.append(el('span', '', n.text), el('small', 'muted', ago(n.at)));
      row.append(icon(n), text);
      if (n.url) row.addEventListener('click', (e) => { e.preventDefault(); go(n); });
      list.appendChild(row);
    });
  }

  function toast(n) {
    const t = el('button', 'notify-toast');
    t.type = 'button';
    t.append(icon(n), el('span', 'nt-text', n.text));
    t.addEventListener('click', () => (n.open ? openPanel() : go(n)));
    // Maks to meldinger synlige samtidig
    while (toasts.children.length >= 2) toasts.firstChild.remove();
    toasts.appendChild(t);
    setTimeout(() => t.remove(), 6000);
    if (navigator.vibrate) navigator.vibrate(120);
    bubble.classList.remove('pulse');
    void bubble.offsetWidth;
    bubble.classList.add('pulse');
  }

  async function load() {
    let data;
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return; // ikke innlogget
      data = await res.json();
    } catch {
      return;
    }
    if (!bubble) build();
    me = data.name;
    items = data.items;
    unread = data.unread;
    // Nye uleste varsler siden sist: vis dem som en melding (ikke ved første lasting)
    if (seen && panel.classList.contains('hidden')) {
      const fresh = items.filter((n) => !n.read && !seen.has(n.id));
      // Mange på en gang: én samlet melding i stedet for en vegg av meldinger
      if (fresh.length > 2) toast({ icon: '🔔', text: `Du har ${unread} nye varsler. Trykk for å se dem.`, open: true });
      else fresh.reverse().forEach(toast);
    }
    seen = new Set(items.map((n) => n.id));
    // Panelet er åpent: det man ser nå er lest
    if (!panel.classList.contains('hidden') && unread) markRead();
    render();
  }

  function markRead() {
    unread = 0;
    fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  }

  function openPanel() {
    panel.classList.remove('hidden');
    toasts.innerHTML = '';
    // De uleste beholder markeringen mens panelet er åpent, men telleren nullstilles
    if (unread) markRead();
    render();
  }

  function closePanel() {
    panel.classList.add('hidden');
    items.forEach((n) => (n.read = true));
    render();
  }

  const onNotify = (msg) => {
    if (!msg || !me || msg.to === me) load();
  };
  if (window.onLive) window.onLive('notify', onNotify);
  else if (window.EventSource) new EventSource('/api/events').addEventListener('notify', (e) => onNotify(JSON.parse(e.data)));
  // Navnebytte: hent på nytt så «me» stemmer
  if (window.onLive) window.onLive('avatars', load);
  setInterval(load, 30000);
  load();
})();
