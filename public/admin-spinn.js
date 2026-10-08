'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  let password = '';
  let players = [];
  // Hva som deles ut, og stegene per trykk
  const KINDS = {
    spins: { word: 'spinn', icon: '🎡', key: 'spinsLeft', steps: [1, 2, 5, 10] },
    cash: { word: 'cash', icon: '💰', key: 'flus', steps: [50, 100, 250, 500] },
    beer: { word: 'pils', icon: '🍺', key: 'beersOwed', steps: [1, 2, 3] },
  };
  let kind = 'spins';
  let step = 1;

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
      minus.disabled = p[KINDS[kind].key] === 0;
      minus.addEventListener('click', () => change(p, -step));
      const count = document.createElement('span');
      count.className = 'sp-count';
      count.textContent = p[KINDS[kind].key];
      count.title = KINDS[kind].word;
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
      const k = KINDS[e.kind] || KINDS.spins;
      li.textContent = `${timeOfDay(e.at)} · ${e.name} ${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta)} ${k.word} ${k.icon}`;
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
      const r = await post('/api/admin/spins', { name: p.name, delta, kind });
      const sign = r.delta > 0 ? '+' : '−';
      const k = KINDS[r.kind] || KINDS.spins;
      showMsg(`${r.name}: ${sign}${Math.abs(r.delta)} ${k.word} ${k.icon}. Har nå ${r.now}.`, r.delta > 0 ? 'win' : 'lose');
      await load();
    } catch (err) {
      showMsg(err.message, 'lose');
    }
  }

  async function login() {
    try {
      await load();
      try {
        if (password) sessionStorage.setItem('adminPassword', password);
      } catch { /* ignorer */ }
      $('login').classList.add('hidden');
      $('panel').classList.remove('hidden');
      // Vis bestillingsboblen med en gang etter innlogging
      if (!document.querySelector('.admin-bubble')) {
        const s = document.createElement('script');
        s.src = '/admin-bubble.js?' + Date.now();
        document.body.appendChild(s);
      }
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

  function renderSteps() {
    const k = KINDS[kind];
    $('kind-word').textContent = k.word;
    $('beer-note').classList.toggle('hidden', kind !== 'beer');
    $('steps').innerHTML = '';
    k.steps.forEach((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (n === step ? ' active' : '');
      b.dataset.step = n;
      b.textContent = n;
      $('steps').appendChild(b);
    });
  }

  $('kinds').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    kind = b.dataset.kind;
    step = KINDS[kind].steps[0];
    $('kinds').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
    renderSteps();
    renderPlayers();
  });

  $('steps').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    step = Number(b.dataset.step);
    $('steps').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
    renderPlayers();
  });
  renderSteps();

  $('search').addEventListener('input', renderPlayers);

  // Logget inn tidligere i denne fanen? Da slipper man å skrive passordet på nytt
  if (password) login();
  // Spillmesteren (admin-profilen) slipper passordet på enheter der den er logget inn
  else fetch('/api/admin/me').then((r) => r.json()).then((r) => r.admin && login()).catch(() => {});
  setInterval(() => !$('panel').classList.contains('hidden') && load().catch(() => {}), 10000);
})();
