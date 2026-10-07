'use strict';

const $ = (id) => document.getElementById(id);

let data = null;
let spinning = false;
let rotation = 0;

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
  return json;
}

// ---------- Lykkehjul ----------
const SEGMENTS = 20;
const BEER_SEGMENTS = [0, 7, 14]; // 3 av 20 = 15 %
const MISS_LABELS = ['Bom', 'Neste gang', 'Vann', 'Nope', 'Snart', 'Prøv igjen'];
const segments = Array.from({ length: SEGMENTS }, (_, i) =>
  BEER_SEGMENTS.includes(i) ? { beer: true, label: '🍺 ØL!' } : { beer: false, label: MISS_LABELS[i % MISS_LABELS.length] });

function drawWheel() {
  const canvas = $('wheel');
  const ctx = canvas.getContext('2d');
  const r = canvas.width / 2;
  const seg = (Math.PI * 2) / SEGMENTS;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  segments.forEach((s, i) => {
    const start = -Math.PI / 2 + i * seg;
    ctx.beginPath();
    ctx.moveTo(r, r);
    ctx.arc(r, r, r - 6, start, start + seg);
    ctx.closePath();
    ctx.fillStyle = s.beer ? '#f5b301' : i % 2 ? '#2b2f45' : '#3a3f5c';
    ctx.fill();
    ctx.strokeStyle = '#1b1e2e';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(start + seg / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = s.beer ? '#1b1e2e' : '#e8e8f0';
    ctx.font = s.beer ? 'bold 30px system-ui, sans-serif' : '22px system-ui, sans-serif';
    ctx.fillText(s.label, r - 24, 0);
    ctx.restore();
  });
  ctx.beginPath();
  ctx.arc(r, r, 40, 0, Math.PI * 2);
  ctx.fillStyle = '#f5b301';
  ctx.fill();
  ctx.font = '40px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🍺', r, r + 2);
}

function spinTo(win) {
  const candidates = segments.map((s, i) => (s.beer === win ? i : -1)).filter((i) => i >= 0);
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const segDeg = 360 / SEGMENTS;
  const jitter = (Math.random() - 0.5) * segDeg * 0.7;
  // Segment i ligger (i + 0.5) * segDeg med klokka fra toppen; roter så det havner under pila.
  const wanted = (360 - (target + 0.5) * segDeg + jitter + 360) % 360;
  const current = ((rotation % 360) + 360) % 360;
  rotation += 360 * 6 + ((wanted - current + 360) % 360);
  $('wheel').style.transform = `rotate(${rotation}deg)`;
  return new Promise((resolve) => setTimeout(resolve, 5200));
}

async function onSpin(pay) {
  if (spinning) return;
  spinning = true;
  $('spin-btn').disabled = true;
  $('spin-flus-btn').disabled = true;
  $('spin-result').textContent = '';
  $('spin-result').className = 'result';
  try {
    const result = await api('/api/spin', { pay });
    await spinTo(result.win);
    data.me = result.me;
    $('spin-result').textContent = result.win ? '🎉 Gratulerer! Du vant en øl! 🍺' : '😢 Ingen øl denne gangen.';
    $('spin-result').classList.add(result.win ? 'win' : 'lose');
  } catch (err) {
    $('spin-result').textContent = err.message;
    $('spin-result').classList.add('lose');
  }
  spinning = false;
  render();
}

// ---------- Visning ----------
function render() {
  const { settings, me, draw } = data;
  $('tpp').textContent = settings.ticketsPerPerson;
  $('spp').textContent = settings.spinsPerPerson;
  $('chance').textContent = `${Math.round(settings.spinWinChance * 100)} %`;
  $('win-count').textContent = settings.winningTickets;
  $('total-count').textContent = settings.totalTickets;
  $('participant-count').textContent = data.participantCount;
  $('tickets-left').textContent = data.ticketsLeft;

  // Man kan alltid registrere seg. Etter trekningen eller når loddene er tomme får man bare ingen lodd.
  // Ikke logget inn: alltid Hjem, så registreringen synes (også hvis lenken var til #spill eller #stilling)
  if (!me && $('view-home').classList.contains('hidden')) showView('home', { scroll: false });
  $('join-section').classList.toggle('hidden', !!me);
  $('join-lead').classList.toggle('hidden', !!draw || data.ticketsLeft < settings.ticketsPerPerson);
  $('join-lead-late').classList.toggle('hidden', !(draw || data.ticketsLeft < settings.ticketsPerPerson));
  // Før man er logget inn er resten av siden (meny, story, stilling) skjult
  document.body.classList.toggle('logged-out', !me);
  $('me-section').classList.toggle('hidden', !me);
  $('wheel-section').classList.toggle('hidden', !me);
  $('game-card').classList.toggle('hidden', !me);
  $('duel-card').classList.toggle('hidden', !me);
  $('chat-card').classList.toggle('hidden', !me);
  $('tasks-card').classList.toggle('hidden', !me);
  $('casino-card').classList.toggle('hidden', !me);
  $('bar-card').classList.toggle('hidden', !me);
  $('games-locked').classList.toggle('hidden', !!me);
  if (me) {
    $('bar-info').textContent = me.beersOwed ? `🍺 ${me.beersOwed} pils til gode!` : 'Kjøp pils for flus';
    $('home-spins').textContent = me.spinsLeft;
    $('home-flus').textContent = me.flus;
    $('home-beers').textContent = me.beersOwed;
  }
  $('open-tasks').textContent = data.openTasks ? `${data.openTasks} ledige.` : 'Alle er tatt!';
  $('mogg-card').classList.toggle('hidden', !me);
  $('mogg-alert').classList.toggle('hidden', !data.incomingMoggs);
  $('mogg-alert').textContent = data.incomingMoggs;
  $('duel-alert').classList.toggle('hidden', !data.incomingDuels);
  $('duel-alert').textContent = data.incomingDuels;
  // Varsel på Hjem og prikk på «Spill» i menyen når noen har utfordret deg
  const challenges = (data.incomingDuels || 0) + (data.incomingMoggs || 0);
  $('nav-badge').classList.toggle('hidden', !challenges);
  $('nav-badge').textContent = challenges;
  const alerts = [];
  if (data.incomingDuels) alerts.push(`<a href="/duell.html">⚔️ ${data.incomingDuels} duell${data.incomingDuels > 1 ? 'er' : ''} venter på svar</a>`);
  if (data.incomingMoggs) alerts.push(`<a href="/mogg.html">🗿 ${data.incomingMoggs} mogg-off${data.incomingMoggs > 1 ? 's' : ''} venter på deg</a>`);
  $('home-alerts').innerHTML = alerts.join('<br>');
  $('home-alerts').classList.toggle('hidden', !alerts.length || !me);
  const first = settings.gameFirstMilestone;
  $('game-rule').textContent = `${first} poeng = 1 spinn, ${first * 2} = 2 …`;
  renderLeaderboard(data.leaderboard, me);
  renderStandings(data.standings, me);

  if (me) {
    $('me-name').textContent = me.isAdmin ? `${me.name} 👑` : me.name;
    $('admin-btn').classList.toggle('hidden', !me.isAdmin);
    $('me-avatar').replaceChildren(avatarEl(me.avatar, me.name, 64));
    $('avatar-missing').classList.toggle('hidden', !!me.avatar);
    const winSet = new Set(me.winningTickets);
    $('my-tickets').innerHTML = '';
    if (!me.tickets.length) $('my-tickets').innerHTML = '<p class="note">Du ble med etter at loddene var delt ut, så du har ingen lodd. Spinn, spill og oppgaver gjelder fortsatt!</p>';
    me.tickets.forEach((t) => {
      const el = document.createElement('div');
      el.className = 'ticket' + (winSet.has(t) ? ' winner' : '');
      el.textContent = `#${t}`;
      $('my-tickets').appendChild(el);
    });
    if (draw) {
      $('my-result').textContent = me.winningTickets.length
        ? `🎉 Du har ${me.winningTickets.length} vinnerlodd! Det er ${me.winningTickets.length} øl til deg! 🍺`
        : 'Ingen vinnerlodd denne gangen 😢';
      $('my-result').className = 'result ' + (me.winningTickets.length ? 'win' : 'lose');
    } else {
      $('my-result').textContent = '';
    }
    $('spins-left').textContent = me.spinsLeft;
    $('wheel-flus').textContent = me.flus;
    $('spin-price').textContent = settings.spinPrice;
    if (!spinning) {
      $('spin-btn').disabled = me.spinsLeft <= 0;
      $('spin-flus-btn').disabled = me.flus < settings.spinPrice;
    }
    $('spin-btn').textContent = me.spinsLeft > 0 ? 'Spinn! 🎰' : 'Ingen spinn igjen';
    $('spin-total').textContent = me.spinWins
      ? `Du har vunnet ${me.spinWins} øl på hjulet totalt 🍺`
      : '';
  }

  $('draw-pending').classList.toggle('hidden', !!draw);
  $('draw-done').classList.toggle('hidden', !draw);
  if (draw) {
    $('winners').innerHTML = '';
    draw.winners.forEach((w) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="ticket small">#${w.ticket}</span> `;
      li.append(w.name ? w.name : 'Ikke utdelt');
      if (!w.name) li.classList.add('muted');
      $('winners').appendChild(li);
    });
  }

  $('participants').innerHTML = '';
  if (!data.participants.length) {
    $('participants').innerHTML = '<li class="muted">Ingen ennå – bli den første!</li>';
  }
  data.participants.forEach((n) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'profile-link';
    a.href = `/profil.html?navn=${encodeURIComponent(n)}`;
    const span = document.createElement('span');
    span.textContent = data.admins.includes(n) ? `${n} 👑` : n;
    a.append(avatarEl(data.avatars[n], n, 28), span);
    li.appendChild(a);
    $('participants').appendChild(li);
  });
}

function renderStandings(list, me) {
  const body = $('standings');
  body.innerHTML = '';
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="5" class="muted">Ingen deltakere ennå.</td></tr>';
    return;
  }
  let place = 0;
  list.forEach((e, i) => {
    // Like mange øl gir delt plassering
    if (i === 0 || e.beers !== list[i - 1].beers) place = i;
    const tr = document.createElement('tr');
    if (me && e.name === me.name) tr.classList.add('me');
    const rank = document.createElement('td');
    rank.className = 'rank';
    rank.textContent = e.beers ? ['🥇', '🥈', '🥉'][place] || `${place + 1}.` : '–';
    const who = document.createElement('td');
    who.className = 'who';
    const name = document.createElement('span');
    name.textContent = data.admins.includes(e.name) ? `${e.name} 👑` : e.name;
    const link = document.createElement('a');
    link.className = 'profile-link';
    link.href = `/profil.html?navn=${encodeURIComponent(e.name)}`;
    link.append(avatarEl(data.avatars[e.name], e.name, 30), name);
    who.append(link);
    const beers = document.createElement('td');
    beers.className = 'num beers';
    beers.textContent = e.beers;
    beers.title = `${e.wheelBeers} fra lykkehjulet, ${e.ticketBeers} fra loddtrekningen, ${e.slotBeers} fra automaten`;
    const spins = document.createElement('td');
    spins.className = 'num';
    spins.textContent = e.spinsLeft;
    const flus = document.createElement('td');
    flus.className = 'num flus';
    flus.textContent = e.flus;
    tr.append(rank, who, beers, spins, flus);
    body.appendChild(tr);
  });
}

function renderLeaderboard(list, me) {
  $('leaderboard').innerHTML = '';
  if (!list.length) {
    $('leaderboard').innerHTML = '<li class="muted">Ingen har spilt ennå.</li>';
    return;
  }
  list.slice(0, 10).forEach((e, i) => {
    const li = document.createElement('li');
    if (me && e.name === me.name) li.classList.add('me');
    li.innerHTML = `<span class="rank">${['🥇', '🥈', '🥉'][i] || `${i + 1}.`}</span><span class="lb-name"></span><span class="lb-score">${e.score}</span>`;
    li.querySelector('.lb-name').textContent = e.name;
    li.querySelector('.rank').after(avatarEl(data.avatars[e.name], e.name, 28));
    $('leaderboard').appendChild(li);
  });
}

async function refresh() {
  try {
    const fresh = await api('/api/state');
    if (spinning) fresh.me = data.me; // ikke avslør resultatet før hjulet stopper
    data = fresh;
    render();
  } catch (err) {
    console.error(err);
  }
}

// ---------- Profilbilde ----------
let avatarData = null;

$('avatar-input').addEventListener('change', async () => {
  const file = $('avatar-input').files[0];
  if (!file) return;
  try {
    avatarData = await resizeImage(file, 320, 0.85, true);
    $('avatar-preview').src = avatarData;
    $('avatar-preview').classList.remove('hidden');
    $('avatar-placeholder').classList.add('hidden');
    $('join-error').textContent = '';
  } catch (err) {
    $('join-error').textContent = err.message;
  }
});

$('change-avatar-input').addEventListener('change', async () => {
  const file = $('change-avatar-input').files[0];
  $('change-avatar-input').value = '';
  if (!file) return;
  try {
    const avatar = await resizeImage(file, 320, 0.85, true);
    await api('/api/avatar', { avatar });
    await refresh();
    if (window.reloadStories) window.reloadStories();
  } catch (err) {
    alert(err.message);
  }
});

$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('join-error').textContent = '';
  if (!avatarData) {
    $('join-error').textContent = 'Du må ta et profilbilde først 📸';
    return;
  }
  $('join-btn').disabled = true;
  try {
    await api('/api/join', { name: $('name').value, avatar: avatarData });
    await refresh();
    if (window.reloadStories) window.reloadStories();
  } catch (err) {
    $('join-error').textContent = err.message;
  }
  $('join-btn').disabled = false;
});

// ---------- Hvem er hvor (fra presence.js) ----------
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

// ---------- Meny nederst ----------
const VIEW_HASH = { home: '', games: '#spill', standings: '#stilling' };

function showView(name, { scroll = true } = {}) {
  if (data && !data.me) name = 'home'; // ikke logget inn: bare registreringen
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${name}`));
  document.querySelectorAll('.bottom-nav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  // Storyen og registreringen hører til Hjem
  $('stories-bar').classList.toggle('hidden', name !== 'home');
  if (name !== 'home') $('join-section').classList.add('hidden');
  else if (data) $('join-section').classList.toggle('hidden', !!data.me);
  history.replaceState(null, '', VIEW_HASH[name] || location.pathname + location.search);
  if (scroll) window.scrollTo(0, 0);
}

document.querySelectorAll('.bottom-nav [data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
const startView = Object.keys(VIEW_HASH).find((k) => VIEW_HASH[k] && VIEW_HASH[k] === location.hash);
if (startView) showView(startView, { scroll: false });
window.addEventListener('hashchange', () => {
  const v = Object.keys(VIEW_HASH).find((k) => VIEW_HASH[k] === location.hash) || 'home';
  showView(v, { scroll: false });
});

// ---------- Endre navn ----------
$('rename-btn').addEventListener('click', async () => {
  const name = prompt('Hva vil du hete?', data.me.name);
  if (name === null || !name.trim() || name.trim() === data.me.name) return;
  try {
    await api('/api/rename', { name });
    await refresh();
    if (window.reloadStories) window.reloadStories();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Samme profil på flere enheter ----------
$('device-btn').addEventListener('click', async () => {
  try {
    const r = await api('/api/device-code', {});
    const link = `${location.origin}/?kode=${r.code}`;
    $('device-code').textContent = r.code;
    $('device-link').textContent = link;
    $('device-link').href = link;
    $('device-code-box').classList.remove('hidden');
  } catch (err) {
    alert(err.message);
  }
});

async function loginWithCode(code) {
  $('code-error').textContent = '';
  try {
    await api('/api/device-login', { code });
    history.replaceState(null, '', '/');
    await refresh();
    if (window.reloadStories) window.reloadStories();
  } catch (err) {
    $('device-login').open = true;
    $('code-error').textContent = err.message;
  }
}

$('code-form').addEventListener('submit', (e) => {
  e.preventDefault();
  loginWithCode($('code-input').value);
});

// Lenke med kode (/?kode=ABC123) logger inn automatisk
const codeFromLink = new URLSearchParams(location.search).get('kode');
if (codeFromLink) {
  $('code-input').value = codeFromLink;
  loginWithCode(codeFromLink);
}

$('spin-btn').addEventListener('click', () => onSpin('spin'));
$('spin-flus-btn').addEventListener('click', () => onSpin('flus'));

drawWheel();
refresh();
setInterval(refresh, 8000);
