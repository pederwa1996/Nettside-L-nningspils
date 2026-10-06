'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  let password = '';
  let step = 1;
  let players = [];

  try {
    password = sessionStorage.getItem('adminPassword') || '';
  } catch { /* ignorer */ }

  async function post(path, body = {}) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, ...body }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
    return json;
  }

  function showMsg(text, kind = '') {
    $('msg').textContent = text;
    $('msg').className = 'result ' + kind;
  }

  function renderPlayers() {
    const q = $('search').value.trim().toLowerCase();
    const list = $('players');
    list.innerHTML = '';
    const shown = players.filter((p) => !q || p.name.toLowerCase().includes(q));
    $('count').textContent = players.length;
    if (!shown.length) list.innerHTML = '<li class="muted">Ingen deltakere.</li>';
    shown.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'spin-player';
      const name = document.createElement('span');
      name.className = 'sp-name';
      name.textContent = p.name;
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'secondary sp-btn';
      minus.textContent = `−${step}`;
      minus.disabled = p.spinsLeft === 0;
      minus.addEventListener('click', () => change(p, -step));
      const count = document.createElement('span');
      count.className = 'sp-count';
      count.textContent = p.spinsLeft;
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'sp-btn';
      plus.textContent = `+${step}`;
      plus.addEventListener('click', () => change(p, step));
      li.append(avatarEl(p.avatar, p.name, 36), name, minus, count, plus);
      list.appendChild(li);
    });
  }

  function renderLog(log) {
    const ul = $('log');
    ul.innerHTML = '';
    if (!log.length) ul.innerHTML = '<li class="muted">Ingen endringer ennå.</li>';
    log.forEach((e) => {
      const li = document.createElement('li');
      li.className = e.delta > 0 ? 'won' : 'lost';
      li.textContent = `${timeOfDay(e.at)} · ${e.name} ${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta)} spinn`;
      ul.appendChild(li);
    });
  }

  async function load() {
    const data = await post('/api/admin/players');
    players = data.players;
    renderPlayers();
    renderLog(data.log);
  }

  async function change(p, delta) {
    try {
      const r = await post('/api/admin/spins', { name: p.name, delta });
      const sign = r.delta > 0 ? '+' : '−';
      showMsg(`${r.name}: ${sign}${Math.abs(r.delta)} spinn. Har nå ${r.spinsLeft}.`, r.delta > 0 ? 'win' : 'lose');
      await load();
    } catch (err) {
      showMsg(err.message, 'lose');
    }
  }

  async function login() {
    try {
      await load();
      try {
        sessionStorage.setItem('adminPassword', password);
      } catch { /* ignorer */ }
      $('login').classList.add('hidden');
      $('panel').classList.remove('hidden');
    } catch (err) {
      $('login-msg').textContent = err.message;
      try {
        sessionStorage.removeItem('adminPassword');
      } catch { /* ignorer */ }
    }
  }

  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    password = $('password').value;
    login();
  });

  $('steps').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    step = Number(b.dataset.step);
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
    renderPlayers();
  });

  $('search').addEventListener('input', renderPlayers);

  // Logget inn tidligere i denne fanen? Da slipper man å skrive passordet på nytt
  if (password) login();
  setInterval(() => !$('panel').classList.contains('hidden') && load().catch(() => {}), 10000);
})();
