'use strict';

// PvP-arenaen: alle spillene på én side, med en rad knapper øverst (som i kasinoet).
// 🎲 Terning · ⚡ Reaksjon · 🧠 Hoderegning (arena.js) · ✊ Duell (duell.js) · 🗿 Mogg-off (mogg.js) · 🕊️ Flappy · 🚐 Hiace (hiace.html)
(function () {
  const $ = (id) => document.getElementById(id);
  const TABS = {
    dice: { hash: 'terninger', panel: 'pv-arena', room: 'arena' },
    reaction: { hash: 'reaksjon', panel: 'pv-arena', room: 'arena' },
    math: { hash: 'hoderegning', panel: 'pv-arena', room: 'arena' },
    duel: { hash: 'duell', panel: 'pv-duel', room: 'duell' },
    mogg: { hash: 'mogg', panel: 'pv-mogg', room: 'mogg' },
    flappy: { hash: 'flappy', panel: 'pv-flappy', room: 'pvp' },
    hiace: { hash: 'hiace', panel: 'pv-hiace', room: 'pvp' },
  };
  let me = null;
  let tab = Object.keys(TABS).find((k) => `#${TABS[k].hash}` === location.hash) || 'dice';

  function showTab(name, { sound = false } = {}) {
    tab = name;
    const t = TABS[name];
    document.body.dataset.tab = name;
    document.body.dataset.room = t.room;
    document.querySelectorAll('.pvp-games .pg').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    ['pv-arena', 'pv-duel', 'pv-mogg', 'pv-flappy', 'pv-hiace'].forEach((p) => $(p).classList.toggle('hidden', p !== t.panel));
    if (t.panel === 'pv-arena' && window.arenaSetGame) window.arenaSetGame(name);
    history.replaceState(null, '', `${location.pathname}${location.search}#${t.hash}`);
    if (window.updatePresenceRoom) window.updatePresenceRoom();
    if (sound && window.sfx) sfx.play('tap');
  }
  document.querySelectorAll('.pvp-games .pg').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab, { sound: true })));
  window.addEventListener('hashchange', () => {
    const k = Object.keys(TABS).find((x) => `#${TABS[x].hash}` === location.hash);
    if (k && k !== tab) showTab(k);
  });

  // Røde tall på knappene: utfordringer som venter på deg
  function setBadge(game, n) {
    const b = document.querySelector(`.pg-badge[data-game="${game}"]`);
    if (!b) return;
    b.textContent = n;
    b.classList.toggle('hidden', !n);
  }
  window.onArenaData = (d) => {
    ['dice', 'reaction', 'math'].forEach((g) => setBadge(g, d.incoming.filter((a) => a.game === g).length));
  };

  function renderLeaderboard(list, avatars, id = 'leaderboard') {
    const ol = $(id);
    ol.innerHTML = '';
    if (!list.length) {
      ol.innerHTML = '<li class="muted">Ingen har spilt ennå.</li>';
      return;
    }
    list.slice(0, 10).forEach((e, i) => {
      const li = document.createElement('li');
      if (me && e.name === me) li.classList.add('me');
      li.innerHTML = `<span class="rank">${['🥇', '🥈', '🥉'][i] || `${i + 1}.`}</span><span class="lb-name"></span><span class="lb-score">${e.score}</span>`;
      li.querySelector('.lb-name').textContent = e.name;
      li.querySelector('.rank').after(avatarEl(avatars[e.name], e.name, 28));
      ol.appendChild(li);
    });
  }

  async function load() {
    let d;
    try {
      d = await (await fetch('/api/state')).json();
    } catch {
      return;
    }
    if (!d.me) return;
    me = d.me.name;
    $('pv-spins').textContent = d.me.spinsLeft;
    $('pv-flus').textContent = d.me.flus;
    $('pv-beers').textContent = d.me.beersOwed;
    setBadge('duel', d.incomingDuels);
    setBadge('mogg', d.incomingMoggs);
    const alerts = [];
    if (d.incomingArena) alerts.push(`<a href="#terninger">🏟️ ${d.incomingArena} utfordring${d.incomingArena > 1 ? 'er' : ''} i arenaen</a>`);
    if (d.incomingDuels) alerts.push(`<a href="#duell">✊ ${d.incomingDuels} duell${d.incomingDuels > 1 ? 'er' : ''} venter på svar</a>`);
    if (d.incomingMoggs) alerts.push(`<a href="#mogg">🗿 ${d.incomingMoggs} mogg-off${d.incomingMoggs > 1 ? 's' : ''} venter på deg</a>`);
    $('pvp-alerts').innerHTML = alerts.join(' · ');
    $('pvp-alerts').classList.toggle('hidden', !alerts.length);
    const first = d.settings.gameFirstMilestone;
    $('game-rule').textContent = `Fly mellom rørene. ${first} poeng = 1 spinn, ${first * 2} = 2, ${first * 4} = 3 …`;
    renderLeaderboard(d.leaderboard, d.avatars);
    // 🚐 Mujaffas Hiace har sin egen toppliste
    fetch('/api/hiace').then((r) => r.json()).then((h) => {
      $('hiace-rule').textContent = `Kjør Røa Elektriske-bilen til kundene og unngå trafikken. ${h.first} poeng = 1 spinn, ${h.first * 2} = 2, ${h.first * 4} = 3 …`;
      renderLeaderboard(h.leaderboard, h.avatars, 'hiace-board');
    }).catch(() => {});
  }

  // Hvor mange som er i hvert spill nå (arenaen telles samlet på de tre arena-knappene)
  document.addEventListener('presence', (e) => {
    const { rooms } = e.detail;
    document.querySelectorAll('.pg-live').forEach((el) => {
      const room = el.dataset.room.startsWith('arena') ? 'arena' : el.dataset.room;
      const n = (rooms[room] || []).filter((x) => x.name !== me).length;
      el.textContent = n ? `🟢 ${n}` : '';
    });
  });

  onLive('notify', (msg) => (!msg || msg.to === me) && load());
  onLive('arena', load);
  setInterval(load, 15000);
  showTab(tab);
  load();
})();
