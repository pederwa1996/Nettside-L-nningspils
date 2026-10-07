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
  $('set-password-nudge').classList.toggle('hidden', !me || me.hasPassword);
  $('open-tasks').textContent = data.openTasks ? `${data.openTasks} ledige` : 'Alle er tatt!';

  const alerts = [];
  if (data.incomingDuels) alerts.push(`<a href="/duell.html">⚔️ ${data.incomingDuels} duell${data.incomingDuels > 1 ? 'er' : ''} venter på svar</a>`);
  if (data.incomingMoggs) alerts.push(`<a href="/mogg.html">🗿 ${data.incomingMoggs} mogg-off${data.incomingMoggs > 1 ? 's' : ''} venter på deg</a>`);
  $('home-alerts').innerHTML = alerts.join('<br>');
  $('home-alerts').classList.toggle('hidden', !alerts.length || !me);
  renderStandings(data.standings, me);

  if (me) {
    $('home-spins').textContent = me.spinsLeft;
    $('home-flus').textContent = me.flus;
    $('home-beers').textContent = me.beersOwed;
    $('me-name').textContent = me.isAdmin ? `${me.name} 👑` : me.name;
    $('me-avatar').replaceChildren(avatarEl(me.avatar, me.name, 44));
    $('avatar-missing').classList.toggle('hidden', !!me.avatar);
    $('home-beers').closest('a').classList.toggle('has-beer', me.beersOwed > 0);
    // Bare si ifra om vinnerlodd; resten av loddene ligger i inventaret på profilen
    const won = draw ? me.winningTickets.length : 0;
    $('my-result').textContent = won ? `🎉 Du har ${won} vinnerlodd! Det er ${won} pils til deg! 🍺` : '';
    $('my-result').className = won ? 'result win' : 'result hidden';
    renderTaskPreview(data.taskPreview);
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

// ---------- Veggen: oppgaver og hva som skjer ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const profileUrl = (n) => `/profil.html?navn=${encodeURIComponent(n)}`;

function renderTaskPreview(list) {
  const ul = $('task-preview');
  ul.innerHTML = '';
  if (!list.length) {
    ul.appendChild(el('li', 'muted', 'Alle oppgavene er tatt. Følg med, det kan komme nye!'));
    return;
  }
  list.forEach((t) => {
    const li = el('li');
    const a = el('a', 'tp-task');
    a.href = '/oppgaver.html';
    a.append(el('span', 'tp-title', t.title), el('span', 'tp-reward', `🎰 ${t.reward} spinn + 💰 ${t.cash}`));
    li.appendChild(a);
    ul.appendChild(li);
  });
}

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

$('feed-more').addEventListener('click', async () => {
  const last = feedItems[feedItems.length - 1];
  if (!last) return;
  try {
    const r = await api(`/api/feed?before=${last.at}`);
    feedItems = feedItems.concat(r.items);
    feedMore = r.more;
    renderFeed();
  } catch (err) {
    alert(err.message);
  }
});

// Kategori ut fra ikonet, så feeden kan fargelegges og filtreres
function feedCat(a) {
  if (/pils|🍺/.test(a.text) && ['🎡', '🎟️', '🎰', '🍺'].includes(a.icon)) return 'beer';
  if (['🎰', '🎡', '♠️', '🃏'].includes(a.icon)) return 'casino';
  if (['⚔️', '🗿', '🕊️'].includes(a.icon)) return 'pvp';
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
  const list = feedItems.filter((a) => feedFilter === 'all' || (feedFilter === 'photos' ? !!a.url : feedCat(a) === feedFilter));
  if (!list.length) box.appendChild(el('p', 'muted center', feedFilter === 'all' ? 'Ingenting har skjedd ennå. Bli den første! 🎉' : 'Ingenting her ennå.'));
  list.forEach((a) => {
    const fresh = !feedFirst && !seenFeed.has(a.id);
    box.appendChild(feedItem(a, fresh));
  });
  feedItems.forEach((a) => seenFeed.add(a.id));
  feedFirst = false;
  $('feed-more').classList.toggle('hidden', !feedMore);
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

// Live: nye hendelser, likes og oppgaver
let feedTimer = null;
const reloadFeedSoon = () => {
  clearTimeout(feedTimer);
  feedTimer = setTimeout(() => data && data.me && loadFeed(), 600);
};
onLive('activity', reloadFeedSoon);
onLive('reactions', reloadFeedSoon);
onLive('tasks', () => data && data.me && refresh());

refresh();
setInterval(refresh, 8000);
