'use strict';

// 🎒 Inventar på din egen profil: pils til gode, spinn, cash og lodd, og alt du kan endre
// (profilbilde, navn, passord, annen enhet, logg ut). Ligger bak en egen fane.
(function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let me = null;

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {});
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
    return json;
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Faner: Aktivitet / Inventar ----------
  let tabs;
  let inv;
  function build() {
    tabs = el('div', 'profile-tabs');
    tabs.innerHTML = '<button type="button" class="ptab active" data-ptab="activity">📜 Aktivitet</button><button type="button" class="ptab" data-ptab="inventory">🎒 Inventar</button>';
    inv = el('section', 'card inventory hidden');
    inv.id = 'inventory';
    const card = document.querySelector('.profile-card');
    card.after(tabs, inv);
    tabs.querySelectorAll('.ptab').forEach((b) => b.addEventListener('click', () => show(b.dataset.ptab)));
  }

  function show(which) {
    tabs.querySelectorAll('.ptab').forEach((b) => b.classList.toggle('active', b.dataset.ptab === which));
    document.body.classList.toggle('inv-open', which === 'inventory');
    inv.classList.toggle('hidden', which !== 'inventory');
    history.replaceState(null, '', location.pathname + location.search + (which === 'inventory' ? '#inventar' : ''));
  }

  // ---------- Innhold ----------
  function render() {
    const won = new Set(me.winningTickets || []);
    const tickets = me.tickets.length
      ? me.tickets.map((t) => `<span class="ticket${won.has(t) ? ' winner' : ''}">#${t}</span>`).join('')
      : '<span class="muted">Ingen lodd (du ble med etter at de var delt ut).</span>';
    inv.innerHTML = `
      <h2>🎒 Inventar</h2>
      <a class="inv-beer${me.beersOwed ? ' has' : ''}" href="/baren.html">
        <span class="inv-big">🍺 ${me.beersOwed}</span>
        <span><b>pils til gode</b><br><small>${me.beersOwed ? 'Trykk for å løse inn i baren. Spillmesteren kommer med den til bordet!' : 'Vinn pils på lykkehjulet, automaten eller i loddtrekningen.'}</small></span>
      </a>
      <div class="inv-grid">
        <a href="/kasino.html#hjul"><span>🎡</span><b>${me.spinsLeft}</b><small>spinn</small></a>
        <a href="/kasino.html"><span>💰</span><b>${me.flus}</b><small>cash</small></a>
        <a href="/oppgaver.html"><span>🎯</span><b>+</b><small>tjen mer</small></a>
      </div>
      <p class="field-label">🎟️ Dine lodd</p>
      <div class="tickets">${tickets}</div>

      <h2 class="inv-settings-title">⚙️ Innstillinger</h2>
      <div class="inv-settings">
        <label class="inv-btn"><input id="inv-avatar" type="file" accept="image/*" capture="user" hidden>📷 Bytt profilbilde</label>
        <button type="button" class="inv-btn" id="inv-rename">✏️ Endre navn</button>
        ${me.hasPassword ? '<button type="button" class="inv-btn" id="inv-password">🔑 Bytt passord</button>' : ''}
        <button type="button" class="inv-btn" id="inv-device">💻 Bruk på annen enhet</button>
        ${me.isAdmin ? '<a class="inv-btn" href="/admin.html">🔐 Admin</a>' : ''}
        <button type="button" class="inv-btn danger" id="inv-logout">🚪 Logg ut</button>
      </div>
      ${me.hasPassword ? '' : `
        <form id="inv-set-password" class="set-password">
          <p><strong>🔑 Velg et passord</strong><br><small>Da kan du logge inn på profilen din fra hvilken som helst mobil eller PC.</small></p>
          <input id="inv-new-password" type="password" placeholder="Nytt passord (minst 4 tegn)" minlength="4" maxlength="100" autocomplete="new-password" required>
          <button type="submit">Lagre passord</button>
        </form>`}
      <div id="inv-device-box" class="device-code-box hidden"></div>
      <p id="inv-msg" class="result"></p>`;

    const msg = (t, ok) => {
      $('inv-msg').textContent = t;
      $('inv-msg').className = `result ${ok ? 'win' : 'lose'}`;
    };

    $('inv-avatar').addEventListener('change', async () => {
      const file = $('inv-avatar').files[0];
      if (!file) return;
      try {
        await api('/api/avatar', { avatar: await resizeImage(file, 320, 0.85, true) });
        location.reload();
      } catch (err) {
        msg(err.message);
      }
    });

    $('inv-rename').addEventListener('click', async () => {
      const name = prompt('Hva vil du hete?', me.name);
      if (name === null || !name.trim() || name.trim() === me.name) return;
      try {
        const r = await api('/api/rename', { name });
        location.href = `/profil.html?navn=${encodeURIComponent(r.me.name)}#inventar`;
      } catch (err) {
        msg(err.message);
      }
    });

    if ($('inv-password')) $('inv-password').addEventListener('click', async () => {
      const current = prompt('Skriv inn passordet du har nå:');
      if (current === null) return;
      const password = prompt('Skriv inn det nye passordet (minst 4 tegn):');
      if (password === null) return;
      try {
        await api('/api/password', { current, password });
        msg('Passordet er byttet 🔑', true);
      } catch (err) {
        msg(err.message);
      }
    });

    if ($('inv-set-password')) $('inv-set-password').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/password', { password: $('inv-new-password').value });
        me = r.me;
        render();
        msg('Passordet er lagret 🔑 Nå kan du logge inn med navn og passord på alle enheter.', true);
      } catch (err) {
        msg(err.message);
      }
    });

    $('inv-device').addEventListener('click', async () => {
      try {
        const r = await api('/api/device-code', {});
        const link = `${location.origin}/?kode=${r.code}`;
        const box = $('inv-device-box');
        box.innerHTML = `<p>Skriv inn denne koden på den andre enheten (Logg inn → «Logg inn med kode»):</p>
          <p class="device-code">${esc(r.code)}</p>
          <p class="note">Eller åpne denne lenken der: <a href="${esc(link)}">${esc(link)}</a></p>
          <p class="note">Koden virker én gang og går ut om 10 minutter. Ikke del den med andre!</p>`;
        box.classList.remove('hidden');
      } catch (err) {
        msg(err.message);
      }
    });

    $('inv-logout').addEventListener('click', async () => {
      if (!confirm(me.hasPassword
        ? 'Logge ut på denne enheten? Du kan logge inn igjen med navn og passord.'
        : 'Du har ikke passord ennå, så du kommer ikke inn igjen uten kode. Velg et passord først! Logge ut likevel?')) return;
      await api('/api/logout', {}).catch(() => {});
      location.replace('/');
    });
  }

  fetch('/api/state').then((r) => r.json()).then((d) => {
    if (!d.me) return;
    const target = params.get('navn');
    // Bare på din egen profil
    if (target && target.toLowerCase() !== d.me.name.toLowerCase()) return;
    me = d.me;
    build();
    render();
    if (location.hash === '#inventar') show('inventory');
  }).catch(() => {});
})();
