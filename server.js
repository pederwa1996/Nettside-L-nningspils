'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const supabase = require('./supabase');
const { createPoker, SEATS: POKER_SEATS } = require('./poker');
const { createTables } = require('./tables');
const { TASKS: DEFAULT_TASKS, RETIRED: RETIRED_TASKS } = require('./tasks-default');

// ---- Innstillinger (kan overstyres med miljøvariabler) ----
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'pils123';
const TOTAL_TICKETS = Number(process.env.TOTAL_TICKETS) || 100;
const TICKETS_PER_PERSON = Number(process.env.TICKETS_PER_PERSON) || 5;
const WINNING_TICKETS = Number(process.env.WINNING_TICKETS) || 10;
const SPINS_PER_PERSON = Number(process.env.SPINS_PER_PERSON) || 10;
// "all" = trekk blant alle lodd (også de som ikke er delt ut), "assigned" = kun utdelte lodd
const DRAW_FROM = process.env.DRAW_FROM === 'assigned' ? 'assigned' : 'all';
// Sjanse for å treffe «−1 spinn»-feltet på lykkehjulet
const SPIN_LOSE_CHANCE = process.env.SPIN_LOSE_CHANCE !== undefined ? Number(process.env.SPIN_LOSE_CHANCE) : 0.05;
const SPIN_WIN_CHANCE = process.env.SPIN_WIN_CHANCE !== undefined ? Number(process.env.SPIN_WIN_CHANCE) : 0.15;
// Lykkehjulet har også felt som gir cash og et nytt spinn
const SPIN_CASH_CHANCE = process.env.SPIN_CASH_CHANCE !== undefined ? Number(process.env.SPIN_CASH_CHANCE) : 0.10;
const SPIN_BONUS_CHANCE = process.env.SPIN_BONUS_CHANCE !== undefined ? Number(process.env.SPIN_BONUS_CHANCE) : 0.10;
const SPIN_CASH_PRIZE = Number(process.env.SPIN_CASH_PRIZE) || 100;
// Flappy-spillet: første milepæl og hvor ofte et rør dukker opp (brukes til juksesjekk)
const GAME_FIRST_MILESTONE = Number(process.env.GAME_FIRST_MILESTONE) || 50;
const GAME_PIPE_INTERVAL_MS = 1500;
// Sett TRUST_PROXY=true når appen kjører bak en proxy (Render, Railway, Fly, nginx osv.)
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
// Bilder (profilbilder og story) lagres som filer her
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(path.dirname(DATA_FILE), 'media');
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STORIES_PER_PERSON = 20;
const CHAT_HISTORY = 300;
// Kasinoet bruker flus (penger). Alle starter med START_FLUS.
// Spillmesterens budsjett i kroner, og hva én pils koster. Kan endres i admin.
const BUDGET_KR = Number(process.env.BUDGET_KR) || 1800;
const BEER_PRICE_KR = Number(process.env.BEER_PRICE_KR) || 59;
const START_FLUS = process.env.START_FLUS !== undefined ? Number(process.env.START_FLUS) : 500; // «cash» i appen
const CASINO_MIN_BET = 10;
const CASINO_MAX_BET = Number(process.env.CASINO_MAX_BET) || 200;
// Pris i cash for ett spinn på lykkehjulet eller automaten. Holdes over det et trekk på
// automaten gir i snitt (ca. 42 cash + 2 % pils), så cash ikke blir en pengemaskin.
const SPIN_PRICE = Number(process.env.SPIN_PRICE) || 50; // ett trekk på automaten
// Spinn til lykkehjulet kjøpes med cash. Jo flere samtidig, jo billigere per spinn.
const SPIN_PACKS = [
  { n: 1, price: 100 },
  { n: 3, price: 270 },
  { n: 5, price: 400 },
  { n: 10, price: 700 },
];
const MAX_PILS_PER_ORDER = 5;
const POKER_BLINDS = { small: Number(process.env.POKER_SMALL_BLIND) || 5, big: Number(process.env.POKER_BIG_BLIND) || 10 };
const POKER_MIN_BUYIN = Number(process.env.POKER_MIN_BUYIN) || 100;
const POKER_MAX_BUYIN = Number(process.env.POKER_MAX_BUYIN) || 1000;
const MAX_PENDING_ORDERS = 3;

// ---- Lagring ----
function freshState() {
  return { gifts: [], wallPosts: [], suggestions: [], startFlusGiven: START_FLUS, budget: { total: BUDGET_KR, price: BEER_PRICE_KR }, participants: [], draw: null, duels: [], chat: [], stories: [], moggs: [], moggBest: {}, tasks: defaultTasks(), blackjack: {}, casinoLog: [], spinLog: [], orders: [], activity: [], reactions: {}, arena: [], poker: freshPoker() };
}

function freshPoker() {
  return { seats: Array(POKER_SEATS).fill(null), hand: null, button: -1, lastResult: null };
}

function defaultTasks() {
  return DEFAULT_TASKS.map((t) => newTask(t));
}

// Oppgaver gir litt cash i tillegg til spinnene: TASK_CASH_PER_SPIN per spinn i belønning
const TASK_CASH_PER_SPIN = Number(process.env.TASK_CASH_PER_SPIN) || 30;
function taskCash(t) {
  return t.reward * TASK_CASH_PER_SPIN;
}

// Oppgavekategorier:
// - first:  ⚡ Førstemann til mølla – én person kan løse den, så er den tatt
// - duo:    👯 Duo – løses sammen med én kollega; begge får belønningen. Alle par kan gjøre den
// - mingle: 🤝 Mingle – alle kan gjøre den én gang hver
// - gang:   🎉 Hele gjengen – minst `min` personer (deg inkludert); alle som er med får belønningen
// Pils-belønning finnes bare på «Førstemann til mølla», så budsjettet ikke sprekker.
const TASK_CATS = ['first', 'duo', 'mingle', 'gang'];

function newTask({ title, desc, reward, proof, beer, cat, min }) {
  cat = TASK_CATS.includes(cat) ? cat : 'first';
  const givesBeer = cat === 'first' && Number(beer) > 0;
  return {
    id: crypto.randomBytes(6).toString('hex'),
    cat,
    // Hele gjengen: minst så mange personer på bildet/med i oppgaven (deg selv inkludert)
    min: cat === 'gang' ? Math.max(3, Math.min(20, Math.round(Number(min) || 4))) : cat === 'duo' ? 2 : 1,
    title: String(title).slice(0, 80),
    desc: String(desc || '').slice(0, 400),
    // Pils-oppgaver gir én pils til gode i stedet for spinn
    beer: givesBeer ? 1 : 0,
    reward: givesBeer ? 0 : Math.max(1, Math.min(10, Math.round(Number(reward) || 1))),
    proof: proof === 'text' ? 'text' : 'photo',
    status: 'open', // open | pending | done
    attempts: [], // { name, status: pending|approved|rejected, text, url, reason, at }
  };
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return freshState();
  }
}

// Fyller inn felt som mangler i data lagret av eldre versjoner
function normalizeState(s) {
  const out = { ...freshState(), ...s };
  // Fjern utgåtte standardoppgaver (spinn som allerede er gitt beholdes)
  out.tasks = out.tasks.filter((t) => {
    if (!RETIRED_TASKS.includes(t.title)) return true;
    t.attempts.forEach((a) => deleteImage(a.url));
    removedTasks++;
    return false;
  });
  // Nye standardoppgaver legges til i eksisterende data (én gang, så slettede ikke kommer tilbake)
  const added = new Set(out.defaultTasksAdded || [...out.tasks.map((t) => t.title), ...DEFAULT_TASKS.slice(0, 5).map((t) => t.title)]);
  DEFAULT_TASKS.forEach((t) => {
    if (added.has(t.title)) return;
    if (!out.tasks.some((x) => x.title === t.title)) out.tasks.push(newTask(t));
    added.add(t.title);
  });
  out.defaultTasksAdded = [...added];
  // Oppgaver fra før kategoriene fantes: førstemann til mølla
  out.tasks.forEach((t) => {
    if (!TASK_CATS.includes(t.cat)) t.cat = 'first';
    if (!t.min) t.min = t.cat === 'gang' ? 4 : t.cat === 'duo' ? 2 : 1;
  });
  out.participants.forEach((p) => {
    if (p.flus === undefined) p.flus = START_FLUS;
  });
  // Økes startbeløpet, får de som allerede er med mellomlegget (én gang). Spinn regnes ut
  // fra SPINS_PER_PERSON, så de gjelder automatisk for alle.
  const given = (s && s.startFlusGiven) ?? 100; // lagret før dette fantes = 100
  if (START_FLUS > given) out.participants.forEach((p) => (p.flus = (p.flus || 0) + START_FLUS - given));
  out.startFlusGiven = Math.max(given, START_FLUS);
  // Budsjett i ekte kroner (kortet spillmesteren betaler pilsen med)
  out.budget = { total: BUDGET_KR, price: BEER_PRICE_KR, ...(s && s.budget) };
  out.casinoLog = out.casinoLog.filter((e) => e.won !== undefined); // gamle oppføringer hadde annet format
  if (!s.activity) out.activity = backfillActivity(out);
  // Blackjack var tidligere personlig per mobil; nå er det et felles bord.
  // Uferdige hender fra før gir innsatsen tilbake (spinn for de aller eldste, ellers cash).
  for (const [name, h] of Object.entries(out.blackjack || {})) {
    const p = out.participants.find((x) => x.name === name);
    if (h.status === 'playing' && p) {
      if (h.currency === 'flus') p.flus = (p.flus || 0) + h.bet;
      else p.bonusSpins = (p.bonusSpins || 0) + h.bet;
    }
  }
  out.blackjack = {};
  return out;
}

let removedTasks = 0;

// Lager aktivitetshistorikk for data lagret før profilsidene fantes
function backfillActivity(st) {
  const acts = [];
  const add = (name, icon, text, at, extra = {}) =>
    acts.push({ id: crypto.randomBytes(6).toString('hex'), name, icon, text, at, ...extra });
  st.participants.forEach((p) => add(p.name, '🎉', 'ble med på lønningspilsen', Date.parse(p.joinedAt) || Date.now()));
  st.tasks.forEach((t) => t.attempts.forEach((a) => {
    if (a.status === 'approved') add(a.name, '🎯', `fullførte «${t.title}» og fikk ${t.reward} spinn`, a.reviewedAt || a.at, { url: a.url });
  }));
  st.moggs.forEach((m) => {
    if (m.status !== 'done') return;
    const at = m.finishedAt || m.at;
    add(m.challenger, '🗿', moggText(m, m.challenger), at, { url: m.challengerUrl });
    add(m.opponent, '🗿', moggText(m, m.opponent), at, { url: m.opponentUrl });
  });
  return acts.sort((a, b) => a.at - b.at);
}

function moggText(m, name) {
  const other = name === m.challenger ? m.opponent : m.challenger;
  const mine = (name === m.challenger ? m.challengerScore : m.opponentScore).toFixed(2);
  const theirs = (name === m.challenger ? m.opponentScore : m.challengerScore).toFixed(2);
  if (!m.winner) return `mogg-off mot ${other} endte uavgjort (${mine})`;
  return m.winner === name ? `mogget ${other} med ${mine} mot ${theirs} 🗿` : `ble mogget av ${other} (${mine} mot ${theirs})`;
}

let state = normalizeState(loadState());
const games = new Map(); // aktive spill: gameId -> { token, start }

function saveState() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
  supabase.scheduleSave(() => JSON.stringify(state));
}

// ---- Hjelpefunksjoner ----
function randomInt(max) {
  return crypto.randomInt(max);
}

function pickRandom(arr, count) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'ukjent';
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// ---- Passord på profilen ----
// Lagres som scrypt-hash med eget salt, aldri i klartekst.
const MIN_PASSWORD = 4;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex');
  return { salt, hash };
}

function verifyPassword(p, pw) {
  if (!p.pass) return false;
  const given = crypto.scryptSync(String(pw), p.pass.salt, 32);
  return crypto.timingSafeEqual(given, Buffer.from(p.pass.hash, 'hex'));
}

function parseNewPassword(pw) {
  const s = String(pw || '');
  if (s.length < MIN_PASSWORD) throw new Error(`Passordet må ha minst ${MIN_PASSWORD} tegn.`);
  if (s.length > 100) throw new Error('Passordet er for langt.');
  return s;
}

// Begrens innloggingsforsøk: maks 10 feil per IP per 10 minutter
const loginFails = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

function tooManyFails(ip) {
  const f = loginFails.get(ip);
  if (!f || f.until < Date.now()) return false;
  return f.count >= 10;
}

function registerFail(ip) {
  const f = loginFails.get(ip);
  if (!f || f.until < Date.now()) loginFails.set(ip, { count: 1, until: Date.now() + LOGIN_WINDOW_MS });
  else f.count++;
}

function sessionCookie(token) {
  return `pils_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

// Engangskoder for å logge inn på samme profil fra en annen enhet (kode -> { token, expires })
const deviceCodes = new Map();
const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
const DEVICE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // uten O/0 og I/1 som er lette å blande

function newDeviceCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => DEVICE_CODE_CHARS[randomInt(DEVICE_CODE_CHARS.length)]).join('');
  } while (deviceCodes.has(code));
  return code;
}

function currentParticipant(req) {
  const token = parseCookies(req).pils_token;
  if (!token) return null;
  const p = state.participants.find((x) => x.token === token) || null;
  // «Sist online»: lagres sammen med neste endring, så vi slipper å skrive til disk på hvert besøk
  if (p) p.lastSeen = Date.now();
  return p;
}

// Bytter navn overalt der navnet brukes som nøkkel
function renameEverywhere(oldName, newName) {
  const swap = (obj, key) => {
    if (obj && obj[key] === oldName) obj[key] = newName;
  };
  state.duels.forEach((d) => ['challenger', 'opponent', 'winner'].forEach((k) => swap(d, k)));
  state.arena.forEach((a) => ['challenger', 'opponent', 'winner'].forEach((k) => swap(a, k)));
  state.moggs.forEach((m) => ['challenger', 'opponent', 'winner'].forEach((k) => swap(m, k)));
  state.tasks.forEach((t) => t.attempts.forEach((a) => {
    swap(a, 'name');
    if (a.with) a.with = a.with.map((n) => (n === oldName ? newName : n));
  }));
  state.gifts.forEach((g) => ['from', 'to'].forEach((k) => swap(g, k)));
  [state.stories, state.chat, state.activity, state.orders, state.casinoLog, state.spinLog, state.wallPosts, state.suggestions].forEach((list) => list.forEach((x) => swap(x, 'name')));
  Object.values(state.reactions).forEach((r) => {
    r.likes = r.likes.map((n) => (n === oldName ? newName : n));
    r.comments.forEach((c) => swap(c, 'name'));
  });
  state.participants.forEach((p) => {
    (p.notes || []).forEach((n) => swap(n, 'from'));
    (p.guestbook || []).forEach((c) => swap(c, 'from'));
  });
  state.poker.seats.forEach((x) => swap(x, 'name'));
  tables.rename(oldName, newName);
  if (state.poker.hand) Object.values(state.poker.hand.players).forEach((x) => swap(x, 'name'));
  for (const map of [state.moggBest, state.blackjack]) {
    if (map[oldName]) {
      map[newName] = map[oldName];
      delete map[oldName];
    }
  }
}

function usedTickets() {
  return new Set(state.participants.flatMap((p) => p.tickets));
}

function spinsAllowed(p) {
  return SPINS_PER_PERSON + (p.bonusSpins || 0);
}

// Milepæl k (1, 2, 3 ...) krever 50, 100, 200, 400 ... poeng og gir k nye spinn.
function milestoneScore(k) {
  return GAME_FIRST_MILESTONE * 2 ** (k - 1);
}

function milestonesFor(score) {
  let k = 0;
  while (score >= milestoneScore(k + 1)) k++;
  return k;
}

// ---- Bilder ----
// Tar imot et JPEG-bilde som data-URL (nedskalert i nettleseren) og lagrer det som fil.
function saveImage(dataUrl, kind) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Ugyldig bilde. Prøv å ta bildet på nytt.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('Bildet er for stort.');
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Ugyldig bilde. Prøv å ta bildet på nytt.');
  fs.mkdirSync(path.join(MEDIA_DIR, kind), { recursive: true });
  const id = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(path.join(MEDIA_DIR, kind, `${id}.jpg`), buf);
  // Kopi i Supabase, så bildet overlever at serveren starter på nytt
  if (supabase.enabled) supabase.uploadImage(`${kind}/${id}.jpg`, buf);
  return `/media/${kind}/${id}.jpg`;
}

function deleteImage(url) {
  const m = /^\/media\/(avatars|stories|mogg|tasks)\/([a-f0-9]+)\.jpg$/.exec(url || '');
  if (!m) return;
  fs.rm(path.join(MEDIA_DIR, m[1], `${m[2]}.jpg`), { force: true }, () => {});
  if (supabase.enabled) supabase.deleteImages([`${m[1]}/${m[2]}.jpg`]);
}

function avatars() {
  const out = {};
  state.participants.forEach((p) => (out[p.name] = p.avatar || null));
  return out;
}

// ---- Live-oppdateringer (Server-Sent Events) ----
const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
}

setInterval(() => {
  for (const res of sseClients) res.write(': ping\n\n');
}, 20000);

// ---- Story ----
function pruneStories() {
  const cutoff = Date.now() - STORY_TTL_MS;
  const expired = state.stories.filter((s) => s.at < cutoff);
  if (!expired.length) return false;
  expired.forEach((s) => deleteImage(s.url));
  state.stories = state.stories.filter((s) => s.at >= cutoff);
  saveState();
  return true;
}

setInterval(() => {
  if (pruneStories()) broadcast('stories', {});
}, 5 * 60 * 1000);

function storyGroups() {
  pruneStories();
  const groups = new Map();
  for (const s of state.stories) {
    if (!groups.has(s.name)) groups.set(s.name, { name: s.name, avatar: avatars()[s.name] || null, items: [] });
    groups.get(s.name).items.push({ id: s.id, url: s.url, caption: s.caption, at: s.at, expiresAt: s.at + STORY_TTL_MS });
  }
  return [...groups.values()].sort((a, b) => b.items[b.items.length - 1].at - a.items[a.items.length - 1].at);
}

function chatView(m) {
  return { ...m, avatar: avatars()[m.name] || null };
}

// ---- Mogg-off ----
// Poengsummen regnes ut i nettleseren (ansiktsanalyse), serveren sjekker bare at den er gyldig.
function parseMoggScore(v) {
  const n = Math.floor(Number(v) * 100) / 100;
  if (!Number.isFinite(n) || n < 0 || n > 10) throw new Error('Ugyldig poengsum.');
  return n;
}

function parseMoggParts(parts) {
  const out = {};
  for (const k of ['eyes', 'brow', 'jaw', 'stone', 'frame']) {
    const n = Number(parts && parts[k]);
    out[k] = Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n * 10) / 10)) : 0;
  }
  return out;
}

function recordMoggBest(name, url, score) {
  const cur = state.moggBest[name];
  if (cur && cur.score >= score) return;
  state.moggBest[name] = { url, score, at: Date.now() };
}

function moggPodium() {
  return Object.entries(state.moggBest)
    .filter(([name]) => findParticipant(name))
    .map(([name, b]) => ({ name, url: b.url, score: b.score, avatar: avatars()[name] || null }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function moggView(m, viewer) {
  const v = { id: m.id, challenger: m.challenger, opponent: m.opponent, status: m.status, at: m.at };
  if (m.status === 'done') {
    Object.assign(v, {
      challengerUrl: m.challengerUrl, challengerScore: m.challengerScore, challengerParts: m.challengerParts,
      opponentUrl: m.opponentUrl, opponentScore: m.opponentScore, opponentParts: m.opponentParts,
      winner: m.winner,
    });
  } else if (viewer && viewer.name === m.challenger) {
    // Motstanderen får ikke se utfordrerens poeng før hen har tatt sitt eget bilde
    Object.assign(v, { challengerUrl: m.challengerUrl, challengerScore: m.challengerScore });
  }
  return v;
}

// ---- Kasino ----
function addFlus(p, n) {
  p.flus = (p.flus || 0) + n;
}

function parseBet(p, amount) {
  const bet = Math.floor(Number(amount));
  if (!Number.isFinite(bet) || bet < CASINO_MIN_BET) throw new Error(`Minste innsats er ${CASINO_MIN_BET} cash.`);
  if (bet > CASINO_MAX_BET) throw new Error(`Maks innsats er ${CASINO_MAX_BET} cash.`);
  if (bet > (p.flus || 0)) throw new Error(`Du har bare ${p.flus || 0} cash.`);
  return bet;
}

// ---- Automaten (koster 1 spinn, gir flus eller pils) ----
// Utfallet trekkes fra tabellen (vekter av 1000), hjulene tegnes etterpå så de passer.
// ---- Automaten: 3 hjul × 3 rader = 3 gevinstlinjer ----
// Hver rute trekkes med vekt per symbol. Hver linje (topp, midt, bunn) gir den første
// regelen som passer. Sannsynlighetene regnes ut nøyaktig ved oppstart og vises i appen.
// Snitt per trekk er ca. 35 cash + ca. 1,8 % sjanse for en pils, under prisen på 50.
const SLOT_WEIGHTS = { '🍒': 18, '🍋': 14, '🍊': 12, '🔔': 10, '⭐': 8, '7️⃣': 6, '💎': 4, '🍺': 16 };
const SLOT_SYMBOLS = Object.keys(SLOT_WEIGHTS);
const FRUIT = new Set(['🍒', '🍋', '🍊']);
const LUCKY = new Set(['7️⃣', '💎', '⭐']);
const triple = (sym) => (l) => l[0] === sym && l[1] === sym && l[2] === sym;
const SLOT_RULES = [
  { id: 'pils', combo: '🍺🍺🍺', label: 'Tre pils', flus: 0, beer: 1, test: triple('🍺') },
  { id: 'diamond', combo: '💎💎💎', label: 'Diamanter', flus: 1500, test: triple('💎') },
  { id: 'seven', combo: '7️⃣7️⃣7️⃣', label: 'Tre sjuere', flus: 750, test: triple('7️⃣') },
  { id: 'star', combo: '⭐⭐⭐', label: 'Stjerner', flus: 500, test: triple('⭐') },
  { id: 'bell', combo: '🔔🔔🔔', label: 'Bjeller', flus: 300, test: triple('🔔') },
  { id: 'orange', combo: '🍊🍊🍊', label: 'Appelsiner', flus: 200, test: triple('🍊') },
  { id: 'lucky', combo: '7️⃣💎⭐', label: 'Lykketreff (7️⃣ 💎 ⭐ blandet)', flus: 200, test: (l) => l.every((x) => LUCKY.has(x)) && new Set(l).size > 1 },
  { id: 'lemon', combo: '🍋🍋🍋', label: 'Sitroner', flus: 150, test: triple('🍋') },
  { id: 'cherry3', combo: '🍒🍒🍒', label: 'Kirsebær', flus: 125, test: triple('🍒') },
  { id: 'salad', combo: '🍒🍋🍊', label: 'Fruktsalat (én av hver)', flus: 75, test: (l) => new Set(l).size === 3 && l.every((x) => FRUIT.has(x)) },
  { id: 'beer2', combo: '🍺🍺', label: 'To pils på linjen', flus: 50, test: (l) => l.filter((x) => x === '🍺').length === 2 },
  { id: 'cherry2', combo: '🍒🍒', label: 'To kirsebær fra venstre', flus: 25, test: (l) => l[0] === '🍒' && l[1] === '🍒' },
];
const SLOT_LINES = ['Topp', 'Midt', 'Bunn'];

function slotLine(line) {
  return SLOT_RULES.find((r) => r.test(line)) || null;
}

// Nøyaktig sannsynlighet per linje og per trekk (minst én av de tre linjene)
const SLOT_ODDS = (() => {
  const total = SLOT_SYMBOLS.reduce((s, x) => s + SLOT_WEIGHTS[x], 0);
  const pr = (x) => SLOT_WEIGHTS[x] / total;
  const per = {};
  let ev = 0;
  for (const a of SLOT_SYMBOLS) for (const b of SLOT_SYMBOLS) for (const c of SLOT_SYMBOLS) {
    const r = slotLine([a, b, c]);
    if (!r) continue;
    const p = pr(a) * pr(b) * pr(c);
    per[r.id] = (per[r.id] || 0) + p;
    ev += p * r.flus;
  }
  const out = {};
  SLOT_RULES.forEach((r) => {
    const p = per[r.id] || 0;
    out[r.id] = { line: p, pull: 1 - (1 - p) ** SLOT_LINES.length };
  });
  const none = 1 - Object.values(per).reduce((s, p) => s + p, 0);
  return { rules: out, anyWin: 1 - none ** SLOT_LINES.length, avgCash: ev * SLOT_LINES.length };
})();

function slotSymbol() {
  let roll = randomInt(SLOT_SYMBOLS.reduce((s, x) => s + SLOT_WEIGHTS[x], 0));
  return SLOT_SYMBOLS.find((x) => (roll -= SLOT_WEIGHTS[x]) < 0);
}

function pullSlot() {
  // reels[hjul][rad]
  const reels = [0, 1, 2].map(() => [slotSymbol(), slotSymbol(), slotSymbol()]);
  const lines = [];
  SLOT_LINES.forEach((name, row) => {
    const line = reels.map((col) => col[row]);
    const r = slotLine(line);
    if (r) lines.push({ row, name, id: r.id, label: r.label, combo: line.join(''), flus: r.flus, beer: r.beer || 0 });
  });
  return { reels, lines, flus: lines.reduce((s, l) => s + l.flus, 0), beer: lines.reduce((s, l) => s + l.beer, 0) };
}

// Pils vunnet på lykkehjulet: spinn betalt med spinn + spinn betalt med flus
function wheelWins(p) {
  return p.spins.filter(Boolean).length + (p.paidWheelWins || 0);
}

// Betal for ett trekk med spinn eller flus. Kaster feil hvis man ikke har nok.
function payForSpin(p, pay, { wheel = false } = {}) {
  if (pay === 'flus') {
    if ((p.flus || 0) < SPIN_PRICE) throw new Error(`Det koster ${SPIN_PRICE} cash, men du har bare ${p.flus || 0}.`);
    addFlus(p, -SPIN_PRICE);
    return;
  }
  if (spinsLeft(p) < 1) throw new Error(`Du har ingen spinn igjen. Kjøp spinn under lykkehjulet, eller tjen flere med oppgaver, Flappy Sjef eller dueller!`);
  if (!wheel) addSpins(p, -1); // lykkehjulet teller brukte spinn selv i p.spins
}

// ---- Baren ----
function beersWon(p) {
  const winning = new Set(state.draw ? state.draw.winningTickets : []);
  return {
    wheel: wheelWins(p),
    tickets: p.tickets.filter((t) => winning.has(t)).length,
    slot: p.slotBeers || 0,
    task: p.taskBeers || 0,
    pvp: p.pvpBeers || 0, // vunnet minus tapt i arenaen
  };
}

// Pils til gode = vunnet minus det som allerede er bestilt med tilgode
function beersOwed(p) {
  const w = beersWon(p);
  const used = state.orders
    .filter((o) => o.name === p.name && o.pay === 'credit' && o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.qty, 0);
  // Gaver: pils man har fått minus pils man har gitt bort
  return Math.max(0, w.wheel + w.tickets + w.slot + w.task + w.pvp + (p.giftBeers || 0) - used);
}

// Budsjett: brukt = leverte pils (kroner lagres på bestillingen når den leveres).
// «I omløp» = pils til gode + bestillinger som venter, altså mulige utgifter.
function budgetView() {
  const b = state.budget;
  const delivered = state.orders.filter((o) => o.status === 'delivered' && o.kr !== undefined);
  const spent = delivered.reduce((sum, o) => sum + o.kr, 0);
  const owed = state.participants.reduce((sum, p) => sum + beersOwed(p), 0);
  const pending = state.orders.filter((o) => o.status === 'pending').reduce((sum, o) => sum + o.qty, 0);
  const remaining = b.total - spent;
  const potential = (owed + pending) * b.price;
  return {
    total: b.total,
    price: b.price,
    spent,
    remaining,
    beersBought: delivered.reduce((sum, o) => sum + o.qty, 0),
    owed,
    pending,
    potential,
    afterAll: remaining - potential,
    affordable: Math.max(0, Math.floor(remaining / b.price)),
  };
}

function orderView(o) {
  return { id: o.id, name: o.name, qty: o.qty, pay: o.pay, cost: o.cost, note: o.note, status: o.status, at: o.at, doneAt: o.doneAt || null };
}

const GAME_NAMES = { slot: 'automaten', roulette: 'roulette', blackjack: 'blackjack', poker: 'pokerbordet' };

// Registrerer et kasinospill. Gevinster vises live i kasinoet, store gevinster havner på profilen.
// won = det som vises som gevinst, net = hva man faktisk tjente/tapte (til statistikken)
function logCasino(p, game, { won = 0, beer = 0, net = 0, detail = '' }) {
  p.casinoNet = (p.casinoNet || 0) + net;
  if (won <= 0 && !beer) return;
  const entry = { name: p.name, game, won, beer, detail, at: Date.now() };
  state.casinoLog.push(entry);
  if (state.casinoLog.length > 30) state.casinoLog = state.casinoLog.slice(-30);
  broadcast('casino-win', { ...entry, avatar: p.avatar || null });
  if (beer) {
    addActivity(p.name, '🎰', `fikk 🍺🍺🍺 på automaten og vant en pils!`);
    announceBeer(p.name, `🍺 ${p.name} vant en pils på automaten!`, 3500);
  }
  else if (won >= 100) addActivity(p.name, '🎰', `vant ${won} cash på ${GAME_NAMES[game]}`);
}

// Grønn tekst øverst til høyre for alle når noen vinner en pils. Venter til
// hjulet/automaten har stoppet, så vinneren ikke får vite det før animasjonen er ferdig.
const recentBeerWins = []; // de siste, så en side som lastes akkurat nå også får dem med seg
function announceBeer(name, text, delayMs = 0) {
  setTimeout(() => {
    const e = { id: crypto.randomBytes(5).toString('hex'), name, text, at: Date.now() };
    recentBeerWins.push(e);
    if (recentBeerWins.length > 10) recentBeerWins.shift();
    broadcast('beer-win', e);
  }, delayMs);
}

// ---- Oppgaver ----
const MAX_PENDING_TASKS = 2;

// 🎁 Gaver til andre: spinn, cash eller pils (fra det man selv har)
const GIFT_KINDS = {
  spins: { label: 'spinn', icon: '🎡', min: 1, max: 10 },
  cash: { label: 'cash', icon: '💰', min: 10, max: 1000 },
  beer: { label: 'pils', icon: '🍺', min: 1, max: 3 },
};
function giftBalance(p, kind) {
  if (kind === 'cash') return p.flus || 0;
  if (kind === 'spins') return spinsLeft(p);
  return beersOwed(p);
}
function giftMove(p, kind, n) {
  if (kind === 'cash') addFlus(p, n);
  else if (kind === 'spins') addSpins(p, n);
  else p.giftBeers = (p.giftBeers || 0) + n;
}
function giftWord(kind, n) {
  const k = GIFT_KINDS[kind];
  return kind === 'beer' ? `${n} pils 🍺` : `${n} ${k.label} ${k.icon}`;
}

// 💡 Forslag til admin: belønning for de første forslagene fra hver person
const SUGGESTION_SPINS = 1;
const SUGGESTION_CASH = 50;
const SUGGESTION_REWARD_MAX = 3;
const SUGGESTION_KINDS = { better: '🛠️ Kan bli bedre', task: '🎯 Ny oppgave', game: '🎮 Nytt spill', other: '💬 Annet' };
const lastPostAt = new Map(); // navn -> tid, enkel sperre mot spam på veggen og forslag

function wallPostView(x) {
  const p = findParticipant(x.name);
  return { id: x.id, name: x.name, avatar: (p && p.avatar) || null, text: x.text, at: x.at };
}

function currentAttempt(t) {
  return t.attempts[t.attempts.length - 1] || null;
}

// Alle som er med på en innlevering (den som leverte + kollegaene i duo/gjengen)
function taskPeople(a) {
  return [a.name, ...(a.with || [])];
}

// Innleveringen (ventende eller godkjent) som denne personen er med på
function activeAttemptFor(t, name) {
  return t.attempts.find((a) => a.status !== 'rejected' && taskPeople(a).includes(name)) || null;
}

// Kan denne personen fortsatt gjøre oppgaven?
function taskOpenFor(t, name) {
  if (t.cat === 'first' || !t.cat) return t.status === 'open';
  return !name || !activeAttemptFor(t, name);
}

// Offentlig visning: bevis (bilde/tekst) vises bare for den som leverte
function taskView(t, viewer) {
  const v = { id: t.id, cat: t.cat || 'first', min: t.min || 1, title: t.title, desc: t.desc, reward: t.reward, cash: taskCash(t), beer: t.beer || 0, proof: t.proof, status: t.status };
  if (v.cat === 'first') {
    const cur = currentAttempt(t);
    if (t.status === 'pending') v.claimedBy = cur.name;
    if (t.status === 'done') v.completedBy = cur.name;
  } else {
    // Alle kan gjøre den: vis hvem som har klart den
    const done = t.attempts.filter((a) => a.status === 'approved');
    v.doneCount = done.length;
    v.doneBy = done.slice(-8).reverse().map((a) => taskPeople(a));
    v.status = 'open';
  }
  if (viewer) {
    const mine = t.attempts.filter((a) => taskPeople(a).includes(viewer.name));
    if (mine.length) {
      const last = mine[mine.length - 1];
      v.myAttempt = { id: last.id || null, status: last.status, reason: last.reason || '', at: last.at, by: last.name, with: last.with || [] };
    }
  }
  return v;
}

function adminTaskView(t) {
  const approved = t.attempts.filter((a) => a.status === 'approved').length;
  return { ...t, approved, attempts: t.attempts.filter((a, i) => a.status === 'pending' || i >= t.attempts.length - 5) };
}

// Alle innleveringer som venter på godkjenning, eldste først
function taskQueue() {
  const out = [];
  state.tasks.forEach((t) => t.attempts.forEach((a) => {
    if (a.status !== 'pending') return;
    const p = findParticipant(a.name);
    out.push({ id: t.id, attempt: a.id || null, cat: t.cat || 'first', title: t.title, reward: t.reward, cash: taskCash(t), beer: t.beer || 0, name: a.name, with: a.with || [], avatar: (p && p.avatar) || null, text: a.text, url: a.url, at: a.at });
  }));
  return out.sort((a, b) => a.at - b.at);
}

const TASK_CAT_LABEL = { first: '', duo: 'duo-oppgaven ', mingle: '', gang: 'gjeng-oppgaven ' };
const joinNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`);

// ---- Arena: små PvP-spill om cash, spinn eller pils ----
// Utfordreren spiller sin del og setter inn innsatsen. Motstanderen godtar og spiller,
// og vinneren tar hele potten. Uavgjort: begge får innsatsen tilbake.
const ARENA_GAMES = {
  dice: { name: 'Terningduell', icon: '🎲' },
  reaction: { name: 'Reaksjon', icon: '⚡' },
  math: { name: 'Hoderegning', icon: '🧠' },
};
const ARENA_STAKES = {
  cash: { label: 'cash', icon: '💰', min: 10, max: 500 },
  spins: { label: 'spinn', icon: '🎡', min: 1, max: 5 },
  beer: { label: 'pils', icon: '🍺', min: 1, max: 2 },
};
const MAX_OPEN_ARENA = 3;
const MATH_QUESTIONS = 6;
const arenaSessions = new Map(); // id -> { name, game, startAt, answers }

function stakeBalance(p, type) {
  if (type === 'cash') return p.flus || 0;
  if (type === 'spins') return spinsLeft(p);
  return beersOwed(p);
}

function moveStake(p, type, n) {
  if (type === 'cash') addFlus(p, n);
  else if (type === 'spins') addSpins(p, n);
  else p.pvpBeers = (p.pvpBeers || 0) + n;
}

function stakeWord(type, n) {
  const s = ARENA_STAKES[type];
  return `${n} ${s.label} ${s.icon}`;
}

function newMathQuestions() {
  const qs = [];
  for (let i = 0; i < MATH_QUESTIONS; i++) {
    const kind = randomInt(3);
    let a;
    let b;
    let q;
    let ans;
    if (kind === 0) {
      a = 12 + randomInt(78);
      b = 12 + randomInt(78);
      q = `${a} + ${b}`;
      ans = a + b;
    } else if (kind === 1) {
      a = 40 + randomInt(60);
      b = 5 + randomInt(35);
      q = `${a} − ${b}`;
      ans = a - b;
    } else {
      a = 3 + randomInt(10);
      b = 3 + randomInt(10);
      q = `${a} × ${b}`;
      ans = a * b;
    }
    qs.push({ q, ans });
  }
  return qs;
}

// Regn ut poeng for et spill (høyere er bedre) ut fra økten serveren startet
function arenaScore(p, game, body) {
  if (game === 'dice') {
    const d = [1 + randomInt(6), 1 + randomInt(6)];
    return { score: d[0] + d[1], detail: `🎲 ${d[0]} + ${d[1]} = ${d[0] + d[1]}` };
  }
  const sess = arenaSessions.get(String(body.sessionId || ''));
  if (!sess || sess.name !== p.name || sess.game !== game) throw new Error('Spillet er utløpt. Prøv igjen.');
  arenaSessions.delete(body.sessionId);
  const elapsed = Date.now() - sess.startAt;
  if (game === 'reaction') {
    const times = Array.isArray(body.times) ? body.times.slice(0, 3).map(Number) : [];
    if (times.length !== 3 || times.some((t) => !Number.isFinite(t))) throw new Error('Mangler tidene fra reaksjonstesten.');
    // Tjuvstart teller som 1000 ms. Raskere enn 100 ms er ikke menneskelig.
    const clean = times.map((t) => (t < 0 ? 1000 : Math.max(100, Math.min(1000, Math.round(t)))));
    // Testen har tilfeldige pauser på minst 1,5 s per runde, så den kan ikke ha gått raskere enn det
    if (elapsed < 4500) throw new Error('Det gikk litt for fort. Prøv igjen.');
    const avg = Math.round(clean.reduce((a, b) => a + b, 0) / 3);
    return { score: -avg, detail: `⚡ ${avg} ms i snitt` };
  }
  // Hoderegning: antall riktige, deretter tiden målt av serveren
  const answers = Array.isArray(body.answers) ? body.answers : [];
  const correct = sess.questions.filter((q, i) => Number(answers[i]) === q.ans).length;
  const secs = Math.min(600, elapsed / 1000);
  return { score: correct * 1000 - secs, detail: `🧠 ${correct}/${MATH_QUESTIONS} riktige på ${secs.toFixed(1)} s` };
}

function arenaView(a, viewer) {
  const v = {
    id: a.id,
    game: a.game,
    gameName: ARENA_GAMES[a.game].name,
    icon: ARENA_GAMES[a.game].icon,
    challenger: a.challenger,
    opponent: a.opponent,
    stakeType: a.stakeType,
    stake: a.stake,
    stakeText: stakeWord(a.stakeType, a.stake),
    status: a.status,
    at: a.at,
    winner: a.winner || null,
  };
  // Utfordrerens resultat er hemmelig til motstanderen har spilt
  if (a.status === 'done') Object.assign(v, { cDetail: a.cDetail, oDetail: a.oDetail });
  else if (viewer && viewer.name === a.challenger) v.cDetail = a.game === 'dice' ? '🎲 Hemmelig til motstanderen har kastet' : a.cDetail;
  return v;
}

// ---- Duell (stein, saks, papir med innsats) ----
const MOVES = ['stein', 'saks', 'papir'];
const BEATS = { stein: 'saks', saks: 'papir', papir: 'stein' };
const MAX_OPEN_DUELS = 3;

function spinsLeft(p) {
  return spinsAllowed(p) - p.spins.length;
}

// Innsatsen trekkes fra/legges til via bonusSpins, så spinn kan flyttes mellom spillere.
function addSpins(p, n) {
  p.bonusSpins = (p.bonusSpins || 0) + n;
}

// ---- Hvem er her (tilstedeværelse per side) ----
// Bare i minnet: token -> { room, at }. Nettleseren sender et livstegn hvert 20. sekund.
const presence = new Map();
const PRESENCE_TTL_MS = 45000;

function presenceView() {
  const rooms = {};
  const seen = new Set();
  for (const [token, v] of presence) {
    const p = state.participants.find((x) => x.token === token);
    if (!p || seen.has(`${v.room}|${p.name}`)) continue; // samme person på flere enheter
    seen.add(`${v.room}|${p.name}`);
    (rooms[v.room] = rooms[v.room] || []).push({ name: p.name, avatar: p.avatar || null, since: v.since, target: v.target || null });
  }
  Object.values(rooms).forEach((list) => list.sort((a, b) => a.since - b.since));
  return rooms;
}

let presenceTimer = null;
function presenceChanged() {
  // Samle flere endringer på rad til én melding
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => broadcast('presence', presenceView()), 300);
}

setInterval(() => {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  let changed = false;
  for (const [token, v] of presence) {
    if (v.at < cutoff) {
      presence.delete(token);
      changed = true;
    }
  }
  if (changed) presenceChanged();
}, 10000);

// ---- Poker ----
const poker = createPoker({
  state: () => state,
  save: saveState,
  broadcast,
  findParticipant,
  addFlus: (p, n) => addFlus(p, n),
  shuffle: (arr) => pickRandom(arr, arr.length),
  onWin: (name, won, net, handName) => {
    const p = findParticipant(name);
    if (p) logCasino(p, 'poker', { won: net, net, detail: handName || '' });
  },
  blinds: POKER_BLINDS,
  minBuyIn: POKER_MIN_BUYIN,
  maxBuyIn: POKER_MAX_BUYIN,
});

// ---- Felles blackjack-bord og roulette ----
const tables = createTables({
  state: () => state,
  save: saveState,
  broadcast,
  findParticipant,
  addFlus: (p, n) => addFlus(p, n),
  shuffle: (arr) => pickRandom(arr, arr.length),
  randomInt,
  minBet: CASINO_MIN_BET,
  maxBet: CASINO_MAX_BET,
  onWin: (name, game, won, net, detail) => {
    const p = findParticipant(name);
    if (p) logCasino(p, game, { won, net, detail });
  },
});

// ---- Aktivitet og reaksjoner (likes/kommentarer) ----
const MAX_ACTIVITY = 2000;

function addActivity(name, icon, text, extra = {}) {
  const a = { id: crypto.randomBytes(6).toString('hex'), name, icon, text, at: Date.now(), ...extra };
  state.activity.push(a);
  if (state.activity.length > MAX_ACTIVITY) state.activity = state.activity.slice(-MAX_ACTIVITY);
  broadcast('activity', { name });
  return a;
}

// ---- Varsler til én bruker (🔔-boblen) ----
// Lagres på deltakeren, så de følger med ved navnebytte.
const MAX_NOTES = 50;

function notify(name, icon, text, { url = '', from = null, key = null } = {}) {
  const p = findParticipant(name);
  if (!p) return;
  p.notes = p.notes || [];
  // Samme hendelse to ganger (f.eks. like, fjern like, like igjen) gir bare ett varsel
  if (key && p.notes.some((n) => n.key === key)) return;
  const note = { id: crypto.randomBytes(6).toString('hex'), icon, text, url, from, at: Date.now(), read: false };
  if (key) note.key = key;
  p.notes.push(note);
  if (p.notes.length > MAX_NOTES) p.notes = p.notes.slice(-MAX_NOTES);
  broadcast('notify', { to: p.name });
}

function postWord(a) {
  if (a.story) return 'storyen din';
  return a.url ? 'bildet ditt' : 'innlegget ditt';
}

function postUrl(a) {
  return `/profil.html?navn=${encodeURIComponent(a.name)}&innlegg=${a.id}`;
}

const MAX_BIO = 160;
const MAX_GUESTBOOK = 100;
function guestbookView(p) {
  const av = avatars();
  return (p.guestbook || []).slice().reverse().map((c) => ({ ...c, avatar: av[c.from] || null }));
}

function reactionsFor(id) {
  return state.reactions[id] || { likes: [], comments: [] };
}

function activityView(a, viewer) {
  const r = reactionsFor(a.id);
  const v = { id: a.id, name: a.name, icon: a.icon, text: a.text, at: a.at };
  // Story-bilder forsvinner etter 24 timer
  const storyGone = a.story && !state.stories.some((x) => x.id === a.story);
  if (a.url && !storyGone) v.url = a.url;
  if (a.story) v.story = true;
  v.likes = r.likes.length;
  v.likedBy = r.likes.slice(-5);
  v.liked = !!viewer && r.likes.includes(viewer.name);
  v.comments = r.comments.map((c) => ({ ...c, avatar: avatars()[c.name] || null }));
  return v;
}

function profileStats(p) {
  const w = beersWon(p);
  const record = (list, winnerKey = 'winner') => {
    let won = 0;
    let lost = 0;
    list.forEach((x) => {
      if (x.status !== 'done' || (x.challenger !== p.name && x.opponent !== p.name) || !x[winnerKey]) return;
      if (x[winnerKey] === p.name) won++;
      else lost++;
    });
    return { won, lost };
  };
  return {
    beersWon: w.wheel + w.tickets + w.slot + w.task + w.pvp,
    beersOwed: beersOwed(p),
    spinsLeft: spinsLeft(p),
    flus: p.flus || 0,
    wheelSpins: p.spins.length + (p.paidWheelSpins || 0),
    flappyBest: p.bestScore || 0,
    moggBest: state.moggBest[p.name] ? state.moggBest[p.name].score : null,
    duels: record(state.duels),
    moggs: record(state.moggs),
    tasksDone: state.tasks.reduce((n, t) => n + t.attempts.filter((a) => a.status === 'approved' && taskPeople(a).includes(p.name)).length, 0),
    casinoNet: p.casinoNet || 0,
    chatMessages: state.chat.filter((m) => m.name === p.name).length,
  };
}

function findActivity(id) {
  return state.activity.find((a) => a.id === id) || null;
}

function findParticipant(name) {
  return state.participants.find((p) => p.name === name) || null;
}

function duelView(d, viewer) {
  const v = {
    id: d.id,
    challenger: d.challenger,
    opponent: d.opponent,
    stake: d.stake,
    status: d.status, // pending | done | declined | cancelled
    createdAt: d.createdAt,
    finishedAt: d.finishedAt || null,
  };
  // Trekkene vises først når duellen er ferdig, så motstanderen ikke kan se hva utfordreren valgte.
  if (d.status === 'done') {
    v.challengerMove = d.challengerMove;
    v.opponentMove = d.opponentMove;
    v.winner = d.winner; // navn, eller null ved uavgjort
  } else if (viewer && viewer.name === d.challenger) {
    v.challengerMove = d.challengerMove;
  }
  return v;
}

// Øl vunnet (lykkehjul + vinnerlodd) og spinn igjen per person
function standings() {
  return state.participants
    .map((p) => {
      const w = beersWon(p);
      return {
        name: p.name,
        beers: w.wheel + w.tickets + w.slot + w.task + w.pvp,
        wheelBeers: w.wheel,
        ticketBeers: w.tickets,
        slotBeers: w.slot,
        taskBeers: w.task,
        spinsLeft: spinsLeft(p),
        flus: p.flus || 0,
      };
    })
    .sort((a, b) => b.beers - a.beers || b.spinsLeft - a.spinsLeft || a.name.localeCompare(b.name, 'no'));
}

function leaderboard() {
  return state.participants
    .filter((p) => p.bestScore > 0)
    .map((p) => ({ name: p.name, score: p.bestScore }))
    .sort((a, b) => b.score - a.score);
}

function publicDraw() {
  if (!state.draw) return null;
  const owners = {};
  state.participants.forEach((p) => p.tickets.forEach((t) => (owners[t] = p.name)));
  return {
    drawnAt: state.draw.drawnAt,
    winners: state.draw.winningTickets.map((t) => ({ ticket: t, name: owners[t] || null })),
  };
}

function meView(p) {
  if (!p) return null;
  const winning = state.draw ? p.tickets.filter((t) => state.draw.winningTickets.includes(t)) : [];
  return {
    name: p.name,
    avatar: p.avatar || null,
    isAdmin: !!p.isAdmin,
    hasPassword: !!p.pass,
    tickets: p.tickets,
    spinsLeft: spinsAllowed(p) - p.spins.length,
    bonusSpins: p.bonusSpins || 0,
    bestScore: p.bestScore || 0,
    nextMilestone: { score: milestoneScore((p.milestones || 0) + 1), spins: (p.milestones || 0) + 1 },
    spinWins: wheelWins(p),
    winningTickets: winning,
    flus: p.flus || 0,
    beersOwed: beersOwed(p),
  };
}

function settings() {
  return {
    totalTickets: TOTAL_TICKETS,
    ticketsPerPerson: TICKETS_PER_PERSON,
    winningTickets: WINNING_TICKETS,
    spinsPerPerson: SPINS_PER_PERSON,
    spinWinChance: SPIN_WIN_CHANCE,
    gameFirstMilestone: GAME_FIRST_MILESTONE,
    spinPrice: SPIN_PRICE,
    spinPacks: SPIN_PACKS,
    suggestionReward: { spins: SUGGESTION_SPINS, cash: SUGGESTION_CASH, max: SUGGESTION_REWARD_MAX },
    startCash: START_FLUS,
    taskCashPerSpin: TASK_CASH_PER_SPIN,
  };
}

function checkPassword(body) {
  const given = Buffer.from(String(body.password || ''));
  const real = Buffer.from(ADMIN_PASSWORD);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}

// Admin er enten den som kan passordet, eller deltakeren som er koblet til admin (spillmesteren)
function checkAdmin(body, req) {
  if (checkPassword(body)) return true;
  const p = req ? currentParticipant(req) : null;
  return !!(p && p.isAdmin);
}

function adminNames() {
  return state.participants.filter((p) => p.isAdmin).map((p) => p.name);
}

// ---- HTTP ----
function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 3_000_000) {
        reject(new Error('For stor forespørsel'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Ugyldig JSON'));
      }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
};

function serveMedia(pathname, res) {
  const m = /^\/media\/(avatars|stories|mogg|tasks)\/([a-f0-9]+)\.jpg$/.exec(pathname);
  if (!m) {
    res.writeHead(404);
    return res.end();
  }
  fs.readFile(path.join(MEDIA_DIR, m[1], `${m[2]}.jpg`), (err, content) => {
    if (err) {
      // Etter omstart ligger bildet bare i Supabase
      if (supabase.enabled) {
        res.writeHead(302, { Location: supabase.publicUrl(`${m[1]}/${m[2]}.jpg`), 'Cache-Control': 'public, max-age=3600' });
        return res.end();
      }
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    res.end(content);
  });
}

const OPEN_PAGES = new Set(['index.html', 'admin.html', 'admin-spinn.html']);

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  // Chatten er en boble på alle sider nå; gamle lenker åpner den på forsiden
  if (urlPath === '/chat.html') {
    res.writeHead(302, { Location: '/#chat', 'Cache-Control': 'no-store' });
    return res.end();
  }
  // Alle sider utenom forsiden og admin krever at man er registrert/logget inn
  if (file.endsWith('.html') && !OPEN_PAGES.has(path.basename(file)) && !currentParticipant(req)) {
    res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
    return res.end();
  }
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Fant ikke siden');
    }
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
    // HTML skal ikke caches, ellers kan nettleseren vise en side man ikke lenger har tilgang til
    if (file.endsWith('.html')) headers['Cache-Control'] = 'no-store';
    if (urlPath.startsWith('/vendor/')) headers['Cache-Control'] = 'public, max-age=604800';
    res.writeHead(200, headers);
    res.end(content);
  });
}

const routes = {
  'GET /api/state': (req, res) => {
    const me = currentParticipant(req);
    sendJson(res, 200, {
      settings: settings(),
      me: meView(me),
      participantCount: state.participants.length,
      ticketsLeft: TOTAL_TICKETS - usedTickets().size,
      participants: state.participants.map((p) => p.name),
      avatars: avatars(),
      admins: adminNames(),
      draw: publicDraw(),
      leaderboard: leaderboard(),
      standings: standings(),
      incomingDuels: me ? state.duels.filter((d) => d.status === 'pending' && d.opponent === me.name).length : 0,
      openTasks: state.tasks.filter((t) => taskOpenFor(t, me && me.name)).length,
      incomingMoggs: me ? state.moggs.filter((m) => m.status === 'pending' && m.opponent === me.name).length : 0,
      incomingArena: me ? state.arena.filter((a) => a.status === 'pending' && a.opponent === me.name).length : 0,
    });
  },

  // Veggen: hva alle har gjort, nyeste først. ?before=<tid> henter eldre.
  'GET /api/beer-wins': (req, res) => {
    sendJson(res, 200, { now: Date.now(), wins: recentBeerWins });
  },

  'GET /api/feed': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const before = Number(new URL(req.url, 'http://x').searchParams.get('before')) || Infinity;
    const av = avatars();
    const admins = adminNames();
    const items = [];
    for (let i = state.activity.length - 1; i >= 0 && items.length < 25; i--) {
      const a = state.activity[i];
      if (a.at >= before) continue;
      items.push({ ...activityView(a, p), avatar: av[a.name] || null, admin: admins.includes(a.name) });
    }
    sendJson(res, 200, { items, more: items.length === 25 });
  },

  'POST /api/join': (req, res, body) => {
    if (currentParticipant(req)) return sendJson(res, 400, { error: 'Du er allerede registrert.' });

    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 40) return sendJson(res, 400, { error: 'Navnet må være mellom 2 og 40 tegn.' });
    const key = normalizeName(name);
    if (state.participants.some((p) => normalizeName(p.name) === key)) {
      return sendJson(res, 409, { error: 'Det navnet er allerede tatt. Er det deg? Trykk «Logg inn» og bruk passordet ditt.' });
    }
    const password = parseNewPassword(body.password);

    if (!body.avatar) return sendJson(res, 400, { error: 'Du må ta et profilbilde 📸' });

    // Man kan alltid bli med. Etter trekningen, eller når loddene er tomme, får man bare ingen lodd.
    const used = usedTickets();
    const free = [];
    if (!state.draw) for (let i = 1; i <= TOTAL_TICKETS; i++) if (!used.has(i)) free.push(i);

    const participant = {
      name,
      token: crypto.randomBytes(24).toString('hex'),
      pass: hashPassword(password),
      avatar: saveImage(body.avatar, 'avatars'),
      tickets: pickRandom(free, Math.min(TICKETS_PER_PERSON, free.length)).sort((a, b) => a - b),
      spins: [],
      flus: START_FLUS,
      joinedAt: new Date().toISOString(),
    };
    state.participants.push(participant);
    addActivity(name, '🎉', 'ble med på lønningspilsen');
    saveState();

    sendJson(res, 200, { me: meView(participant) }, { 'Set-Cookie': sessionCookie(participant.token) });
  },

  'POST /api/presence': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 200, { rooms: presenceView() });
    const room = String(body.room || '').slice(0, 40).replace(/[^a-z0-9:-]/gi, '');
    if (!room) return sendJson(res, 400, { error: 'Ukjent side.' });
    const prev = presence.get(p.token);
    const now = Date.now();
    // På en profil: hvem man ser på (til statusen «Stalker» på forsiden)
    const seen = room === 'profil' ? (findParticipant(String(body.target || '')) || p).name : null;
    const same = prev && prev.room === room && prev.target === seen;
    presence.set(p.token, { room, target: seen, at: now, since: same ? prev.since : now });
    if (!same) presenceChanged();
    sendJson(res, 200, { rooms: presenceView() });
  },

  // ---------- 🧱 Veggen: folk skriver hva de vil ----------
  'GET /api/wallposts': (req, res) => {
    sendJson(res, 200, { posts: state.wallPosts.slice(-60).reverse().map(wallPostView) });
  },

  'POST /api/wallposts': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 280);
    if (!text) return sendJson(res, 400, { error: 'Skriv noe først ✍️' });
    const last = lastPostAt.get(`wall|${p.name}`) || 0;
    if (Date.now() - last < 8000) return sendJson(res, 400, { error: 'Rolig nå! Vent noen sekunder før du skriver igjen.' });
    lastPostAt.set(`wall|${p.name}`, Date.now());
    const post = { id: crypto.randomBytes(6).toString('hex'), name: p.name, text, at: Date.now() };
    state.wallPosts.push(post);
    if (state.wallPosts.length > 300) state.wallPosts = state.wallPosts.slice(-300);
    saveState();
    broadcast('wallposts', {});
    sendJson(res, 200, { post: wallPostView(post) });
  },

  'POST /api/wallposts/delete': (req, res, body) => {
    const p = currentParticipant(req);
    const post = state.wallPosts.find((x) => x.id === body.id);
    if (!post) return sendJson(res, 404, { error: 'Fant ikke innlegget.' });
    if (!checkAdmin(body, req) && (!p || p.name !== post.name)) return sendJson(res, 403, { error: 'Du kan bare slette dine egne innlegg.' });
    state.wallPosts = state.wallPosts.filter((x) => x !== post);
    saveState();
    broadcast('wallposts', {});
    sendJson(res, 200, { ok: true });
  },

  // ---------- 🎁 Gaver ----------
  'GET /api/gifts': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    sendJson(res, 200, {
      kinds: GIFT_KINDS,
      balance: { spins: spinsLeft(p), cash: p.flus || 0, beer: beersOwed(p) },
      received: state.gifts.filter((g) => g.to === p.name).slice(-20).reverse(),
      sent: state.gifts.filter((g) => g.from === p.name).slice(-20).reverse(),
    });
  },

  'POST /api/gifts': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const to = findParticipant(String(body.to || ''));
    if (!to) return sendJson(res, 404, { error: 'Fant ikke den personen.' });
    if (to.name === p.name) return sendJson(res, 400, { error: 'Du kan ikke gi en gave til deg selv 😄' });
    const kind = GIFT_KINDS[body.kind] ? body.kind : null;
    if (!kind) return sendJson(res, 400, { error: 'Velg spinn, cash eller pils.' });
    const k = GIFT_KINDS[kind];
    const n = Math.floor(Number(body.amount));
    if (!Number.isFinite(n) || n < k.min || n > k.max) return sendJson(res, 400, { error: `Du kan gi ${k.min}–${k.max} ${k.label} om gangen.` });
    if (giftBalance(p, kind) < n) return sendJson(res, 400, { error: `Du har bare ${giftBalance(p, kind)} ${k.label}.` });
    const last = lastPostAt.get(`gift|${p.name}`) || 0;
    if (Date.now() - last < 3000) return sendJson(res, 400, { error: 'Vent litt før du sender en ny gave.' });
    lastPostAt.set(`gift|${p.name}`, Date.now());
    const msg = String(body.message || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    giftMove(p, kind, -n);
    giftMove(to, kind, n);
    const gift = { id: crypto.randomBytes(6).toString('hex'), from: p.name, to: to.name, kind, amount: n, msg, at: Date.now() };
    state.gifts.push(gift);
    if (state.gifts.length > 500) state.gifts = state.gifts.slice(-500);
    addActivity(p.name, '🎁', `ga ${to.name} ${giftWord(kind, n)} i gave${msg ? `: «${msg}»` : ''}`);
    notify(to.name, '🎁', `${p.name} ga deg ${giftWord(kind, n)}!${msg ? ` «${msg}»` : ''}${kind === 'beer' ? ' Løs den inn i baren 🍻' : ''}`, { url: kind === 'beer' ? '/baren.html' : `/profil.html?navn=${encodeURIComponent(p.name)}`, from: p.name });
    saveState();
    sendJson(res, 200, { gift, me: meView(p) });
  },

  // ---------- 💡 Forslag til admin ----------
  'POST /api/suggestions': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const kind = SUGGESTION_KINDS[body.kind] ? body.kind : 'other';
    const text = String(body.text || '').trim().slice(0, 1000);
    if (text.length < 10) return sendJson(res, 400, { error: 'Skriv litt mer, minst 10 tegn 🙂' });
    const last = lastPostAt.get(`sugg|${p.name}`) || 0;
    if (Date.now() - last < 30000) return sendJson(res, 400, { error: 'Takk! Vent litt før du sender et nytt forslag.' });
    lastPostAt.set(`sugg|${p.name}`, Date.now());
    // Belønning for de første forslagene, så ingen kan sende tull for å tjene spinn
    const rewarded = state.suggestions.filter((x) => x.name === p.name && x.rewarded).length < SUGGESTION_REWARD_MAX;
    state.suggestions.push({ id: crypto.randomBytes(6).toString('hex'), name: p.name, kind, text, at: Date.now(), read: false, rewarded });
    if (rewarded) {
      addSpins(p, SUGGESTION_SPINS);
      addFlus(p, SUGGESTION_CASH);
    }
    adminNames().forEach((n) => n !== p.name && notify(n, '💡', `${p.name} sendte et forslag: ${SUGGESTION_KINDS[kind]}`, { url: '/admin.html#forslag', from: p.name }));
    saveState();
    sendJson(res, 200, { rewarded, spins: rewarded ? SUGGESTION_SPINS : 0, cash: rewarded ? SUGGESTION_CASH : 0, me: meView(p) });
  },

  'POST /api/admin/suggestion': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    const x = state.suggestions.find((y) => y.id === body.id);
    if (!x) return sendJson(res, 404, { error: 'Fant ikke forslaget.' });
    if (body.action === 'delete') state.suggestions = state.suggestions.filter((y) => y !== x);
    else x.read = body.action !== 'unread';
    saveState();
    sendJson(res, 200, { ok: true });
  },

  'POST /api/presence/leave': (req, res) => {
    const p = currentParticipant(req);
    if (p && presence.delete(p.token)) presenceChanged();
    sendJson(res, 200, { ok: true });
  },

  'POST /api/rename': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 40) return sendJson(res, 400, { error: 'Navnet må være mellom 2 og 40 tegn.' });
    if (name === p.name) return sendJson(res, 400, { error: 'Det er jo det samme navnet 😄' });
    const key = normalizeName(name);
    if (state.participants.some((x) => x !== p && normalizeName(x.name) === key)) {
      return sendJson(res, 409, { error: 'Det navnet er allerede tatt.' });
    }
    const old = p.name;
    renameEverywhere(old, name);
    p.name = name;
    addActivity(name, '✏️', `byttet navn fra ${old}`);
    presenceChanged();
    saveState();
    broadcast('avatars', avatars());
    sendJson(res, 200, { me: meView(p) });
  },

  // ---- Samme profil på flere enheter ----
  'POST /api/device-code': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const now = Date.now();
    for (const [c, v] of deviceCodes) if (v.expires < now || v.token === p.token) deviceCodes.delete(c);
    const code = newDeviceCode();
    deviceCodes.set(code, { token: p.token, expires: now + DEVICE_CODE_TTL_MS });
    sendJson(res, 200, { code, expiresInMinutes: DEVICE_CODE_TTL_MS / 60000 });
  },

  // Logg inn med navn og passord (virker på alle enheter og nettverk)
  'POST /api/login': (req, res, body) => {
    const ip = clientIp(req);
    if (tooManyFails(ip)) return sendJson(res, 429, { error: 'For mange feil forsøk. Vent litt og prøv igjen.' });
    const key = normalizeName(String(body.name || ''));
    const p = state.participants.find((x) => normalizeName(x.name) === key);
    if (p && !p.pass) {
      return sendJson(res, 400, { error: 'Denne profilen har ikke passord ennå. Logg inn med kode fra enheten du registrerte deg på, eller be spillmesteren sette et passord for deg.' });
    }
    if (!p || !verifyPassword(p, body.password)) {
      registerFail(ip);
      // Litt forsinkelse gjør det upraktisk å gjette passord
      return setTimeout(() => sendJson(res, 400, { error: 'Feil navn eller passord.' }), 600);
    }
    loginFails.delete(ip);
    sendJson(res, 200, { me: meView(p) }, { 'Set-Cookie': sessionCookie(p.token) });
  },

  'POST /api/logout': (req, res) => {
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'pils_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
  },

  // Sett eller bytt passord. Har man passord fra før, må man oppgi det.
  'POST /api/password': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må være logget inn.' });
    if (p.pass && !verifyPassword(p, body.current)) return sendJson(res, 400, { error: 'Det nåværende passordet er feil.' });
    p.pass = hashPassword(parseNewPassword(body.password));
    saveState();
    sendJson(res, 200, { me: meView(p) });
  },

  'POST /api/admin/set-password': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    const p = findParticipant(String(body.name || ''));
    if (!p) return sendJson(res, 404, { error: 'Fant ikke deltakeren.' });
    p.pass = hashPassword(parseNewPassword(body.newPassword));
    saveState();
    notify(p.name, '🔑', 'Spillmesteren har satt et nytt passord på profilen din.', { url: '/' });
    sendJson(res, 200, { ok: true, name: p.name });
  },

  'POST /api/device-login': (req, res, body) => {
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const entry = deviceCodes.get(code);
    if (!entry || entry.expires < Date.now()) {
      // Litt forsinkelse gjør det upraktisk å gjette koder
      return setTimeout(() => sendJson(res, 400, { error: 'Ugyldig eller utløpt kode. Lag en ny på enheten du allerede er logget inn på.' }), 800);
    }
    deviceCodes.delete(code); // kan bare brukes én gang
    const p = state.participants.find((x) => x.token === entry.token);
    if (!p) return sendJson(res, 400, { error: 'Fant ikke profilen.' });
    sendJson(res, 200, { me: meView(p) }, { 'Set-Cookie': sessionCookie(p.token) });
  },

  'POST /api/spin': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    payForSpin(p, 'spin', { wheel: true });

    const roll = crypto.randomInt(1_000_000);
    const win = roll < SPIN_WIN_CHANCE * 1_000_000;
    // Lite felt som tar et ekstra spinn (bare hvis man har et å miste)
    const lose = !win && roll < (SPIN_WIN_CHANCE + SPIN_LOSE_CHANCE) * 1_000_000;
    const cashUpTo = SPIN_WIN_CHANCE + SPIN_LOSE_CHANCE + SPIN_CASH_CHANCE;
    const cash = !win && !lose && roll < cashUpTo * 1_000_000 ? SPIN_CASH_PRIZE : 0;
    const bonus = !win && !lose && !cash && roll < (cashUpTo + SPIN_BONUS_CHANCE) * 1_000_000;
    p.spins.push(win);
    if (cash) {
      addFlus(p, cash);
      addActivity(p.name, '🎡', `vant ${cash} cash på lykkehjulet 💰`);
    }
    if (bonus) addSpins(p, 1);
    if (win) {
      addActivity(p.name, '🎡', 'vant en pils på lykkehjulet! 🍺');
      announceBeer(p.name, `🍺 ${p.name} vant en pils på lykkehjulet!`, 5500);
    }
    const lostSpin = lose && spinsLeft(p) > 0;
    if (lostSpin) addSpins(p, -1);
    saveState();
    sendJson(res, 200, { win, lose, lostSpin, cash, bonus, me: meView(p) });
  },

  // Kjøp en pakke med spinn til lykkehjulet
  'POST /api/spins/buy': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const pack = SPIN_PACKS.find((x) => x.n === Number(body.n));
    if (!pack) throw new Error('Ukjent pakke.');
    if ((p.flus || 0) < pack.price) throw new Error(`${pack.n} spinn koster ${pack.price} cash, men du har bare ${p.flus || 0}.`);
    addFlus(p, -pack.price);
    addSpins(p, pack.n);
    p.boughtSpins = (p.boughtSpins || 0) + pack.n;
    saveState();
    sendJson(res, 200, { bought: pack.n, me: meView(p) });
  },

  'POST /api/game/start': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const gameId = crypto.randomBytes(16).toString('hex');
    // Kun ett aktivt spill per person om gangen
    for (const [id, g] of games) if (g.token === p.token) games.delete(id);
    games.set(gameId, { token: p.token, start: Date.now() });
    sendJson(res, 200, { gameId });
  },

  'POST /api/game/end': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const game = games.get(String(body.gameId || ''));
    if (!game || game.token !== p.token) return sendJson(res, 400, { error: 'Ukjent spill. Prøv igjen.' });
    games.delete(String(body.gameId));

    const score = Math.floor(Number(body.score));
    if (!Number.isFinite(score) || score < 0) return sendJson(res, 400, { error: 'Ugyldig poengsum.' });
    // Rørene kommer med fast takt, så poengsummen kan ikke være høyere enn tiden tillater.
    const maxPossible = Math.floor((Date.now() - game.start) / GAME_PIPE_INTERVAL_MS) + 1;
    if (score > maxPossible) return sendJson(res, 400, { error: 'Den poengsummen ser litt mistenkelig ut 🤨' });

    const isRecord = score > (p.bestScore || 0);
    if (isRecord) p.bestScore = score;

    const reached = milestonesFor(p.bestScore || 0);
    let earned = 0;
    for (let k = (p.milestones || 0) + 1; k <= reached; k++) earned += k;
    p.milestones = Math.max(p.milestones || 0, reached);
    p.bonusSpins = (p.bonusSpins || 0) + earned;
    if (isRecord && score >= 5) {
      addActivity(p.name, '🕊️', `satte ny rekord i Flappy Sjef: ${score} poeng${earned ? ` (+${earned} spinn)` : ''}`);
    }
    if (isRecord || earned) saveState();

    sendJson(res, 200, { score, isRecord, earnedSpins: earned, me: meView(p), leaderboard: leaderboard() });
  },

  'GET /api/duels': (req, res) => {
    const p = currentParticipant(req);
    const mine = p ? state.duels.filter((d) => d.challenger === p.name || d.opponent === p.name) : [];
    sendJson(res, 200, {
      me: meView(p),
      opponents: state.participants.filter((o) => !p || o.name !== p.name).map((o) => o.name),
      incoming: mine.filter((d) => d.status === 'pending' && d.opponent === p.name).map((d) => duelView(d, p)),
      outgoing: mine.filter((d) => d.status === 'pending' && d.challenger === p.name).map((d) => duelView(d, p)),
      history: mine.filter((d) => d.status !== 'pending').slice(-10).reverse().map((d) => duelView(d, p)),
      feed: state.duels.filter((d) => d.status === 'done').slice(-10).reverse().map((d) => duelView(d, null)),
    });
  },

  // ---------- Arena ----------
  'GET /api/arena': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const mine = state.arena.filter((a) => a.challenger === p.name || a.opponent === p.name);
    sendJson(res, 200, {
      me: meView(p),
      games: ARENA_GAMES,
      stakes: ARENA_STAKES,
      incoming: mine.filter((a) => a.status === 'pending' && a.opponent === p.name).map((a) => arenaView(a, p)),
      outgoing: mine.filter((a) => a.status === 'pending' && a.challenger === p.name).map((a) => arenaView(a, p)),
      recent: state.arena.filter((a) => a.status === 'done').slice(-15).reverse().map((a) => arenaView(a, p)),
      people: state.participants.filter((x) => x.name !== p.name).map((x) => ({ name: x.name, avatar: x.avatar || null })),
      avatars: avatars(),
    });
  },

  // Start et spill (reaksjon/hoderegning): serveren noterer starttiden og lager oppgavene
  'POST /api/arena/start': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const game = String(body.game || '');
    if (!['reaction', 'math'].includes(game)) return sendJson(res, 400, { error: 'Ukjent spill.' });
    const id = crypto.randomBytes(8).toString('hex');
    const sess = { name: p.name, game, startAt: Date.now() };
    if (game === 'math') sess.questions = newMathQuestions();
    arenaSessions.set(id, sess);
    // Rydd bort gamle økter
    for (const [k, v] of arenaSessions) if (Date.now() - v.startAt > 15 * 60 * 1000) arenaSessions.delete(k);
    sendJson(res, 200, { sessionId: id, questions: sess.questions ? sess.questions.map((q) => q.q) : null });
  },

  'POST /api/arena/challenge': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const game = String(body.game || '');
    if (!ARENA_GAMES[game]) return sendJson(res, 400, { error: 'Ukjent spill.' });
    const opponent = findParticipant(String(body.opponent || ''));
    if (!opponent) return sendJson(res, 400, { error: 'Velg en motstander.' });
    if (opponent.name === p.name) return sendJson(res, 400, { error: 'Du kan ikke utfordre deg selv 😅' });
    const type = String(body.stakeType || '');
    const st = ARENA_STAKES[type];
    if (!st) return sendJson(res, 400, { error: 'Velg hva dere spiller om.' });
    const stake = Math.floor(Number(body.stake));
    if (!Number.isFinite(stake) || stake < st.min || stake > st.max) return sendJson(res, 400, { error: `Innsatsen må være ${st.min}–${st.max} ${st.label}.` });
    if (stakeBalance(p, type) < stake) return sendJson(res, 400, { error: `Du har bare ${stakeBalance(p, type)} ${st.label}.` });
    const open = state.arena.filter((a) => a.status === 'pending' && a.challenger === p.name).length;
    if (open >= MAX_OPEN_ARENA) return sendJson(res, 400, { error: `Du kan ha maks ${MAX_OPEN_ARENA} åpne utfordringer i arenaen.` });
    const r = arenaScore(p, game, body);
    moveStake(p, type, -stake); // holdes av til utfordringen er ferdig
    const a = {
      id: crypto.randomBytes(8).toString('hex'),
      game,
      challenger: p.name,
      opponent: opponent.name,
      stakeType: type,
      stake,
      cScore: r.score,
      cDetail: r.detail,
      status: 'pending',
      at: Date.now(),
    };
    state.arena.push(a);
    notify(opponent.name, ARENA_GAMES[game].icon, `${p.name} utfordret deg til ${ARENA_GAMES[game].name.toLowerCase()} om ${stakeWord(type, stake)}!`, { url: `/pvp.html#${{ dice: 'terninger', reaction: 'reaksjon', math: 'hoderegning' }[a ? a.game : game]}`, from: p.name });
    saveState();
    broadcast('arena', { to: opponent.name });
    sendJson(res, 200, { challenge: arenaView(a, p), me: meView(p) });
  },

  'POST /api/arena/respond': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const a = state.arena.find((x) => x.id === body.id && x.status === 'pending' && x.opponent === p.name);
    if (!a) return sendJson(res, 400, { error: 'Fant ikke utfordringen. Kanskje den er trukket tilbake?' });
    const challenger = findParticipant(a.challenger);
    const word = stakeWord(a.stakeType, a.stake);
    if (body.decline) {
      a.status = 'declined';
      if (challenger) moveStake(challenger, a.stakeType, a.stake);
      notify(a.challenger, '🙅', `${p.name} takket nei til ${ARENA_GAMES[a.game].name.toLowerCase()}. Du fikk ${word} tilbake.`, { url: `/pvp.html#${{ dice: 'terninger', reaction: 'reaksjon', math: 'hoderegning' }[a ? a.game : game]}`, from: p.name });
      saveState();
      broadcast('arena', { to: a.challenger });
      return sendJson(res, 200, { me: meView(p) });
    }
    if (stakeBalance(p, a.stakeType) < a.stake) return sendJson(res, 400, { error: `Du trenger ${word} for å godta, men har bare ${stakeBalance(p, a.stakeType)}.` });
    const r = arenaScore(p, a.game, body);
    a.oScore = r.score;
    a.oDetail = r.detail;
    a.status = 'done';
    a.doneAt = Date.now();
    if (a.cScore === a.oScore) {
      a.winner = null;
      if (challenger) moveStake(challenger, a.stakeType, a.stake);
    } else if (a.cScore > a.oScore) {
      a.winner = a.challenger;
      moveStake(p, a.stakeType, -a.stake);
      if (challenger) moveStake(challenger, a.stakeType, a.stake * 2);
    } else {
      a.winner = p.name;
      moveStake(p, a.stakeType, a.stake); // utfordrerens innsats er allerede trukket
    }
    const g = ARENA_GAMES[a.game];
    if (a.winner) {
      const loser = a.winner === p.name ? a.challenger : p.name;
      addActivity(a.winner, g.icon, `slo ${loser} i ${g.name.toLowerCase()} og vant ${word}`);
      if (a.stakeType === 'beer') announceBeer(a.winner, `🍺 ${a.winner} vant ${a.stake} pils fra ${loser} i ${g.name.toLowerCase()}!`);
    }
    const resultFor = (name) => (a.winner === null ? `Uavgjort! Innsatsen er betalt tilbake.` : a.winner === name ? `Du vant ${word}! 🎉` : `Du tapte ${word}.`);
    notify(a.challenger, g.icon, `${p.name} svarte på ${g.name.toLowerCase()}: ${a.cDetail} mot ${a.oDetail}. ${resultFor(a.challenger)}`, { url: `/pvp.html#${{ dice: 'terninger', reaction: 'reaksjon', math: 'hoderegning' }[a ? a.game : game]}`, from: p.name });
    saveState();
    broadcast('arena', { to: a.challenger });
    sendJson(res, 200, { challenge: arenaView(a, p), result: resultFor(p.name), won: a.winner === p.name, tie: a.winner === null, me: meView(p) });
  },

  'POST /api/arena/cancel': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const a = state.arena.find((x) => x.id === body.id && x.status === 'pending' && x.challenger === p.name);
    if (!a) return sendJson(res, 400, { error: 'Fant ikke utfordringen.' });
    a.status = 'cancelled';
    moveStake(p, a.stakeType, a.stake);
    saveState();
    broadcast('arena', { to: a.opponent });
    sendJson(res, 200, { me: meView(p) });
  },

  'POST /api/duel/challenge': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const opponent = findParticipant(String(body.opponent || ''));
    if (!opponent) return sendJson(res, 400, { error: 'Fant ikke motstanderen.' });
    if (opponent.name === p.name) return sendJson(res, 400, { error: 'Du kan ikke utfordre deg selv 😅' });
    const stake = Math.floor(Number(body.stake));
    if (!Number.isFinite(stake) || stake < 1) return sendJson(res, 400, { error: 'Innsatsen må være minst 1 spinn.' });
    if (stake > spinsLeft(p)) return sendJson(res, 400, { error: `Du har bare ${spinsLeft(p)} spinn å satse.` });
    if (!MOVES.includes(body.move)) return sendJson(res, 400, { error: 'Velg stein, saks eller papir.' });
    const open = state.duels.filter((d) => d.status === 'pending' && d.challenger === p.name).length;
    if (open >= MAX_OPEN_DUELS) return sendJson(res, 400, { error: `Du kan ha maks ${MAX_OPEN_DUELS} åpne utfordringer.` });

    addSpins(p, -stake); // innsatsen holdes av til duellen er ferdig
    const duel = {
      id: crypto.randomBytes(8).toString('hex'),
      challenger: p.name,
      opponent: opponent.name,
      stake,
      challengerMove: body.move,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    state.duels.push(duel);
    notify(opponent.name, '⚔️', `${p.name} utfordret deg til stein, saks, papir om ${stake} spinn!`, { url: '/pvp.html#duell', from: p.name });
    saveState();
    sendJson(res, 200, { duel: duelView(duel, p), me: meView(p) });
  },

  'POST /api/duel/respond': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const d = state.duels.find((x) => x.id === body.duelId && x.status === 'pending' && x.opponent === p.name);
    if (!d) return sendJson(res, 400, { error: 'Fant ikke utfordringen. Kanskje den er trukket tilbake?' });
    const challenger = findParticipant(d.challenger);

    if (body.decline) {
      d.status = 'declined';
      d.finishedAt = new Date().toISOString();
      if (challenger) addSpins(challenger, d.stake);
      notify(d.challenger, '🙅', `${p.name} takket nei til duellen. Du fikk ${d.stake} spinn tilbake.`, { url: '/pvp.html#duell', from: p.name });
      saveState();
      return sendJson(res, 200, { duel: duelView(d, p), me: meView(p) });
    }

    if (!MOVES.includes(body.move)) return sendJson(res, 400, { error: 'Velg stein, saks eller papir.' });
    if (d.stake > spinsLeft(p)) return sendJson(res, 400, { error: `Du trenger ${d.stake} spinn for å godta, men har bare ${spinsLeft(p)}.` });

    d.opponentMove = body.move;
    d.status = 'done';
    d.finishedAt = new Date().toISOString();
    if (d.challengerMove === d.opponentMove) {
      d.winner = null; // uavgjort: utfordreren får innsatsen tilbake, motstanderen satser ingenting
      if (challenger) addSpins(challenger, d.stake);
    } else if (BEATS[d.challengerMove] === d.opponentMove) {
      d.winner = d.challenger;
      addSpins(p, -d.stake);
      if (challenger) addSpins(challenger, d.stake * 2);
    } else {
      d.winner = p.name;
      addSpins(p, d.stake); // utfordrerens innsats er allerede trukket
    }
    const MOVE_EMOJI = { stein: '✊', saks: '✌️', papir: '✋' };
    const duelText = (name) => {
      const other = name === d.challenger ? d.opponent : d.challenger;
      const mine = MOVE_EMOJI[name === d.challenger ? d.challengerMove : d.opponentMove];
      const theirs = MOVE_EMOJI[name === d.challenger ? d.opponentMove : d.challengerMove];
      if (!d.winner) return `${mine} mot ${theirs}: uavgjort mot ${other} i stein, saks, papir`;
      return d.winner === name
        ? `${mine} slo ${theirs}: vant ${d.stake} spinn fra ${other} i stein, saks, papir`
        : `${mine} tapte mot ${theirs}: ${other} vant ${d.stake} spinn`;
    };
    addActivity(d.challenger, '⚔️', duelText(d.challenger));
    notify(d.challenger, '⚔️', `${p.name} svarte på duellen: ${duelText(d.challenger)}`, { url: '/pvp.html#duell', from: p.name });
    addActivity(d.opponent, '⚔️', duelText(d.opponent));
    saveState();
    sendJson(res, 200, { duel: duelView(d, p), me: meView(p) });
  },

  'POST /api/duel/cancel': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const d = state.duels.find((x) => x.id === body.duelId && x.status === 'pending' && x.challenger === p.name);
    if (!d) return sendJson(res, 400, { error: 'Fant ikke utfordringen.' });
    d.status = 'cancelled';
    d.finishedAt = new Date().toISOString();
    addSpins(p, d.stake);
    saveState();
    sendJson(res, 200, { me: meView(p) });
  },

  'POST /api/avatar': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const url = saveImage(body.avatar, 'avatars');
    deleteImage(p.avatar);
    p.avatar = url;
    saveState();
    broadcast('avatars', avatars());
    sendJson(res, 200, { me: meView(p) });
  },

  // ---- Live ----
  'GET /api/events': (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  },

  // ---- Chat ----
  'GET /api/chat': (req, res) => {
    sendJson(res, 200, { me: meView(currentParticipant(req)), messages: state.chat.slice(-100).map(chatView) });
  },

  'POST /api/chat': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const text = String(body.text || '').trim().slice(0, 500);
    if (!text) return sendJson(res, 400, { error: 'Meldingen er tom.' });
    const now = Date.now();
    if (p.lastChatAt && now - p.lastChatAt < 400) return sendJson(res, 429, { error: 'Rolig nå, ikke så fort 😄' });
    p.lastChatAt = now;
    const msg = { id: crypto.randomBytes(8).toString('hex'), name: p.name, text, at: now };
    state.chat.push(msg);
    if (state.chat.length > CHAT_HISTORY) state.chat = state.chat.slice(-CHAT_HISTORY);
    saveState();
    broadcast('chat', chatView(msg));
    sendJson(res, 200, { message: chatView(msg) });
  },

  // ---- Story ----
  'GET /api/stories': (req, res) => {
    sendJson(res, 200, { me: meView(currentParticipant(req)), groups: storyGroups() });
  },

  'POST /api/stories': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    pruneStories();
    if (state.stories.filter((s) => s.name === p.name).length >= MAX_STORIES_PER_PERSON) {
      return sendJson(res, 400, { error: `Du kan ha maks ${MAX_STORIES_PER_PERSON} bilder i storyen din.` });
    }
    const story = {
      id: crypto.randomBytes(8).toString('hex'),
      name: p.name,
      url: saveImage(body.image, 'stories'),
      caption: String(body.caption || '').trim().slice(0, 150),
      at: Date.now(),
    };
    state.stories.push(story);
    addActivity(p.name, '📸', story.caption ? `la ut en story: «${story.caption}»` : 'la ut en story', { url: story.url, story: story.id });
    saveState();
    broadcast('stories', {});
    sendJson(res, 200, { ok: true });
  },

  'POST /api/stories/delete': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const s = state.stories.find((x) => x.id === body.id && x.name === p.name);
    if (!s) return sendJson(res, 404, { error: 'Fant ikke bildet.' });
    deleteImage(s.url);
    state.stories = state.stories.filter((x) => x !== s);
    saveState();
    broadcast('stories', {});
    sendJson(res, 200, { ok: true });
  },

  'POST /api/admin/story-delete': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    const s = state.stories.find((x) => x.id === body.id);
    if (s) {
      deleteImage(s.url);
      state.stories = state.stories.filter((x) => x !== s);
      saveState();
      broadcast('stories', {});
    }
    sendJson(res, 200, { ok: true });
  },

  'POST /api/admin/chat-delete': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    state.chat = body.all ? [] : state.chat.filter((m) => m.id !== body.id);
    saveState();
    broadcast('chat-reload', {});
    sendJson(res, 200, { ok: true });
  },

  // ---- Mogg-off ----
  'GET /api/mogg': (req, res) => {
    const p = currentParticipant(req);
    const mine = p ? state.moggs.filter((m) => m.challenger === p.name || m.opponent === p.name) : [];
    sendJson(res, 200, {
      me: meView(p),
      avatars: avatars(),
      opponents: state.participants.filter((o) => !p || o.name !== p.name).map((o) => o.name),
      incoming: mine.filter((m) => m.status === 'pending' && m.opponent === p.name).map((m) => moggView(m, p)),
      outgoing: mine.filter((m) => m.status === 'pending' && m.challenger === p.name).map((m) => moggView(m, p)),
      feed: state.moggs.filter((m) => m.status === 'done').slice(-10).reverse().map((m) => moggView(m, null)),
      podium: moggPodium(),
    });
  },

  'POST /api/mogg/challenge': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const opponent = findParticipant(String(body.opponent || ''));
    if (!opponent) return sendJson(res, 400, { error: 'Fant ikke motstanderen.' });
    if (opponent.name === p.name) return sendJson(res, 400, { error: 'Du kan ikke mogge deg selv 🗿' });
    if (spinsLeft(p) < 1) return sendJson(res, 400, { error: 'Du trenger minst 1 spinn for å utfordre.' });
    const open = state.moggs.filter((m) => m.status === 'pending' && m.challenger === p.name).length;
    if (open >= MAX_OPEN_DUELS) return sendJson(res, 400, { error: `Du kan ha maks ${MAX_OPEN_DUELS} åpne utfordringer.` });
    const score = parseMoggScore(body.score);
    const parts = parseMoggParts(body.parts);
    const url = saveImage(body.image, 'mogg');

    addSpins(p, -1); // innsatsen holdes av til duellen er ferdig
    const m = {
      id: crypto.randomBytes(8).toString('hex'),
      challenger: p.name,
      opponent: opponent.name,
      challengerUrl: url,
      challengerScore: score,
      challengerParts: parts,
      status: 'pending',
      at: Date.now(),
    };
    state.moggs.push(m);
    notify(opponent.name, '🗿', `${p.name} utfordret deg til mogg-off!`, { url: '/pvp.html#mogg', from: p.name });
    recordMoggBest(p.name, url, score);
    saveState();
    sendJson(res, 200, { mogg: moggView(m, p), me: meView(p) });
  },

  'POST /api/mogg/respond': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const m = state.moggs.find((x) => x.id === body.id && x.status === 'pending' && x.opponent === p.name);
    if (!m) return sendJson(res, 400, { error: 'Fant ikke utfordringen. Kanskje den er trukket tilbake?' });
    const challenger = findParticipant(m.challenger);

    if (body.decline) {
      m.status = 'declined';
      if (challenger) addSpins(challenger, 1);
      notify(m.challenger, '🙅', `${p.name} takket nei til mogg-off. Du fikk spinnet tilbake.`, { url: '/pvp.html#mogg', from: p.name });
      saveState();
      return sendJson(res, 200, { mogg: moggView(m, p), me: meView(p) });
    }

    if (spinsLeft(p) < 1) return sendJson(res, 400, { error: 'Du trenger minst 1 spinn for å godta.' });
    const score = parseMoggScore(body.score);
    const parts = parseMoggParts(body.parts);
    m.opponentUrl = saveImage(body.image, 'mogg');
    m.opponentScore = score;
    m.opponentParts = parts;
    m.status = 'done';
    m.finishedAt = Date.now();
    if (m.challengerScore === score) {
      m.winner = null; // uavgjort: utfordreren får innsatsen tilbake
      if (challenger) addSpins(challenger, 1);
    } else if (m.challengerScore > score) {
      m.winner = m.challenger;
      addSpins(p, -1);
      if (challenger) addSpins(challenger, 2);
    } else {
      m.winner = p.name;
      addSpins(p, 1);
    }
    recordMoggBest(p.name, m.opponentUrl, score);
    addActivity(m.challenger, '🗿', moggText(m, m.challenger), { url: m.challengerUrl });
    notify(m.challenger, '🗿', `${p.name} svarte på mogg-off: ${m.winner ? 'du ' : ''}${moggText(m, m.challenger)}`, { url: '/pvp.html#mogg', from: p.name });
    addActivity(m.opponent, '🗿', moggText(m, m.opponent), { url: m.opponentUrl });
    saveState();
    sendJson(res, 200, { mogg: moggView(m, p), me: meView(p) });
  },

  'POST /api/mogg/cancel': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const m = state.moggs.find((x) => x.id === body.id && x.status === 'pending' && x.challenger === p.name);
    if (!m) return sendJson(res, 400, { error: 'Fant ikke utfordringen.' });
    m.status = 'cancelled';
    addSpins(p, 1);
    saveState();
    sendJson(res, 200, { me: meView(p) });
  },

  'POST /api/admin/mogg-remove': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    delete state.moggBest[String(body.name || '')];
    saveState();
    sendJson(res, 200, { ok: true });
  },

  // ---- Oppgaver ----
  'GET /api/tasks': (req, res) => {
    const p = currentParticipant(req);
    sendJson(res, 200, { me: meView(p), tasks: state.tasks.map((t) => taskView(t, p)) });
  },

  'GET /api/tasks/people': (req, res) => {
    sendJson(res, 200, { people: state.participants.map((p) => ({ name: p.name, avatar: p.avatar || null })) });
  },

  'POST /api/tasks/submit': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const t = state.tasks.find((x) => x.id === body.id);
    if (!t) return sendJson(res, 404, { error: 'Fant ikke oppgaven.' });
    const cat = t.cat || 'first';
    if (cat === 'first') {
      if (t.status === 'done') return sendJson(res, 400, { error: `Oppgaven er allerede løst av ${currentAttempt(t).name}.` });
      if (t.status === 'pending') return sendJson(res, 400, { error: `${currentAttempt(t).name} har allerede levert denne og venter på godkjenning.` });
    } else {
      const mine = activeAttemptFor(t, p.name);
      if (mine) return sendJson(res, 400, { error: mine.status === 'approved' ? 'Du har allerede klart denne oppgaven.' : 'Du er allerede med på en innlevering av denne som venter på godkjenning.' });
    }
    const pending = taskQueue().filter((x) => x.name === p.name).length;
    if (pending >= MAX_PENDING_TASKS) return sendJson(res, 400, { error: `Du kan ha maks ${MAX_PENDING_TASKS} oppgaver som venter på godkjenning om gangen.` });

    // Duo og hele gjengen: hvem var med?
    let withNames = [];
    if (cat === 'duo' || cat === 'gang') {
      const raw = Array.isArray(body.with) ? body.with : [];
      for (const n of raw) {
        const other = findParticipant(String(n));
        if (!other) return sendJson(res, 400, { error: `Fant ikke ${String(n).slice(0, 40)}.` });
        if (other.name === p.name) return sendJson(res, 400, { error: 'Du kan ikke velge deg selv.' });
        if (!withNames.includes(other.name)) withNames.push(other.name);
      }
      if (cat === 'duo' && withNames.length !== 1) return sendJson(res, 400, { error: 'Velg kollegaen du gjorde oppgaven sammen med 👯' });
      if (cat === 'gang' && withNames.length + 1 < (t.min || 4)) return sendJson(res, 400, { error: `Velg minst ${(t.min || 4) - 1} kollegaer som var med (dere må være minst ${t.min || 4}).` });
      if (withNames.length > 30) return sendJson(res, 400, { error: 'Det var mange! Maks 30 kollegaer.' });
      const busy = withNames.filter((n) => activeAttemptFor(t, n));
      if (busy.length) return sendJson(res, 400, { error: `${joinNames(busy)} har allerede gjort denne (eller venter på godkjenning).` });
    }

    const text = String(body.text || '').trim().slice(0, 500);
    if (t.proof === 'photo' && !body.image) return sendJson(res, 400, { error: 'Denne oppgaven krever et bilde som bevis 📸' });
    if (t.proof === 'text' && !text && !body.image) return sendJson(res, 400, { error: 'Skriv hva du gjorde som bevis.' });

    const url = body.image ? saveImage(body.image, 'tasks') : null;
    t.attempts.push({ id: crypto.randomBytes(5).toString('hex'), name: p.name, with: withNames, status: 'pending', text, url, at: Date.now() });
    if (cat === 'first') t.status = 'pending';
    withNames.forEach((n) => notify(n, '👯', `${p.name} leverte «${t.title}» med deg. Får den godkjent, får du også belønningen!`, { url: '/oppgaver.html', from: p.name }));
    saveState();
    broadcast('tasks', {});
    sendJson(res, 200, { task: taskView(t, p) });
  },

  'POST /api/tasks/withdraw': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const t = state.tasks.find((x) => x.id === body.id);
    const cur = t && t.attempts.find((a) => a.status === 'pending' && a.name === p.name);
    if (!cur) return sendJson(res, 400, { error: 'Fant ikke innleveringen din.' });
    deleteImage(cur.url);
    t.attempts = t.attempts.filter((a) => a !== cur);
    if ((t.cat || 'first') === 'first') t.status = 'open';
    saveState();
    broadcast('tasks', {});
    sendJson(res, 200, { ok: true });
  },

  'POST /api/admin/task-review': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    const t = state.tasks.find((x) => x.id === body.id);
    const cur = t && (body.attempt ? t.attempts.find((a) => a.id === body.attempt) : t.attempts.find((a) => a.status === 'pending'));
    if (!cur || cur.status !== 'pending') return sendJson(res, 400, { error: 'Fant ikke innleveringen.' });
    const first = (t.cat || 'first') === 'first';
    const people = taskPeople(cur).filter((n) => findParticipant(n));
    const what = TASK_CAT_LABEL[t.cat] || '';
    const together = (n) => (cur.with && cur.with.length ? ` sammen med ${joinNames(people.filter((x) => x !== n))}` : '');
    cur.reviewedAt = Date.now();
    if (body.approve) {
      cur.status = 'approved';
      if (first) t.status = 'done';
      if (t.beer) {
        people.forEach((n) => {
          const p = findParticipant(n);
          p.taskBeers = (p.taskBeers || 0) + t.beer;
          notify(n, '🍺', `Spillmesteren godkjente «${t.title}»! Du vant en pils til gode. Løs den inn i baren 🍻`, { url: '/baren.html' });
        });
        addActivity(cur.name, '🍺', `${people.length > 1 ? `og ${joinNames(people.slice(1))} ` : ''}klarte den vanskelige oppgaven «${t.title}» og vant ${people.length > 1 ? 'en pils hver' : 'en pils'}! 🍺`, { url: cur.url });
        announceBeer(cur.name, `🍺 ${joinNames(people)} vant pils på oppgaven «${t.title}»!`);
      } else {
        people.forEach((n) => {
          const p = findParticipant(n);
          addSpins(p, t.reward);
          addFlus(p, taskCash(t));
          notify(n, '✅', `Spillmesteren godkjente «${t.title}»${together(n)}! Du fikk ${t.reward} spinn 🎰 og ${taskCash(t)} cash 💰`, { url: '/oppgaver.html' });
        });
        const each = people.length > 1 ? ' hver' : '';
        addActivity(cur.name, people.length > 1 ? (t.cat === 'gang' ? '🎉' : '👯') : '🎯', `${people.length > 1 ? `og ${joinNames(people.slice(1))} ` : ''}fullførte ${what}«${t.title}» og fikk ${t.reward} spinn og ${taskCash(t)} cash${each}`, { url: cur.url });
      }
    } else {
      cur.status = 'rejected';
      cur.reason = String(body.reason || '').trim().slice(0, 200);
      people.forEach((n) => notify(n, '❌', `«${t.title}» ble ikke godkjent${cur.reason ? `: ${cur.reason}` : ''}. ${first ? 'Oppgaven er åpen igjen.' : 'Dere kan prøve igjen.'}`, { url: '/oppgaver.html' }));
      deleteImage(cur.url);
      cur.url = null;
      // Førstemann til mølla: oppgaven blir åpen for alle igjen
      if (first) t.status = 'open';
    }
    saveState();
    broadcast('tasks', {});
    sendJson(res, 200, { ok: true });
  },

  // Innleveringer som venter på godkjenning (til 🎯-boblen)
  'POST /api/admin/task-queue': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    sendJson(res, 200, { pending: taskQueue() });
  },

  'POST /api/admin/task-add': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    const title = String(body.title || '').trim();
    if (title.length < 3) return sendJson(res, 400, { error: 'Oppgaven trenger en tittel.' });
    state.tasks.push(newTask({ ...body, title }));
    saveState();
    broadcast('tasks', {});
    sendJson(res, 200, { ok: true });
  },

  // Rediger en oppgave (tittel, beskrivelse, belønning, bevis, pils). Kan også åpne den igjen.
  'POST /api/admin/task-edit': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    const t = state.tasks.find((x) => x.id === body.id);
    if (!t) return sendJson(res, 404, { error: 'Fant ikke oppgaven.' });
    const title = String(body.title ?? t.title).trim();
    if (title.length < 3) return sendJson(res, 400, { error: 'Oppgaven trenger en tittel (minst 3 tegn).' });
    // Samme regler som en ny oppgave, men id, status og innleveringer beholdes
    const fresh = newTask({
      title,
      desc: body.desc ?? t.desc,
      reward: body.reward ?? t.reward,
      proof: body.proof ?? t.proof,
      beer: body.beer ?? t.beer,
      cat: body.cat ?? t.cat,
      min: body.min ?? t.min,
    });
    // Kategorien kan ikke byttes til/fra «førstemann» mens noen venter på godkjenning
    if (fresh.cat !== (t.cat || 'first') && t.attempts.some((a) => a.status === 'pending')) {
      return sendJson(res, 400, { error: 'Godkjenn eller avvis innleveringene først, så kan du bytte kategori.' });
    }
    if (fresh.cat !== 'first') t.status = 'open';
    else if (t.cat !== 'first') t.status = t.attempts.some((a) => a.status === 'approved') ? 'done' : 'open';
    Object.assign(t, { cat: fresh.cat, min: fresh.min, title: fresh.title, desc: fresh.desc, reward: fresh.reward, proof: fresh.proof, beer: fresh.beer });
    // «Åpne igjen»: en løst oppgave blir ledig for alle (det som er gitt, beholdes)
    if (body.reopen && t.status === 'done') t.status = 'open';
    saveState();
    broadcast('tasks', {});
    sendJson(res, 200, { ok: true, task: adminTaskView(t) });
  },

  'POST /api/admin/task-delete': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    const t = state.tasks.find((x) => x.id === body.id);
    if (t) {
      t.attempts.forEach((a) => deleteImage(a.url));
      state.tasks = state.tasks.filter((x) => x !== t);
      saveState();
      broadcast('tasks', {});
    }
    sendJson(res, 200, { ok: true });
  },

  // ---- Kasino ----
  'GET /api/casino': (req, res) => {
    const p = currentParticipant(req);
    sendJson(res, 200, {
      me: meView(p),
      maxBet: CASINO_MAX_BET,
      minBet: CASINO_MIN_BET,
      spinPrice: SPIN_PRICE,
      spinPacks: SPIN_PACKS,
      wheelChance: SPIN_WIN_CHANCE,
      wheelLoseChance: SPIN_LOSE_CHANCE,
      wheelCashChance: SPIN_CASH_CHANCE,
      wheelBonusChance: SPIN_BONUS_CHANCE,
      wheelCashPrize: SPIN_CASH_PRIZE,
      slotTable: SLOT_RULES.map((r) => ({ id: r.id, combo: r.combo, label: r.label, flus: r.flus, beer: r.beer || 0, pLine: SLOT_ODDS.rules[r.id].line, pPull: SLOT_ODDS.rules[r.id].pull })),
      slotOdds: { anyWin: SLOT_ODDS.anyWin, avgCash: SLOT_ODDS.avgCash, lines: SLOT_LINES.length },
      log: state.casinoLog.slice(-10).reverse(),
      avatars: avatars(),
    });
  },

  // ---------- Felles blackjack-bord ----------
  'GET /api/bj': (req, res) => {
    const p = currentParticipant(req);
    sendJson(res, 200, { me: meView(p), table: tables.bj.view(p, avatars()) });
  },
  'POST /api/bj/sit': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    tables.bj.sit(p, body.seat);
    sendJson(res, 200, { me: meView(p), table: tables.bj.view(p, avatars()) });
  },
  'POST /api/bj/leave': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    tables.bj.leave(p);
    sendJson(res, 200, { me: meView(p), table: tables.bj.view(p, avatars()) });
  },
  'POST /api/bj/bet': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    tables.bj.bet(p, body.amount);
    sendJson(res, 200, { me: meView(p), table: tables.bj.view(p, avatars()) });
  },
  'POST /api/bj/act': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    tables.bj.act(p, String(body.action || ''));
    sendJson(res, 200, { me: meView(p), table: tables.bj.view(p, avatars()) });
  },

  // ---------- Felles roulette ----------
  'GET /api/roulette': (req, res) => {
    const p = currentParticipant(req);
    sendJson(res, 200, { me: meView(p), table: tables.roulette.view(p, avatars()) });
  },
  'POST /api/roulette/bet': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    tables.roulette.bet(p, String(body.type || ''), body.amount);
    sendJson(res, 200, { me: meView(p), table: tables.roulette.view(p, avatars()) });
  },
  'POST /api/roulette/clear': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    tables.roulette.clear(p);
    sendJson(res, 200, { me: meView(p), table: tables.roulette.view(p, avatars()) });
  },

  'POST /api/casino/slot': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    // Spinn er bare for lykkehjulet; automaten koster alltid cash
    payForSpin(p, 'flus');
    const r = pullSlot();
    if (r.flus) addFlus(p, r.flus);
    if (r.beer) p.slotBeers = (p.slotBeers || 0) + r.beer;
    logCasino(p, 'slot', {
      won: r.flus,
      beer: r.beer,
      net: r.flus - SPIN_PRICE,
      detail: r.lines.map((l) => l.combo).join(' + '),
    });
    saveState();
    sendJson(res, 200, { ...r, me: meView(p) });
  },

  'POST /api/admin/players': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    sendJson(res, 200, {
      players: state.participants
        .map((p) => ({ name: p.name, avatar: p.avatar || null, spinsLeft: spinsLeft(p) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'no')),
      log: state.spinLog.slice(-20).reverse(),
    });
  },

  'POST /api/admin/spins': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    const p = findParticipant(String(body.name || ''));
    if (!p) return sendJson(res, 404, { error: 'Fant ikke deltakeren.' });
    let delta = Math.trunc(Number(body.delta));
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 100) {
      return sendJson(res, 400, { error: 'Antall må være mellom −100 og 100 (og ikke 0).' });
    }
    // Kan ikke ta flere spinn enn personen har
    delta = Math.max(delta, -spinsLeft(p));
    if (delta === 0) return sendJson(res, 400, { error: `${p.name} har ingen spinn å ta.` });
    addSpins(p, delta);
    notify(p.name, delta > 0 ? '🎁' : '➖', delta > 0 ? `Spillmesteren ga deg ${delta} spinn! 🎰` : `Spillmesteren tok ${-delta} spinn fra deg`, { url: '/kasino.html#hjul' });
    state.spinLog.push({ name: p.name, delta, at: Date.now() });
    if (state.spinLog.length > 50) state.spinLog = state.spinLog.slice(-50);
    saveState();
    sendJson(res, 200, { name: p.name, delta, spinsLeft: spinsLeft(p) });
  },

  // ---- Poker ----
  'GET /api/poker': (req, res) => {
    const p = currentParticipant(req);
    sendJson(res, 200, { me: meView(p), table: poker.view(p, avatars()) });
  },

  'POST /api/poker/sit': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    poker.sit(p, Number(body.seat), body.buyIn);
    sendJson(res, 200, { me: meView(p), table: poker.view(p, avatars()) });
  },

  'POST /api/poker/leave': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    poker.leave(p);
    sendJson(res, 200, { me: meView(p), table: poker.view(p, avatars()) });
  },

  'POST /api/poker/action': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    poker.act(p, String(body.action || ''), body.amount);
    sendJson(res, 200, { me: meView(p), table: poker.view(p, avatars()) });
  },

  // ---- Baren ----
  'GET /api/bar': (req, res) => {
    const p = currentParticipant(req);
    sendJson(res, 200, {
      me: meView(p),
      maxPerOrder: MAX_PILS_PER_ORDER,
      won: p ? beersWon(p) : null,
      orders: p ? state.orders.filter((o) => o.name === p.name).slice(-10).reverse().map(orderView) : [],
    });
  },

  'POST /api/bar/order': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const qty = Math.floor(Number(body.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_PILS_PER_ORDER) {
      return sendJson(res, 400, { error: `Du kan bestille 1–${MAX_PILS_PER_ORDER} pils om gangen.` });
    }
    const pending = state.orders.filter((o) => o.name === p.name && o.status === 'pending').length;
    if (pending >= MAX_PENDING_ORDERS) return sendJson(res, 400, { error: 'Du har allerede bestillinger som venter. Vent til spillmesteren har levert!' });
    // Pils kan bare tas ut som gevinst (til gode), ikke kjøpes for flus
    if (body.pay === 'flus') return sendJson(res, 400, { error: 'Pils kan ikke kjøpes for cash. Vinn dem på lykkehjulet eller automaten!' });
    const pay = 'credit';
    const cost = 0;
    if (beersOwed(p) < qty) return sendJson(res, 400, { error: qty === 1 ? 'Du har ingen pils til gode.' : `Du har bare ${beersOwed(p)} pils til gode.` });
    const order = {
      id: crypto.randomBytes(6).toString('hex'),
      name: p.name,
      qty,
      pay,
      cost,
      note: String(body.note || '').trim().slice(0, 100),
      status: 'pending',
      at: Date.now(),
    };
    state.orders.push(order);
    saveState();
    broadcast('orders', {});
    sendJson(res, 200, { order: orderView(order), me: meView(p) });
  },

  'POST /api/bar/cancel': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const o = state.orders.find((x) => x.id === body.id && x.name === p.name && x.status === 'pending');
    if (!o) return sendJson(res, 400, { error: 'Fant ikke bestillingen.' });
    o.status = 'cancelled';
    o.doneAt = Date.now();
    if (o.pay === 'flus') addFlus(p, o.cost);
    saveState();
    broadcast('orders', {});
    sendJson(res, 200, { me: meView(p) });
  },

  'POST /api/admin/orders': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    const av = avatars();
    const withAvatar = (o) => ({ ...orderView(o), avatar: av[o.name] || null });
    sendJson(res, 200, {
      pending: state.orders.filter((o) => o.status === 'pending').map(withAvatar),
      recent: state.orders.filter((o) => o.status !== 'pending').slice(-10).reverse().map(withAvatar),
      budget: budgetView(),
    });
  },

  'POST /api/admin/budget': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    if (body.total !== undefined || body.price !== undefined) {
      const total = Math.round(Number(body.total ?? state.budget.total));
      const price = Math.round(Number(body.price ?? state.budget.price));
      if (!Number.isFinite(total) || total < 0 || total > 1_000_000) return sendJson(res, 400, { error: 'Ugyldig budsjett.' });
      if (!Number.isFinite(price) || price < 1 || price > 1000) return sendJson(res, 400, { error: 'Ugyldig pris per pils.' });
      state.budget.total = total;
      state.budget.price = price;
      saveState();
      broadcast('orders', {});
    }
    sendJson(res, 200, { budget: budgetView() });
  },

  'POST /api/admin/order-status': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    const o = state.orders.find((x) => x.id === body.id && x.status === 'pending');
    if (!o) return sendJson(res, 400, { error: 'Fant ikke bestillingen.' });
    if (body.status === 'delivered') {
      o.status = 'delivered';
      o.kr = o.qty * state.budget.price; // trekkes fra budsjettet
      notify(o.name, '🍺', `Spillmesteren har levert ${o.qty > 1 ? `${o.qty} pils` : 'pilsen'} din. Skål! 🍻`, { url: '/baren.html' });
    } else if (body.status === 'cancelled') {
      o.status = 'cancelled';
      const p = findParticipant(o.name);
      if (p && o.pay === 'flus') addFlus(p, o.cost); // pengene tilbake
      notify(o.name, '🚫', `Spillmesteren avbrøt bestillingen din${o.pay === 'flus' ? ` (${o.cost} cash er betalt tilbake)` : ' (pilsen er fortsatt til gode)'}`, { url: '/baren.html' });
    } else return sendJson(res, 400, { error: 'Ukjent status.' });
    o.doneAt = Date.now();
    saveState();
    broadcast('orders', {});
    sendJson(res, 200, { ok: true });
  },

  // ---- Profil ----
  'GET /api/profile': (req, res) => {
    const viewer = currentParticipant(req);
    const name = new URL(req.url, 'http://x').searchParams.get('navn') || (viewer && viewer.name);
    const p = name ? findParticipant(name) : null;
    if (!p) return sendJson(res, 404, { error: 'Fant ikke den personen.' });
    const acts = state.activity.filter((a) => a.name === p.name).slice().reverse();
    sendJson(res, 200, {
      viewer: viewer ? viewer.name : null,
      profile: {
        name: p.name,
        avatar: p.avatar || null,
        joinedAt: p.joinedAt,
        lastSeen: p.lastSeen || null,
        isAdmin: !!p.isAdmin,
        bio: p.bio || '',
        stats: profileStats(p),
        guestbook: guestbookView(p),
      },
      activity: acts.slice(0, 150).map((a) => activityView(a, viewer)),
      people: state.participants.map((x) => ({ name: x.name, avatar: x.avatar || null, isAdmin: !!x.isAdmin })),
    });
  },

  // Kort bio på egen profil
  'POST /api/profile/bio': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må være logget inn.' });
    p.bio = String(body.bio || '').replace(/\s+/g, ' ').trim().slice(0, MAX_BIO);
    saveState();
    sendJson(res, 200, { bio: p.bio });
  },

  // Hilsener (gjestebok) på en profil: andre kan skrive en kort kommentar
  'POST /api/profile/comment': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må være logget inn.' });
    const owner = findParticipant(String(body.navn || ''));
    if (!owner) return sendJson(res, 404, { error: 'Fant ikke den personen.' });
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) return sendJson(res, 400, { error: 'Hilsenen er tom.' });
    const now = Date.now();
    if (p.lastCommentAt && now - p.lastCommentAt < 1500) return sendJson(res, 429, { error: 'Rolig nå 😄' });
    p.lastCommentAt = now;
    owner.guestbook = owner.guestbook || [];
    owner.guestbook.push({ id: crypto.randomBytes(5).toString('hex'), from: p.name, text, at: now });
    if (owner.guestbook.length > MAX_GUESTBOOK) owner.guestbook = owner.guestbook.slice(-MAX_GUESTBOOK);
    if (owner.name !== p.name) {
      const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
      notify(owner.name, '💌', `${p.name} skrev en hilsen på profilen din: «${short}»`, { url: '/profil.html#hilsener', from: p.name });
    }
    saveState();
    broadcast('reactions', { name: owner.name });
    sendJson(res, 200, { guestbook: guestbookView(owner) });
  },

  // Slette en hilsen: den som skrev den, eieren av profilen, eller admin
  'POST /api/profile/comment-delete': (req, res, body) => {
    const p = currentParticipant(req);
    const owner = findParticipant(String(body.navn || ''));
    const c = owner && (owner.guestbook || []).find((x) => x.id === body.id);
    if (!c) return sendJson(res, 404, { error: 'Fant ikke hilsenen.' });
    const allowed = checkAdmin(body, req) || (p && (p.name === c.from || p.name === owner.name));
    if (!allowed) return sendJson(res, 403, { error: 'Du kan ikke slette denne.' });
    owner.guestbook = owner.guestbook.filter((x) => x !== c);
    saveState();
    broadcast('reactions', { name: owner.name });
    sendJson(res, 200, { guestbook: guestbookView(owner) });
  },

  'POST /api/react/like': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg for å like.' });
    const a = findActivity(String(body.id || ''));
    if (!a) return sendJson(res, 404, { error: 'Fant ikke innlegget.' });
    const r = (state.reactions[a.id] = state.reactions[a.id] || { likes: [], comments: [] });
    const i = r.likes.indexOf(p.name);
    if (i >= 0) r.likes.splice(i, 1);
    else {
      r.likes.push(p.name);
      if (a.name !== p.name) notify(a.name, '❤️', `${p.name} likte ${postWord(a)}`, { url: postUrl(a), from: p.name, key: `like:${a.id}:${p.name}` });
    }
    saveState();
    broadcast('reactions', { id: a.id, name: a.name });
    sendJson(res, 200, { activity: activityView(a, p) });
  },

  'POST /api/react/comment': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg for å kommentere.' });
    const a = findActivity(String(body.id || ''));
    if (!a) return sendJson(res, 404, { error: 'Fant ikke innlegget.' });
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) return sendJson(res, 400, { error: 'Kommentaren er tom.' });
    const now = Date.now();
    if (p.lastCommentAt && now - p.lastCommentAt < 1500) return sendJson(res, 429, { error: 'Rolig nå 😄' });
    p.lastCommentAt = now;
    const r = (state.reactions[a.id] = state.reactions[a.id] || { likes: [], comments: [] });
    // Varsle eieren, og andre som har kommentert på samme innlegg
    const others = [...new Set(r.comments.map((c) => c.name))].filter((n) => n !== p.name && n !== a.name);
    r.comments.push({ id: crypto.randomBytes(5).toString('hex'), name: p.name, text, at: now });
    if (r.comments.length > 100) r.comments = r.comments.slice(-100);
    const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
    if (a.name !== p.name) notify(a.name, '💬', `${p.name} kommenterte ${postWord(a)}: «${short}»`, { url: postUrl(a), from: p.name });
    others.forEach((n) => notify(n, '💬', a.name === p.name ? `${p.name} svarte på ${a.url ? 'bildet' : 'innlegget'} sitt: «${short}»` : `${p.name} kommenterte også på innlegget til ${a.name}: «${short}»`, { url: postUrl(a), from: p.name }));
    saveState();
    broadcast('reactions', { id: a.id, name: a.name });
    sendJson(res, 200, { activity: activityView(a, p) });
  },

  'POST /api/react/comment-delete': (req, res, body) => {
    const p = currentParticipant(req);
    const isAdmin = checkAdmin(body, req);
    const a = findActivity(String(body.id || ''));
    const r = a && state.reactions[a.id];
    const c = r && r.comments.find((x) => x.id === body.commentId);
    if (!c) return sendJson(res, 404, { error: 'Fant ikke kommentaren.' });
    if (!isAdmin && (!p || p.name !== c.name)) return sendJson(res, 403, { error: 'Du kan bare slette dine egne kommentarer.' });
    r.comments = r.comments.filter((x) => x !== c);
    saveState();
    broadcast('reactions', { id: a.id, name: a.name });
    sendJson(res, 200, { activity: activityView(a, p) });
  },

  // ---- Varsler ----
  'GET /api/notifications': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const notes = (p.notes || []).slice().reverse();
    const av = avatars();
    sendJson(res, 200, {
      name: p.name,
      unread: notes.filter((n) => !n.read).length,
      items: notes.map(({ key, ...n }) => ({ ...n, avatar: n.from ? av[n.from] || null : null })),
    });
  },

  'POST /api/notifications/read': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    (p.notes || []).forEach((n) => (n.read = true));
    saveState();
    sendJson(res, 200, { ok: true });
  },

  'GET /api/admin/me': (req, res) => {
    const p = currentParticipant(req);
    sendJson(res, 200, { admin: !!(p && p.isAdmin), name: p ? p.name : null });
  },

  'POST /api/admin/login': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    // Første innlogging med passord fra en enhet der man er registrert: koble admin til den profilen
    const me = currentParticipant(req);
    if (me && !me.isAdmin && checkPassword(body)) {
      me.isAdmin = true;
      addActivity(me.name, '👑', 'ble spillmester for kvelden');
      saveState();
    }
    sendJson(res, 200, {
      ok: true,
      participants: state.participants.map((p) => ({
        name: p.name,
        tickets: p.tickets,
        spinsUsed: p.spins.length,
        spinsAllowed: spinsAllowed(p),
        bestScore: p.bestScore || 0,
        flus: p.flus || 0,
        spinWins: wheelWins(p),
        avatar: p.avatar || null,
        hasPassword: !!p.pass,
      })),
      stories: (pruneStories(), state.stories.map((x) => ({ id: x.id, name: x.name, url: x.url, caption: x.caption, at: x.at }))),
      chat: state.chat.slice(-50).reverse(),
      moggPodium: moggPodium(),
      tasks: state.tasks.map(adminTaskView),
      taskQueue: taskQueue(),
      suggestions: state.suggestions.slice().reverse().map((x) => ({ ...x, kindLabel: SUGGESTION_KINDS[x.kind] || x.kind })),
    });
  },

  'POST /api/admin/draw': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    if (state.draw) return sendJson(res, 400, { error: 'Loddtrekningen er allerede gjennomført.' });

    const pool = DRAW_FROM === 'assigned'
      ? [...usedTickets()]
      : Array.from({ length: TOTAL_TICKETS }, (_, i) => i + 1);
    if (!pool.length) return sendJson(res, 400, { error: 'Ingen lodd å trekke blant ennå.' });
    state.draw = {
      drawnAt: new Date().toISOString(),
      winningTickets: pickRandom(pool, WINNING_TICKETS).sort((a, b) => a - b),
    };
    state.participants.forEach((p) => {
      const won = p.tickets.filter((t) => state.draw.winningTickets.includes(t));
      if (won.length) {
        addActivity(p.name, '🎟️', `vant ${won.length} pils i loddtrekningen (lodd ${won.map((t) => `#${t}`).join(', ')})`);
        announceBeer(p.name, `🍺 ${p.name} vant ${won.length > 1 ? `${won.length} pils` : 'en pils'} i loddtrekningen!`);
      }
    });
    saveState();
    sendJson(res, 200, { draw: publicDraw() });
  },

  'POST /api/admin/reset-draw': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    state.draw = null;
    saveState();
    sendJson(res, 200, { ok: true });
  },

  'POST /api/admin/reset-all': (req, res, body) => {
    if (!checkAdmin(body, req)) return sendJson(res, 403, { error: 'Feil passord.' });
    // Budsjettet er ekte penger og beholdes, men leveringene nullstilles med bestillingene
    const budget = { ...state.budget, total: budgetView().remaining };
    state = { ...freshState(), budget };
    saveState();
    fs.rmSync(MEDIA_DIR, { recursive: true, force: true });
    if (supabase.enabled) supabase.deleteAllImages();
    broadcast('chat-reload', {});
    broadcast('stories', {});
    sendJson(res, 200, { ok: true });
  },
};

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  const handler = routes[`${req.method} ${pathname}`];
  if (!handler) {
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Ukjent endepunkt' });
    if (req.method === 'GET' && pathname.startsWith('/media/')) return serveMedia(pathname, res);
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405);
    return res.end();
  }
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    handler(req, res, body);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
});

async function start() {
  if (supabase.enabled) {
    // Hent lagrede data fra Supabase før vi tar imot besøk. Feiler det, avslutter vi
    // heller enn å starte tomt (da ville vi overskrevet de lagrede dataene).
    for (let attempt = 1; ; attempt++) {
      try {
        await supabase.init();
        const remote = await supabase.loadState();
        if (remote) state = normalizeState(remote);
        console.log(remote ? `☁️  Hentet data fra Supabase (${state.participants.length} deltakere)` : '☁️  Supabase er klar (ingen lagrede data ennå)');
        break;
      } catch (err) {
        console.error(`Kunne ikke koble til Supabase (forsøk ${attempt}):`, err.message);
        if (attempt >= 5) {
          console.error('Gir opp. Sjekk SUPABASE_URL og SUPABASE_KEY.');
          process.exit(1);
        }
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  } else {
    console.log('💾 Lagrer lokalt i', DATA_FILE, '(sett SUPABASE_URL og SUPABASE_KEY for varig lagring)');
    // Feilsøking: vis navnene (aldri verdiene) på variabler som ligner, f.eks. feil skrivemåte eller mellomrom
    console.log(`   SUPABASE_URL satt: ${process.env.SUPABASE_URL ? 'ja' : 'nei'}, SUPABASE_KEY satt: ${process.env.SUPABASE_KEY ? 'ja' : 'nei'}`);
    const similar = Object.keys(process.env).filter((k) => /supa|base_url|_key$/i.test(k) && !/^(SUPABASE_URL|SUPABASE_KEY)$/.test(k));
    if (similar.length) console.log('   Lignende variabler funnet:', similar.map((k) => JSON.stringify(k)).join(', '));
  }

  poker.restore(); // avbryt en hånd som var i gang da serveren stoppet
  tables.restore(); // samme for blackjack-bordet og rouletten

  if (removedTasks) {
    console.log(`🧹 Fjernet ${removedTasks} utgåtte oppgaver`);
    saveState();
  }

  server.listen(PORT, () => {
    console.log(`🍺 Lønningspils kjører på http://localhost:${PORT}`);
    if (!process.env.ADMIN_PASSWORD) console.log('⚠️  Bruker standard admin-passord "pils123". Sett ADMIN_PASSWORD!');
  });
}

// Render stopper serveren med SIGTERM: sørg for at siste endringer er lagret først
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log(`${sig} mottatt, lagrer ...`);
    await supabase.drain();
    process.exit(0);
  });
}

start();
