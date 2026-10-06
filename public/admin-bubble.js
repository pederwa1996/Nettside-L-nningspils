'use strict';

// Bestillingsboble for spillmesteren (admin). Vises på alle sider så lenge admin
// er logget inn i denne fanen (passordet ligger i sessionStorage).
(function () {
  let password = '';
  try {
    password = sessionStorage.getItem('adminPassword') || '';
  } catch { /* ignorer */ }
  if (!password) return;

  let lastCount = null;
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
      bubble.remove();
      panel.remove();
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
    meta.textContent = `${o.pay === 'flus' ? `${o.cost} flus` : 'til gode'} · ${ago(o.at)}`;
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
      ok.textContent = '✅ Levert';
      ok.addEventListener('click', () => setStatus(o, 'delivered'));
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'secondary small-btn';
      no.textContent = '❌';
      no.title = 'Avbryt (flus betales tilbake)';
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
  });
  panel.querySelector('.ao-close').addEventListener('click', () => {
    open = false;
    panel.classList.add('hidden');
  });

  // Live-varsel når det kommer nye bestillinger
  if (window.onLive) window.onLive('orders', load);
  else if (window.EventSource) new EventSource('/api/events').addEventListener('orders', load);
  setInterval(load, 15000);
  load();
})();
