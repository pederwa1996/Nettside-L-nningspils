'use strict';

// 💬 Chatten som en boble nede i hjørnet på alle sider. Trykker man på den, folder
// chatten seg ut over siden man er på, så man kan prate uten å bytte side.
// Trenger media.js (onLive, avatarEl, timeOfDay).
(function () {
  let me = null;
  let open = false;
  let lastRead = 0;
  const shown = new Set();
  let lastName = null;
  let lastAt = 0;
  let bubble;
  let panel;
  let list;
  let input;
  let peek;

  try {
    lastRead = Number(localStorage.getItem('chatLastRead')) || 0;
  } catch { /* ignorer */ }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function build() {
    bubble = el('button', 'chat-bubble');
    bubble.type = 'button';
    bubble.title = 'Chat';
    bubble.innerHTML = '💬<span class="admin-badge hidden">0</span>';
    panel = el('div', 'chatbox hidden');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat');
    panel.innerHTML = `
      <div class="cb-head"><strong>💬 Chat</strong><span class="cb-sub">Alle på lønningspilsen</span><button type="button" class="cb-close" title="Lukk">✕</button></div>
      <div class="cb-list"></div>
      <form class="cb-form">
        <input type="text" maxlength="500" placeholder="Skriv en melding ..." autocomplete="off" enterkeyhint="send">
        <button type="submit">Send</button>
      </form>`;
    peek = el('button', 'chat-peek hidden');
    peek.type = 'button';
    document.body.append(panel, bubble, peek);
    list = panel.querySelector('.cb-list');
    input = panel.querySelector('input');
    bubble.addEventListener('click', () => (open ? close() : openChat()));
    peek.addEventListener('click', openChat);
    panel.querySelector('.cb-close').addEventListener('click', close);
    panel.querySelector('.cb-form').addEventListener('submit', send);
    document.addEventListener('keydown', (e) => e.key === 'Escape' && open && close());
  }

  // ---------- Meldinger ----------
  function addMessage(m) {
    if (shown.has(m.id)) return false;
    shown.add(m.id);
    const empty = list.querySelector('.empty-chat');
    if (empty) empty.remove();
    const mine = me && m.name === me;
    // Grupper meldinger fra samme person innen 3 minutter
    const grouped = m.name === lastName && m.at - lastAt < 3 * 60 * 1000;
    lastName = m.name;
    lastAt = m.at;
    const row = el('div', 'msg' + (mine ? ' mine' : '') + (grouped ? ' grouped' : ''));
    if (!mine) {
      let av;
      if (grouped) av = el('span', 'avatar-spacer');
      else {
        av = el('a');
        av.href = `/profil.html?navn=${encodeURIComponent(m.name)}`;
        av.appendChild(avatarEl(m.avatar, m.name, 32));
      }
      row.appendChild(av);
    }
    const b = el('div', 'bubble');
    if (!mine && !grouped) {
      const n = el('a', 'msg-name', m.name);
      n.href = `/profil.html?navn=${encodeURIComponent(m.name)}`;
      b.appendChild(n);
    }
    b.append(el('div', 'msg-text', m.text), el('span', 'msg-time', timeOfDay(m.at)));
    row.appendChild(b);
    list.appendChild(row);
    return true;
  }

  function nearBottom() {
    return list.scrollTop + list.clientHeight >= list.scrollHeight - 80;
  }

  function scrollDown() {
    list.scrollTop = list.scrollHeight;
  }

  let messages = [];

  function renderAll() {
    list.innerHTML = '';
    shown.clear();
    lastName = null;
    if (!messages.length) list.appendChild(el('p', 'muted center empty-chat', 'Ingen meldinger ennå. Si hei! 👋'));
    messages.forEach(addMessage);
    scrollDown();
  }

  function unreadCount() {
    return messages.filter((m) => m.at > lastRead && m.name !== me).length;
  }

  function markRead() {
    const newest = messages.length ? messages[messages.length - 1].at : Date.now();
    lastRead = Math.max(lastRead, newest);
    try {
      localStorage.setItem('chatLastRead', String(lastRead));
    } catch { /* ignorer */ }
    renderBadge();
  }

  function renderBadge() {
    const n = open ? 0 : unreadCount();
    const badge = bubble.querySelector('.admin-badge');
    badge.textContent = n > 9 ? '9+' : n;
    badge.classList.toggle('hidden', !n);
    bubble.classList.toggle('has-unread', n > 0);
  }

  // Ny melding mens chatten er lukket: vis den kort ved boblen
  let peekTimer = null;
  function showPeek(m) {
    peek.innerHTML = '';
    peek.append(avatarEl(m.avatar, m.name, 28));
    const t = el('span', 'cp-peek-text');
    t.append(el('strong', '', `${m.name}: `), document.createTextNode(m.text));
    peek.appendChild(t);
    peek.classList.remove('hidden');
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => peek.classList.add('hidden'), 4500);
    bubble.classList.remove('pulse');
    void bubble.offsetWidth;
    bubble.classList.add('pulse');
  }

  async function load() {
    const res = await fetch('/api/chat');
    const data = await res.json();
    if (!data.me) return false; // ikke innlogget: ingen chat
    me = data.me.name;
    messages = data.messages;
    if (!bubble) build();
    renderAll();
    renderBadge();
    return true;
  }

  // ---------- Åpne / lukke ----------
  function openChat() {
    if (!bubble) return;
    open = true;
    panel.classList.remove('hidden');
    bubble.classList.add('active');
    peek.classList.add('hidden');
    document.body.classList.add('chat-open');
    scrollDown();
    markRead();
    // På mobil dukker tastaturet opp; ikke fokuser automatisk der, det dekker meldingene
    if (window.matchMedia('(pointer: fine)').matches) input.focus();
  }

  function close() {
    open = false;
    panel.classList.add('hidden');
    bubble.classList.remove('active');
    document.body.classList.remove('chat-open');
    renderBadge();
  }
  window.openChat = () => (bubble ? openChat() : load().then((ok) => ok && openChat()));

  async function send(e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      messages.push(json.message);
      addMessage(json.message);
      if (window.sfx) sfx.play('send');
      scrollDown();
      markRead();
    } catch (err) {
      input.value = text;
      alert(err.message || 'Kunne ikke sende meldingen.');
    }
    input.focus();
  }

  // ---------- Live ----------
  onLive('chat', (m) => {
    if (!bubble) return;
    if (!messages.some((x) => x.id === m.id)) messages.push(m);
    const stick = nearBottom();
    addMessage(m);
    if (open) {
      if (stick || m.name === me) scrollDown();
      markRead();
    } else {
      renderBadge();
      if (m.name !== me) {
        showPeek(m);
        if (window.sfx) sfx.play('pop');
      }
    }
  });
  onLive('chat-reload', () => bubble && load());

  // Fallback hvis live-tilkoblingen faller ut
  setInterval(async () => {
    if (!bubble) return;
    try {
      const data = await (await fetch('/api/chat')).json();
      const stick = nearBottom();
      let added = false;
      data.messages.forEach((m) => {
        if (!messages.some((x) => x.id === m.id)) {
          messages.push(m);
          if (addMessage(m)) added = true;
        }
      });
      if (added) {
        if (open) {
          if (stick) scrollDown();
          markRead();
        } else renderBadge();
      }
    } catch { /* ignorer */ }
  }, 15000);

  load().then((ok) => {
    // Lenker til #chat (og den gamle chat-siden) åpner chatten med en gang
    if (ok && location.hash === '#chat') {
      history.replaceState(null, '', location.pathname + location.search);
      openChat();
    }
  }).catch(() => {});
})();
