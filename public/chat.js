'use strict';

(function () {
  const list = document.getElementById('messages');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  let me = null;
  const shown = new Set();
  let lastName = null;
  let lastAt = 0;

  function nearBottom() {
    return window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
  }

  function scrollDown() {
    window.scrollTo(0, document.body.scrollHeight);
  }

  function addMessage(m) {
    if (shown.has(m.id)) return;
    shown.add(m.id);
    const mine = me && m.name === me.name;
    // Grupper meldinger fra samme person innen 3 minutter
    const grouped = m.name === lastName && m.at - lastAt < 3 * 60 * 1000;
    lastName = m.name;
    lastAt = m.at;

    const row = document.createElement('div');
    row.className = 'msg' + (mine ? ' mine' : '') + (grouped ? ' grouped' : '');
    if (!mine) {
      const av = grouped ? document.createElement('span') : avatarEl(m.avatar, m.name, 34);
      if (grouped) av.className = 'avatar-spacer';
      row.appendChild(av);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (!mine && !grouped) {
      const n = document.createElement('div');
      n.className = 'msg-name';
      n.textContent = m.name;
      bubble.appendChild(n);
    }
    const t = document.createElement('div');
    t.className = 'msg-text';
    t.textContent = m.text;
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = timeOfDay(m.at);
    bubble.append(t, time);
    row.appendChild(bubble);
    list.appendChild(row);
  }

  async function load() {
    const res = await fetch('/api/chat');
    const data = await res.json();
    me = data.me;
    form.classList.toggle('hidden', !me);
    document.getElementById('chat-join').classList.toggle('hidden', !!me);
    list.innerHTML = '';
    shown.clear();
    lastName = null;
    if (!data.messages.length) list.innerHTML = '<p class="muted center empty-chat">Ingen meldinger ennå. Si hei! 👋</p>';
    data.messages.forEach(addMessage);
    scrollDown();
  }

  form.addEventListener('submit', async (e) => {
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
      const empty = list.querySelector('.empty-chat');
      if (empty) empty.remove();
      addMessage(json.message);
      scrollDown();
    } catch (err) {
      input.value = text;
      alert(err.message || 'Kunne ikke sende meldingen.');
    }
    input.focus();
  });

  onLive('chat', (m) => {
    const stick = nearBottom();
    const empty = list.querySelector('.empty-chat');
    if (empty) empty.remove();
    addMessage(m);
    if (stick || (me && m.name === me.name)) scrollDown();
  });
  onLive('chat-reload', load);

  // Fallback: hent på nytt innimellom i tilfelle live-tilkoblingen faller ut
  setInterval(async () => {
    try {
      const data = await (await fetch('/api/chat')).json();
      const stick = nearBottom();
      let added = false;
      data.messages.forEach((m) => {
        if (!shown.has(m.id)) {
          addMessage(m);
          added = true;
        }
      });
      if (added && stick) scrollDown();
    } catch { /* ignorer */ }
  }, 15000);

  load();
})();
