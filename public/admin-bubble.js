'use strict';

// Bobler for spillmesteren (admin): 🍺 bestillinger og 🎯 oppgaver som må godkjennes.
// Vises på alle sider så lenge admin er logget inn i denne fanen (passordet ligger
// i sessionStorage), eller når admin-profilen er innlogget.
(function () {
  let password = '';
  try {
    password = sessionStorage.getItem('adminPassword') || '';
  } catch { /* ignorer */ }
  if (password) start();
  // Spillmesteren (admin-profilen) får boblen uten passord
  else fetch('/api/admin/me').then((r) => r.json()).then((r) => r.admin && start()).catch(() => {});

  function start() {
  if (document.querySelector('.admin-bubble')) return;
  let lastCount = null;
  let budget = null; // kroner igjen på kortet (fra serveren)
  let open = false;
  let audio = null;

  const bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.className = 'admin-bubble';
  bubble.title = 'Bestillinger til bordet';
  bubble.innerHTML = '🍺<span class="admin-badge hidden">0</span>';
  const panel = document.createElement('div');
  panel.className = 'admin-orders hidden';
  panel.innerHTML = `
    <div class="ao-head"><strong>🍺 Bestillinger</strong><button type="button" class="ao-close" title="Lukk">✕</button></div>
    <a class="ao-budget" href="/admin.html" title="Budsjett"></a>
    <div class="ao-list"></div>
    <p class="ao-sub">Nylig</p>
    <div class="ao-recent"></div>`;
  document.body.append(bubble, panel);

  const badge = bubble.querySelector('.admin-badge');

  async function post(path, body = {}) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, ...body }),
    });
    const json = await res.json();
    if (res.status === 403) {
      // Feil passord (f.eks. endret): skjul boblen
      try {
        sessionStorage.removeItem('adminPassword');
      } catch { /* ignorer */ }
      document.querySelectorAll('.admin-bubble, .admin-orders').forEach((el) => el.remove());
      throw new Error('Ikke innlogget');
    }
    if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
    return json;
  }

  // Lydvarsel. Nettlesere tillater bare lyd etter at man har trykket på siden én gang.
  document.addEventListener('pointerdown', () => {
    if (!audio && window.AudioContext) audio = new AudioContext();
  }, { once: true });

  function ding() {
    if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
    if (!audio) return;
    [880, 1320].forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, audio.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + i * 0.15 + 0.25);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + i * 0.15);
      osc.stop(audio.currentTime + i * 0.15 + 0.3);
    });
  }

  function avatar(url, name) {
    const el = document.createElement(url ? 'img' : 'span');
    el.className = 'avatar ao-avatar';
    if (url) el.src = url;
    else el.textContent = (name || '?').charAt(0).toUpperCase();
    return el;
  }

  function ago(ms) {
    const min = Math.floor((Date.now() - ms) / 60000);
    return min < 1 ? 'nå nettopp' : `${min} min siden`;
  }

  function orderRow(o, actions) {
    const row = document.createElement('div');
    row.className = 'ao-order';
    const info = document.createElement('div');
    info.className = 'ao-info';
    const title = document.createElement('strong');
    title.textContent = `${o.name}: ${o.qty} × 🍺`;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = `${o.pay === 'flus' ? `${o.cost} cash` : 'til gode'} · ${ago(o.at)}`;
    info.append(title, meta);
    if (o.note) {
      const note = document.createElement('span');
      note.className = 'ao-note';
      note.textContent = `📍 ${o.note}`;
      info.appendChild(note);
    }
    row.append(avatar(o.avatar, o.name), info);
    if (actions) {
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'small-btn';
      ok.textContent = budget ? `✅ Levert (−${o.qty * budget.price} kr)` : '✅ Levert';
      ok.addEventListener('click', () => setStatus(o, 'delivered'));
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'secondary small-btn';
      no.textContent = '❌';
      no.title = 'Avbryt (cash betales tilbake)';
      no.addEventListener('click', () => {
        if (confirm(`Avbryte bestillingen til ${o.name}?`)) setStatus(o, 'cancelled');
      });
      const btns = document.createElement('div');
      btns.className = 'ao-btns';
      btns.append(ok, no);
      row.appendChild(btns);
    } else {
      const st = document.createElement('span');
      st.textContent = o.status === 'delivered' ? '✅' : '❌';
      row.appendChild(st);
    }
    return row;
  }

  async function load() {
    let data;
    try {
      data = await post('/api/admin/orders');
    } catch {
      return;
    }
    budget = data.budget;
    const b = data.budget;
    panel.querySelector('.ao-budget').innerHTML = b
      ? `💳 <b>${b.remaining.toLocaleString('no-NO')} kr</b> igjen · nok til ${b.affordable} pils<br><small>🎟️ ${b.owed} til gode + ⏳ ${b.pending} bestilt ≈ ${b.potential.toLocaleString('no-NO')} kr</small>`
      : '';
    const count = data.pending.reduce((sum, o) => sum + o.qty, 0);
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
    bubble.classList.toggle('has-orders', count > 0);
    if (lastCount !== null && count > lastCount) {
      ding();
      bubble.classList.remove('pulse');
      void bubble.offsetWidth;
      bubble.classList.add('pulse');
    }
    lastCount = count;

    const list = panel.querySelector('.ao-list');
    list.innerHTML = '';
    if (!data.pending.length) list.innerHTML = '<p class="muted">Ingen bestillinger venter 🎉</p>';
    data.pending.forEach((o) => list.appendChild(orderRow(o, true)));
    const recent = panel.querySelector('.ao-recent');
    recent.innerHTML = '';
    data.recent.slice(0, 5).forEach((o) => recent.appendChild(orderRow(o, false)));
    panel.querySelector('.ao-sub').classList.toggle('hidden', !data.recent.length);
  }

  async function setStatus(o, status) {
    try {
      await post('/api/admin/order-status', { id: o.id, status });
    } catch (err) {
      alert(err.message);
    }
    load();
  }

  bubble.addEventListener('click', () => {
    open = !open;
    panel.classList.toggle('hidden', !open);
    if (open) closeTasks();
  });
  panel.querySelector('.ao-close').addEventListener('click', () => {
    open = false;
    panel.classList.add('hidden');
  });

  // ---------- 🎯 Oppgaver som venter på godkjenning ----------
  let lastTasks = null;
  const tBubble = document.createElement('button');
  tBubble.type = 'button';
  tBubble.className = 'admin-bubble task-bubble';
  tBubble.title = 'Oppgaver som må godkjennes';
  tBubble.innerHTML = '🎯<span class="admin-badge hidden">0</span>';
  const tPanel = document.createElement('div');
  tPanel.className = 'admin-orders hidden';
  tPanel.innerHTML = `
    <div class="ao-head"><strong>🎯 Til godkjenning</strong><button type="button" class="ao-close" title="Lukk">✕</button></div>
    <div class="ao-list"></div>
    <p class="ao-sub"><a href="/admin.html">Alle oppgaver i admin ›</a></p>`;
  document.body.append(tBubble, tPanel);
  const tBadge = tBubble.querySelector('.admin-badge');

  function closeTasks() {
    tPanel.classList.add('hidden');
  }
  tBubble.addEventListener('click', () => {
    const show = tPanel.classList.contains('hidden');
    tPanel.classList.toggle('hidden', !show);
    if (show) {
      open = false;
      panel.classList.add('hidden');
    }
  });
  tPanel.querySelector('.ao-close').addEventListener('click', closeTasks);

  function taskRow(t) {
    const box = document.createElement('div');
    box.className = 'ao-task';
    const head = document.createElement('div');
    head.className = 'ao-order';
    const info = document.createElement('div');
    info.className = 'ao-info';
    const title = document.createElement('strong');
    title.textContent = `${t.name}: ${t.title}`;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = `🎰 ${t.reward} spinn + 💰 ${t.cash} cash · ${ago(t.at)}`;
    info.append(title, meta);
    head.append(avatar(t.avatar, t.name), info);
    box.appendChild(head);
    if (t.url) {
      const img = document.createElement('img');
      img.src = t.url;
      img.className = 'ao-proof';
      img.alt = 'Bevis';
      img.title = 'Trykk for større bilde';
      img.addEventListener('click', () => img.classList.toggle('big'));
      box.appendChild(img);
    }
    if (t.text) {
      const q = document.createElement('blockquote');
      q.className = 'ao-quote';
      q.textContent = t.text;
      box.appendChild(q);
    }
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'small-btn';
    ok.textContent = '✅ Godkjenn';
    ok.addEventListener('click', () => review(t, true));
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'secondary small-btn';
    no.textContent = '❌ Avvis';
    no.addEventListener('click', () => {
      const reason = prompt(`Hvorfor avvises «${t.title}»? (vises for ${t.name}, valgfritt)`);
      if (reason !== null) review(t, false, reason);
    });
    const btns = document.createElement('div');
    btns.className = 'ao-btns ao-task-btns';
    btns.append(ok, no);
    box.appendChild(btns);
    return box;
  }

  async function review(t, approve, reason = '') {
    try {
      await post('/api/admin/task-review', { id: t.id, approve, reason });
    } catch (err) {
      alert(err.message);
    }
    loadTasks();
  }

  async function loadTasks() {
    let data;
    try {
      data = await post('/api/admin/task-queue');
    } catch {
      return;
    }
    const count = data.pending.length;
    tBadge.textContent = count;
    tBadge.classList.toggle('hidden', count === 0);
    tBubble.classList.toggle('has-orders', count > 0);
    if (lastTasks !== null && count > lastTasks) {
      ding();
      tBubble.classList.remove('pulse');
      void tBubble.offsetWidth;
      tBubble.classList.add('pulse');
    }
    lastTasks = count;
    const list = tPanel.querySelector('.ao-list');
    list.innerHTML = '';
    if (!count) list.innerHTML = '<p class="muted">Ingen oppgaver venter på godkjenning 🎉</p>';
    data.pending.forEach((t) => list.appendChild(taskRow(t)));
  }

  if (window.onLive) window.onLive('tasks', loadTasks);
  else if (window.EventSource) new EventSource('/api/events').addEventListener('tasks', loadTasks);
  setInterval(loadTasks, 15000);
  loadTasks();

  // Live-varsel når det kommer nye bestillinger
  if (window.onLive) window.onLive('orders', load);
  else if (window.EventSource) new EventSource('/api/events').addEventListener('orders', load);
  setInterval(load, 15000);
  load();
  }
})();
