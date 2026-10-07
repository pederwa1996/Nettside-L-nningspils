'use strict';

// PvP-siden: snarveier til duell, mogg-off og Flappy Sjef, med varsler og toppliste.
(function () {
  const $ = (id) => document.getElementById(id);
  let me = null;

  function badge(id, n) {
    $(id).textContent = n;
    $(id).classList.toggle('hidden', !n);
  }

  function renderLeaderboard(list, avatars) {
    const ol = $('leaderboard');
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
    $('my-spins').textContent = d.me.spinsLeft;
    badge('duel-badge', d.incomingDuels);
    badge('mogg-badge', d.incomingMoggs);
    badge('arena-badge', d.incomingArena);
    const alerts = [];
    if (d.incomingDuels) alerts.push(`<a href="/duell.html">⚔️ ${d.incomingDuels} duell${d.incomingDuels > 1 ? 'er' : ''} venter på svar</a>`);
    if (d.incomingArena) alerts.push(`<a href="/arena.html">🏟️ ${d.incomingArena} utfordring${d.incomingArena > 1 ? 'er' : ''} i arenaen</a>`);
    if (d.incomingMoggs) alerts.push(`<a href="/mogg.html">🗿 ${d.incomingMoggs} mogg-off${d.incomingMoggs > 1 ? 's' : ''} venter på deg</a>`);
    $('pvp-alerts').innerHTML = alerts.join('<br>');
    $('pvp-alerts').classList.toggle('hidden', !alerts.length);
    const first = d.settings.gameFirstMilestone;
    $('game-rule').textContent = `${first} poeng = 1 spinn, ${first * 2} = 2, ${first * 4} = 3 …`;
    renderLeaderboard(d.leaderboard, d.avatars);
  }

  // Hvem er i hvert spill nå (fra presence.js)
  document.addEventListener('presence', (e) => {
    const { rooms } = e.detail;
    document.querySelectorAll('.tile-here').forEach((el) => {
      const people = el.dataset.rooms.split(',').flatMap((r) => rooms[r] || []);
      el.classList.toggle('hidden', !people.length);
      el.innerHTML = '';
      people.slice(0, 3).forEach((x) => el.appendChild(avatarEl(x.avatar, x.name, 20)));
      el.appendChild(document.createTextNode(` ${people.length} her nå`));
    });
  });

  onLive('notify', (msg) => (!msg || msg.to === me) && load());
  setInterval(load, 15000);
  load();
})();
