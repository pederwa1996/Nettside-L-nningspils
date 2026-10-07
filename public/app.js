'use strict';

const $ = (id) => document.getElementById(id);

let data = null;

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
  return json;
}

// ---------- Visning ----------
function render() {
  const { settings, me, draw } = data;
  $('tpp').textContent = settings.ticketsPerPerson;
  $('spp').textContent = settings.spinsPerPerson;
  $('win-count').textContent = settings.winningTickets;
  $('total-count').textContent = settings.totalTickets;
  $('participant-count').textContent = data.participantCount;
  $('tickets-left').textContent = data.ticketsLeft;

  // Man kan alltid registrere seg. Etter trekningen eller når loddene er tomme får man bare ingen lodd.
  $('join-section').classList.toggle('hidden', !!me);
  $('join-lead').classList.toggle('hidden', !!draw || data.ticketsLeft < settings.ticketsPerPerson);
  $('join-lead-late').classList.toggle('hidden', !(draw || data.ticketsLeft < settings.ticketsPerPerson));
  // Før man er logget inn er resten av siden (meny, story, veggen) skjult
  document.body.classList.toggle('logged-out', !me);
  $('wall').classList.toggle('hidden', !me);
  $('me-bar').classList.toggle('hidden', !me);
  $('set-password-nudge').classList.toggle('hidden', !me || me.hasPassword);

  const alerts = [];
  if (data.incomingDuels) alerts.push(`<a href="/pvp.html#duell">⚔️ ${data.incomingDuels} duell${data.incomingDuels > 1 ? 'er' : ''} venter på svar</a>`);
  if (data.incomingMoggs) alerts.push(`<a href="/pvp.html#mogg">🗿 ${data.incomingMoggs} mogg-off${data.incomingMoggs > 1 ? 's' : ''} venter på deg</a>`);
  $('home-alerts').innerHTML = alerts.join('<br>');
  $('home-alerts').classList.toggle('hidden', !alerts.length || !me);
  renderStandings(data.standings, me);

  if (me) {
    $('home-spins').textContent = me.spinsLeft;
    $('home-flus').textContent = me.flus;
    $('home-beers').textContent = me.beersOwed;
    $('me-name').textContent = me.isAdmin ? `${me.name} 👑` : me.name;
    $('me-avatar').replaceChildren(avatarEl(me.avatar, me.name, 50));
    $('avatar-missing').classList.toggle('hidden', !!me.avatar);
    $('home-beers').closest('a').classList.toggle('has-beer', me.beersOwed > 0);
    // Bar-ikonet: gløder og viser antall når man har pils til gode
    if (!pokerLoaded) loadPoker();
    renderNextStep(me, settings);
    renderGoTiles();
    $('home-beers').closest('a').title = me.beersOwed ? `${me.beersOwed} pils til gode – trykk for å løse inn i baren` : 'Ingen pils til gode ennå';
    // Bare si ifra om vinnerlodd; resten av loddene ligger i inventaret på profilen
    const won = draw ? me.winningTickets.length : 0;
    $('my-result').textContent = won ? `🎉 Du har ${won} vinnerlodd! Det er ${won} pils til deg! 🍺` : '';
    $('my-result').className = won ? 'result win' : 'result hidden';
    if (!feedLoaded) loadFeed();
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
    beers.title = `${e.wheelBeers} fra lykkehjulet, ${e.ticketBeers} fra loddtrekningen, ${e.slotBeers} fra automaten, ${e.taskBeers || 0} fra oppgaver`;
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

async function refresh() {
  try {
    const wasIn = !!(data && data.me);
    data = await api('/api/state');
    if (!wasIn && data.me && window.refreshNav) window.refreshNav();
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

$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('join-error').textContent = '';
  if (!avatarData) {
    $('join-error').textContent = 'Du må ta et profilbilde først 📸';
    return;
  }
  $('join-btn').disabled = true;
  try {
    await api('/api/join', { name: $('name').value, password: $('join-password').value, avatar: avatarData });
    location.reload(); // last alt på nytt som innlogget (meny, varsler osv.)
    return;
  } catch (err) {
    $('join-error').textContent = err.message;
    if (err.message.includes('Logg inn')) {
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'secondary small-btn goto-login';
      a.textContent = '🔑 Logg inn som denne';
      $('join-error').append(' ', a);
    }
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

// Gamle lenker: #spill går til PvP-siden
if (location.hash === '#spill') location.replace('/pvp.html');

// ---------- Ny her / Logg inn ----------
function showAuth(which) {
  document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.auth === which));
  $('auth-join').classList.toggle('hidden', which !== 'join');
  $('auth-login').classList.toggle('hidden', which !== 'login');
}
document.querySelectorAll('.auth-tab').forEach((t) => t.addEventListener('click', () => showAuth(t.dataset.auth)));
// Navnet er tatt: gå rett til innlogging med navnet fylt inn
$('join-error').addEventListener('click', (e) => {
  if (!e.target.closest('.goto-login')) return;
  $('login-name').value = $('name').value;
  showAuth('login');
  $('login-password').focus();
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  $('login-btn').disabled = true;
  try {
    await api('/api/login', { name: $('login-name').value, password: $('login-password').value });
    location.reload();
    return;
  } catch (err) {
    $('login-error').textContent = err.message;
  }
  $('login-btn').disabled = false;
});

async function loginWithCode(code) {
  $('code-error').textContent = '';
  try {
    await api('/api/device-login', { code });
    location.replace('/');
    return;
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

// ---------- Veggen: hva som skjer ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const profileUrl = (n) => `/profil.html?navn=${encodeURIComponent(n)}`;

// «Hva skjer»: alt alle gjør, med likes og kommentarer
let feedItems = [];
let feedLoaded = false;
let feedMore = false;

async function loadFeed() {
  feedLoaded = true;
  try {
    const r = await api('/api/feed');
    // Behold eldre innlegg man har hentet med «Vis eldre»
    const older = feedItems.filter((a) => r.items.length && a.at < r.items[r.items.length - 1].at);
    feedItems = r.items.concat(older);
    if (!older.length) feedMore = r.more;
    renderFeed();
  } catch { /* ignorer */ }
}

// «Hva skjer» er kort til å begynne med; «Vis mer» viser flere og henter eldre ved behov
const FEED_START = 4;
const FEED_STEP = 8;
let feedLimit = FEED_START;

$('feed-more').addEventListener('click', async () => {
  feedLimit += FEED_STEP;
  // Har vi ikke nok lokalt, hent eldre hendelser fra serveren
  if (feedVisible().length < feedLimit && feedMore) {
    const last = feedItems[feedItems.length - 1];
    try {
      const r = await api(`/api/feed?before=${last.at}`);
      feedItems = feedItems.concat(r.items);
      feedMore = r.more;
    } catch (err) {
      alert(err.message);
    }
  }
  renderFeed();
});

$('feed-less').addEventListener('click', () => {
  feedLimit = FEED_START;
  renderFeed();
  $('feed').closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function feedVisible() {
  return feedItems.filter((a) => feedFilter === 'all' || (feedFilter === 'photos' ? !!a.url : feedCat(a) === feedFilter));
}

// Kategori ut fra ikonet, så feeden kan fargelegges og filtreres
function feedCat(a) {
  if (/pils|🍺/.test(a.text) && ['🎡', '🎟️', '🎰', '🍺'].includes(a.icon)) return 'beer';
  if (['🎰', '🎡', '♠️', '🃏'].includes(a.icon)) return 'casino';
  if (['⚔️', '🗿', '🕊️', '🎲', '⚡', '🧠'].includes(a.icon)) return 'pvp';
  if (a.icon === '🎯') return 'tasks';
  return 'social';
}
const CAT_LABEL = { beer: '🍺 PILS!', casino: '🎰 Kasino', pvp: '⚔️ PvP', tasks: '🎯 Oppgave', social: '👋' };

let feedFilter = 'all';
const seenFeed = new Set();
let feedFirst = true;

document.querySelectorAll('#feed-filters .ff').forEach((b) => b.addEventListener('click', () => {
  feedFilter = b.dataset.cat;
  document.querySelectorAll('#feed-filters .ff').forEach((x) => x.classList.toggle('active', x === b));
  renderFeed();
}));

function renderFeed() {
  const box = $('feed');
  box.innerHTML = '';
  const all = feedVisible();
  const list = all.slice(0, feedLimit);
  if (!list.length) box.appendChild(el('p', 'muted center', feedFilter === 'all' ? 'Ingenting har skjedd ennå. Bli den første! 🎉' : 'Ingenting her ennå.'));
  list.forEach((a) => {
    const fresh = !feedFirst && !seenFeed.has(a.id);
    box.appendChild(feedItem(a, fresh));
  });
  feedItems.forEach((a) => seenFeed.add(a.id));
  feedFirst = false;
  const more = all.length > feedLimit || feedMore;
  $('feed-more').classList.toggle('hidden', !more);
  $('feed-more').textContent = `Vis mer ↓${all.length > feedLimit ? ` (${Math.min(FEED_STEP, all.length - feedLimit)}${feedMore || all.length - feedLimit > FEED_STEP ? '+' : ''})` : ''}`;
  $('feed-less').classList.toggle('hidden', feedLimit <= FEED_START);
}

function feedItem(a, fresh = false) {
  const cat = feedCat(a);
  const postUrl = `${profileUrl(a.name)}&innlegg=${a.id}`;
  const item = el('article', `wall-item cat-${cat}${fresh ? ' fresh' : ''}`);
  const badge = el('a', 'wi-badge');
  badge.href = profileUrl(a.name);
  badge.append(avatarEl(a.avatar, a.name, 46), el('span', 'wi-emoji', a.icon));
  const body = el('div', 'wi-body');
  const top = el('div', 'wi-top');
  const who = el('a', 'wi-name', a.admin ? `${a.name} 👑` : a.name);
  who.href = profileUrl(a.name);
  top.append(who);
  if (cat !== 'social') top.append(el('span', `wi-tag tag-${cat}`, CAT_LABEL[cat]));
  if (Date.now() - a.at < 3 * 60 * 1000) top.append(el('span', 'wi-new', '🔥 NY'));
  body.append(top, el('p', 'wi-text', a.text), el('small', 'wi-time', timeAgo(a.at)));
  if (a.url) {
    const link = el('a', 'wi-img');
    link.href = postUrl;
    const img = el('img');
    img.src = a.url;
    img.loading = 'lazy';
    img.alt = '';
    link.appendChild(img);
    body.appendChild(link);
  }
  const actions = el('div', 'wi-actions');
  const like = el('button', 'wi-like' + (a.liked ? ' liked' : ''), `${a.liked ? '❤️' : '🤍'} ${a.likes || 'Lik'}`);
  like.type = 'button';
  like.addEventListener('click', async () => {
    try {
      const r = await api('/api/react/like', { id: a.id });
      if (window.sfx && r && !a.liked) sfx.play('like');
      Object.assign(a, r.activity);
      const next = feedItem(a);
      if (a.liked) next.querySelector('.wi-like').classList.add('pop');
      item.replaceWith(next);
    } catch (err) {
      alert(err.message);
    }
  });
  const comments = el('a', 'wi-comments', `💬 ${a.comments.length || 'Kommenter'}`);
  comments.href = postUrl;
  actions.append(like, comments);
  if (a.likedBy && a.likedBy.length) actions.append(el('span', 'wi-likers', `likt av ${a.likedBy.slice(-2).join(', ')}${a.likes > 2 ? ` +${a.likes - 2}` : ''}`));
  body.appendChild(actions);
  if (a.comments.length) {
    const c = a.comments[a.comments.length - 1];
    const last = el('a', 'wi-last-comment');
    last.href = postUrl;
    last.append(el('strong', '', c.name), document.createTextNode(` ${c.text}`));
    body.appendChild(last);
  }
  item.append(badge, body);
  return item;
}

// ---------- Neste steg og snarveiene ----------
function renderNextStep(me, settings) {
  const challenges = (data.incomingDuels || 0) + (data.incomingMoggs || 0) + (data.incomingArena || 0);
  let s;
  if (me.beersOwed > 0) s = ['🍻', `Du har ${me.beersOwed} pils til gode!`, 'Trykk her for å løse inn i baren – spillmesteren kommer med den', '/baren.html', 'beer'];
  else if (challenges) s = ['⚔️', `Du er utfordret (${challenges})`, 'Svar på utfordringen og vinn spinn, cash eller pils', data.incomingArena ? '/pvp.html#terninger' : data.incomingDuels ? '/pvp.html#duell' : '/pvp.html#mogg', 'pvp'];
  else if (me.spinsLeft > 0) s = ['🎡', `Spinn lykkehjulet (${me.spinsLeft} spinn igjen)`, `${Math.round(settings.spinWinChance * 100)} % sjanse for en ekte pils hver gang`, '/kasino.html#hjul', 'spin'];
  else if (me.flus >= 50) s = ['🎰', 'Tom for spinn? Prøv automaten', 'To eller tre 🎡 på en linje gir spinn til lykkehjulet', '/kasino.html#automat', 'spin'];
  else if (data.openTasks) s = ['🎯', 'Tom for spinn? Løs en oppgave', `${data.openTasks} ledige oppgaver gir spinn, cash eller pils`, '/oppgaver.html', 'tasks'];
  else s = ['⚔️', 'Utfordre noen i arenaen', 'Spill om cash, spinn eller pils', '/pvp.html#terninger', 'pvp'];
  const [icon, title, sub, href, kind] = s;
  $('ns-icon').textContent = icon;
  $('ns-title').textContent = title;
  $('ns-sub').textContent = sub;
  $('next-step').href = href;
  $('next-step').className = `next-step ns-${kind}`;
}

let homeRooms = {};
function renderGoTiles() {
  if (!data || !data.me) return;
  const count = (rooms) => rooms.reduce((n, r) => n + (homeRooms[r] || []).length, 0);
  const inCasino = count(['kasino-wheel', 'kasino-slot', 'kasino-roulette', 'kasino-blackjack', 'kasino-poker']);
  const inBar = count(['kasino-bar', 'baren']);
  const challenges = (data.incomingDuels || 0) + (data.incomingMoggs || 0) + (data.incomingArena || 0);
  const set = (id, text, hot) => {
    $(id).textContent = text;
    $(id).classList.toggle('hot', !!hot);
    $(id).classList.toggle('hidden', !text);
  };
  if ($('gwb-spins')) $('gwb-spins').textContent = data.me.spinsLeft ? `${data.me.spinsLeft} spinn ›` : 'Ingen spinn';
  set('go-casino-live', inCasino ? `🟢 ${inCasino} spiller nå` : `${data.me.spinsLeft} spinn · ${data.me.flus} cash`);
  set('go-bar-live', data.me.beersOwed ? `🍺 ${data.me.beersOwed} til gode` : inBar ? `🟢 ${inBar} i baren` : '', data.me.beersOwed);
  set('go-pvp-live', challenges ? `🔔 ${challenges} utfordring${challenges > 1 ? 'er' : ''}` : '', challenges);
  set('go-tasks-live', data.openTasks ? `${data.openTasks} ledige` : 'Alle er tatt');
}
document.addEventListener('presence', (e) => {
  homeRooms = e.detail.rooms || {};
  renderGoTiles();
});

// ---------- Pokerbordet live: hvem spiller og hvem ser på ----------
let pokerLoaded = false;
let pokerTable = null;
let pokerRooms = {};

async function loadPoker() {
  pokerLoaded = true;
  try {
    pokerTable = (await api('/api/poker')).table;
    renderPoker();
  } catch { /* ignorer */ }
}

// Pokerbordet som en liten detalj i kasino-døren: hvem som spiller og potten
function renderPoker() {
  const t = pokerTable;
  const box = $('go-poker');
  if (!t || !box) return;
  box.innerHTML = '';
  const seated = t.seats.filter(Boolean);
  if (!seated.length) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  const stack = el('span', 'gp-stack');
  seated.slice(0, 4).forEach((s) => stack.appendChild(avatarEl(s.avatar, s.name, 16)));
  const text = t.phase === 'result' && t.result
    ? `🏆 ${t.result.winners[0].name.split(' ')[0]} vant`
    : `${seated.length} i poker`;
  box.append(el('span', 'gp-suit', '♠️'), stack, el('span', 'gp-text', text));
}
// ---------- Hva skjer: faner ----------
let hsTab = 'events';
document.querySelectorAll('.hs-tab').forEach((b) => b.addEventListener('click', () => {
  hsTab = b.dataset.hs;
  document.querySelectorAll('.hs-tab').forEach((x) => x.classList.toggle('active', x === b));
  ['wall', 'events'].forEach((k) => $(`hs-${k}`).classList.toggle('hidden', k !== hsTab));
  if (hsTab === 'wall') loadWallPosts();
}));

// ---------- 🟢 Akkurat nå: hvem er inne og hva de holder på med ----------
// [ikon, status, hva de gjør]. Profil: «Stalker» når man ser på en annens profil.
const NOW_STATUS = {
  hjem: ['😎', 'Chilleren', 'Slapper av på forsiden'],
  'kasino-wheel': ['🎡', 'Lykkejegeren', 'Spinner lykkehjulet'],
  'kasino-slot': ['🎰', 'Spakedrageren', 'Drar i spaken på automaten'],
  'kasino-roulette': ['🔴', 'Alt på rødt', 'Sitter ved rouletten'],
  'kasino-blackjack': ['🃏', 'Korttelleren', 'Ved blackjack-bordet'],
  'kasino-poker': ['♠️', 'Pokerfjeset', 'Ved pokerbordet'],
  'kasino-bar': ['🍻', 'Stamgjesten', 'Henger i baren'],
  baren: ['🍻', 'Stamgjesten', 'Henger i baren'],
  pvp: ['⚔️', 'Bråkmakeren', 'Ser etter noen å utfordre'],
  arena: ['🏟️', 'Gladiatoren', 'Kjemper i arenaen'],
  duell: ['✊', 'Duellanten', 'Stein, saks, papir'],
  mogg: ['🗿', 'Moggeren', 'Øver på chad-ansiktet'],
  oppgaver: ['🎯', 'Oppdragstakeren', 'Leter etter oppgaver'],
  flappy: ['🕊️', 'Flapperen', 'Spiller Flappy Sjef'],
  chat: ['💬', 'Sladrebasen', 'Sitter i chatten'],
};

function nowStatus(room, x) {
  if (room === 'profil') {
    if (!x.target || x.target === x.name) return ['🪞', 'Narsissisten', 'Beundrer sin egen profil'];
    return ['🕵️', 'Stalker', `Snoker på profilen til ${x.target}`];
  }
  return NOW_STATUS[room] || ['👻', 'Spøkelset', 'Vandrer rundt'];
}

function renderNow() {
  const box = $('now-list');
  if (!box) return;
  const seen = new Set();
  const people = [];
  Object.entries(homeRooms).forEach(([room, list]) => list.forEach((x) => {
    if (seen.has(x.name)) return;
    seen.add(x.name);
    people.push({ ...x, room });
  }));
  // Meg først, så den som har vært lengst på samme sted
  const me = myName();
  people.sort((a, b) => (b.name === me) - (a.name === me) || a.since - b.since);
  $('now-count').textContent = people.length || '';
  box.innerHTML = '';
  if (!people.length) {
    box.appendChild(el('p', 'muted center', 'Ingen er inne akkurat nå 😴'));
    return;
  }
  people.forEach((x) => {
    const [icon, title, sub] = nowStatus(x.room, x);
    const row = el('a', `now-row room-${x.room.split('-')[0]}`);
    row.href = `/profil.html?navn=${encodeURIComponent(x.name)}`;
    const av = el('span', 'now-av');
    av.append(avatarEl(x.avatar, x.name, 42), el('i', 'now-dot'));
    const text = el('span', 'now-text');
    text.append(el('b', '', x.name === me ? `${x.name} (deg)` : x.name), el('small', '', sub));
    const badge = el('span', 'now-status', `${icon} ${title}`);
    row.append(av, text, badge);
    box.appendChild(row);
  });
}
document.addEventListener('presence', renderNow);

// ---------- 🧱 Veggen ----------
let wallLoaded = false;
async function loadWallPosts() {
  wallLoaded = true;
  try {
    const { posts } = await api('/api/wallposts');
    const box = $('wallposts');
    box.innerHTML = '';
    if (!posts.length) box.appendChild(el('p', 'muted center', 'Veggen er tom. Skriv det første innlegget! ✍️'));
    posts.forEach((p) => {
      const row = el('div', 'wp-row');
      const link = el('a', 'wp-av');
      link.href = `/profil.html?navn=${encodeURIComponent(p.name)}`;
      link.appendChild(avatarEl(p.avatar, p.name, 34));
      const body = el('div', 'wp-body');
      const head = el('div', 'wp-head');
      head.append(el('b', '', p.name), el('small', '', timeAgo(p.at)));
      body.append(head, el('p', 'wp-text', p.text));
      row.append(link, body);
      if (p.name === myName() || (data && data.me && data.me.isAdmin)) {
        const del = el('button', 'wp-del', '✕');
        del.type = 'button';
        del.title = 'Slett';
        del.addEventListener('click', async () => {
          if (!confirm('Slette innlegget?')) return;
          try {
            await api('/api/wallposts/delete', { id: p.id });
          } catch (err) {
            alert(err.message);
          }
          loadWallPosts();
        });
        row.appendChild(del);
      }
      box.appendChild(row);
    });
  } catch { /* ignorer */ }
}
$('wallpost-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('wallpost-text');
  if (!input.value.trim()) return;
  try {
    await api('/api/wallposts', { text: input.value });
    if (window.sfx) sfx.play('send');
    input.value = '';
    loadWallPosts();
  } catch (err) {
    alert(err.message);
  }
});
onLive('wallposts', () => wallLoaded && loadWallPosts());

// ---------- 💡 Forslag til admin ----------
$('suggest-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('suggest-msg');
  const btn = $('suggest-send');
  btn.disabled = true;
  try {
    const kind = (document.querySelector('input[name="suggest-kind"]:checked') || {}).value;
    const r = await api('/api/suggestions', { kind, text: $('suggest-text').value });
    $('suggest-text').value = '';
    if (window.sfx) sfx.play('send');
    msg.textContent = r.rewarded ? `Takk! 💡 Forslaget er sendt, og du fikk ${r.spins} spinn og ${r.cash} cash 🎉` : 'Takk! 💡 Forslaget er sendt til spillmesteren.';
    msg.className = 'result win';
    if (r.me) {
      data.me = r.me;
      render();
    }
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'result lose';
  }
  btn.disabled = false;
});
const myName = () => (data && data.me ? data.me.name : null);

onLive('poker', () => data && data.me && loadPoker());
document.addEventListener('presence', (e) => {
  pokerRooms = e.detail.rooms || {};
  renderPoker();
});

// Live: nye hendelser, likes og oppgaver
let feedTimer = null;
const reloadFeedSoon = () => {
  clearTimeout(feedTimer);
  feedTimer = setTimeout(() => data && data.me && loadFeed(), 600);
};
onLive('activity', reloadFeedSoon);
onLive('reactions', reloadFeedSoon);

refresh();
setInterval(refresh, 8000);
