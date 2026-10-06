'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const supabase = require('./supabase');
const { TASKS: DEFAULT_TASKS, RETIRED: RETIRED_TASKS } = require('./tasks-default');

// ---- Innstillinger (kan overstyres med miljøvariabler) ----
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'pils123';
const TOTAL_TICKETS = Number(process.env.TOTAL_TICKETS) || 100;
const TICKETS_PER_PERSON = Number(process.env.TICKETS_PER_PERSON) || 5;
const WINNING_TICKETS = Number(process.env.WINNING_TICKETS) || 10;
const SPINS_PER_PERSON = Number(process.env.SPINS_PER_PERSON) || 3;
// "all" = trekk blant alle lodd (også de som ikke er delt ut), "assigned" = kun utdelte lodd
const DRAW_FROM = process.env.DRAW_FROM === 'assigned' ? 'assigned' : 'all';
const SPIN_WIN_CHANCE = process.env.SPIN_WIN_CHANCE !== undefined ? Number(process.env.SPIN_WIN_CHANCE) : 0.15;
// Flappy-spillet: første milepæl og hvor ofte et rør dukker opp (brukes til juksesjekk)
const GAME_FIRST_MILESTONE = Number(process.env.GAME_FIRST_MILESTONE) || 50;
const GAME_PIPE_INTERVAL_MS = 1500;
// Én registrering per IP-adresse. Sett ONE_PER_IP=false hvis alle sitter på samme wifi.
const ONE_PER_IP = process.env.ONE_PER_IP !== 'false';
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
const CASINO_MAX_BET = Number(process.env.CASINO_MAX_BET) || 5;

// ---- Lagring ----
function freshState() {
  return { participants: [], draw: null, duels: [], chat: [], stories: [], moggs: [], moggBest: {}, tasks: defaultTasks(), blackjack: {}, casinoLog: [], spinLog: [] };
}

function defaultTasks() {
  return DEFAULT_TASKS.map((t) => newTask(t));
}

function newTask({ title, desc, reward, proof }) {
  return {
    id: crypto.randomBytes(6).toString('hex'),
    title: String(title).slice(0, 80),
    desc: String(desc || '').slice(0, 400),
    reward: Math.max(1, Math.min(10, Math.round(Number(reward) || 1))),
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
  return out;
}

let removedTasks = 0;

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

function currentParticipant(req) {
  const token = parseCookies(req).pils_token;
  if (!token) return null;
  return state.participants.find((p) => p.token === token) || null;
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
// Rød/svart på et europeisk roulettehjul
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// Hva hver innsatstype vinner på, og utbetaling (gevinst i tillegg til innsatsen)
const ROULETTE_BETS = {
  red: { label: 'Rød', pays: 1, wins: (n) => RED_NUMBERS.has(n) },
  black: { label: 'Svart', pays: 1, wins: (n) => n !== 0 && !RED_NUMBERS.has(n) },
  even: { label: 'Partall', pays: 1, wins: (n) => n !== 0 && n % 2 === 0 },
  odd: { label: 'Oddetall', pays: 1, wins: (n) => n % 2 === 1 },
  low: { label: '1–18', pays: 1, wins: (n) => n >= 1 && n <= 18 },
  high: { label: '19–36', pays: 1, wins: (n) => n >= 19 },
  dozen1: { label: '1–12', pays: 2, wins: (n) => n >= 1 && n <= 12 },
  dozen2: { label: '13–24', pays: 2, wins: (n) => n >= 13 && n <= 24 },
  dozen3: { label: '25–36', pays: 2, wins: (n) => n >= 25 },
};

function parseBet(p, amount) {
  const bet = Math.floor(Number(amount));
  if (!Number.isFinite(bet) || bet < 1) throw new Error('Innsatsen må være minst 1 spinn.');
  if (bet > CASINO_MAX_BET) throw new Error(`Maks innsats er ${CASINO_MAX_BET} spinn.`);
  if (bet > spinsLeft(p)) throw new Error(`Du har bare ${spinsLeft(p)} spinn.`);
  return bet;
}

function logCasino(name, game, bet, net, detail) {
  state.casinoLog.push({ name, game, bet, net, detail, at: Date.now() });
  if (state.casinoLog.length > 30) state.casinoLog = state.casinoLog.slice(-30);
}

// Blackjack
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  return pickRandom(deck, deck.length); // ny stokket kortstokk hver runde
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.r === 'A') {
      total += 11;
      aces++;
    } else total += ['J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

const isBlackjack = (cards) => cards.length === 2 && handValue(cards) === 21;

function bjView(h) {
  if (!h) return null;
  const done = h.status === 'done';
  return {
    status: h.status,
    bet: h.bet,
    player: h.player,
    playerValue: handValue(h.player),
    // Dealerens andre kort holdes skjult til runden er ferdig
    dealer: done ? h.dealer : [h.dealer[0], { hidden: true }],
    dealerValue: done ? handValue(h.dealer) : handValue([h.dealer[0]]),
    canDouble: !done && h.player.length === 2 && !h.doubled,
    result: h.result || null,
    net: h.net ?? null,
  };
}

// Avslutter hånden: dealer trekker til 17, så sammenlignes hendene
function settleBlackjack(p, h, { dealerPlays = true } = {}) {
  const pv = handValue(h.player);
  if (dealerPlays && pv <= 21) {
    while (handValue(h.dealer) < 17) h.dealer.push(h.deck.pop());
  }
  const dv = handValue(h.dealer);
  let payout = 0;
  if (pv > 21) h.result = 'bust';
  else if (isBlackjack(h.player) && !isBlackjack(h.dealer)) {
    h.result = 'blackjack';
    payout = h.bet + Math.max(1, Math.floor(h.bet * 1.5));
  } else if (isBlackjack(h.dealer) && !isBlackjack(h.player)) h.result = 'dealer-blackjack';
  else if (dv > 21) {
    h.result = 'dealer-bust';
    payout = h.bet * 2;
  } else if (pv > dv) {
    h.result = 'win';
    payout = h.bet * 2;
  } else if (pv === dv) {
    h.result = 'push';
    payout = h.bet;
  } else h.result = 'lose';
  addSpins(p, payout);
  h.net = payout - h.bet;
  h.status = 'done';
  delete h.deck;
  logCasino(p.name, 'blackjack', h.bet, h.net, h.result);
}

function activeHand(p) {
  const h = state.blackjack[p.name];
  if (!h || h.status !== 'playing') throw new Error('Du har ingen hånd i spill. Trykk «Del ut».');
  return h;
}

// ---- Oppgaver ----
const MAX_PENDING_TASKS = 2;

function currentAttempt(t) {
  return t.attempts[t.attempts.length - 1] || null;
}

// Offentlig visning: bevis (bilde/tekst) vises bare for den som leverte
function taskView(t, viewer) {
  const cur = currentAttempt(t);
  const v = { id: t.id, title: t.title, desc: t.desc, reward: t.reward, proof: t.proof, status: t.status };
  if (t.status === 'pending') v.claimedBy = cur.name;
  if (t.status === 'done') v.completedBy = cur.name;
  if (viewer) {
    const mine = t.attempts.filter((a) => a.name === viewer.name);
    if (mine.length) {
      const last = mine[mine.length - 1];
      v.myAttempt = { status: last.status, reason: last.reason || '', at: last.at };
    }
  }
  return v;
}

function adminTaskView(t) {
  return { ...t, attempts: t.attempts.slice(-5) };
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
  const winning = new Set(state.draw ? state.draw.winningTickets : []);
  return state.participants
    .map((p) => {
      const wheelBeers = p.spins.filter(Boolean).length;
      const ticketBeers = p.tickets.filter((t) => winning.has(t)).length;
      return { name: p.name, beers: wheelBeers + ticketBeers, wheelBeers, ticketBeers, spinsLeft: spinsLeft(p) };
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
    tickets: p.tickets,
    spinsLeft: spinsAllowed(p) - p.spins.length,
    bonusSpins: p.bonusSpins || 0,
    bestScore: p.bestScore || 0,
    nextMilestone: { score: milestoneScore((p.milestones || 0) + 1), spins: (p.milestones || 0) + 1 },
    spinWins: p.spins.filter(Boolean).length,
    winningTickets: winning,
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
  };
}

function checkAdmin(body) {
  const given = Buffer.from(String(body.password || ''));
  const real = Buffer.from(ADMIN_PASSWORD);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
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

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Fant ikke siden');
    }
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
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
      draw: publicDraw(),
      leaderboard: leaderboard(),
      standings: standings(),
      incomingDuels: me ? state.duels.filter((d) => d.status === 'pending' && d.opponent === me.name).length : 0,
      openTasks: state.tasks.filter((t) => t.status === 'open').length,
      incomingMoggs: me ? state.moggs.filter((m) => m.status === 'pending' && m.opponent === me.name).length : 0,
    });
  },

  'POST /api/join': (req, res, body) => {
    if (currentParticipant(req)) return sendJson(res, 400, { error: 'Du er allerede registrert.' });

    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 40) return sendJson(res, 400, { error: 'Navnet må være mellom 2 og 40 tegn.' });
    if (state.draw) return sendJson(res, 400, { error: 'Loddtrekningen er allerede gjennomført.' });

    const key = normalizeName(name);
    if (state.participants.some((p) => normalizeName(p.name) === key)) {
      return sendJson(res, 409, { error: 'Det navnet er allerede tatt. Én registrering per person!' });
    }

    const ip = clientIp(req);
    if (ONE_PER_IP && state.participants.some((p) => p.ip === ip)) {
      return sendJson(res, 409, { error: 'Det er allerede registrert noen fra denne enheten/nettverket. Én registrering per person!' });
    }

    if (!body.avatar) return sendJson(res, 400, { error: 'Du må ta et profilbilde 📸' });

    const used = usedTickets();
    const free = [];
    for (let i = 1; i <= TOTAL_TICKETS; i++) if (!used.has(i)) free.push(i);
    if (free.length < TICKETS_PER_PERSON) return sendJson(res, 409, { error: 'Beklager, alle loddene er delt ut.' });

    const participant = {
      name,
      token: crypto.randomBytes(24).toString('hex'),
      ip,
      avatar: saveImage(body.avatar, 'avatars'),
      tickets: pickRandom(free, TICKETS_PER_PERSON).sort((a, b) => a - b),
      spins: [],
      joinedAt: new Date().toISOString(),
    };
    state.participants.push(participant);
    saveState();

    const cookie = `pils_token=${participant.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
    sendJson(res, 200, { me: meView(participant) }, { 'Set-Cookie': cookie });
  },

  'POST /api/spin': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    if (p.spins.length >= spinsAllowed(p)) return sendJson(res, 400, { error: 'Du har brukt opp alle spinnene dine.' });

    const win = crypto.randomInt(1_000_000) < SPIN_WIN_CHANCE * 1_000_000;
    p.spins.push(win);
    saveState();
    sendJson(res, 200, { win, me: meView(p) });
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
    if (!checkAdmin(body)) return sendJson(res, 403, { error: 'Feil passord.' });
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
    if (!checkAdmin(body)) return sendJson(res, 403, { error: 'Feil passord.' });
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
    if (!checkAdmin(body)) return sendJson(res, 403, { error: 'Feil passord.' });
    delete state.moggBest[String(body.name || '')];
    saveState();
    sendJson(res, 200, { ok: true });
  },

  // ---- Oppgaver ----
  'GET /api/tasks': (req, res) => {
    const p = currentParticipant(req);
    sendJson(res, 200, { me: meView(p), tasks: state.tasks.map((t) => taskView(t, p)) });
  },

  'POST /api/tasks/submit': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const t = state.tasks.find((x) => x.id === body.id);
    if (!t) return sendJson(res, 404, { error: 'Fant ikke oppgaven.' });
    if (t.status === 'done') return sendJson(res, 400, { error: `Oppgaven er allerede løst av ${currentAttempt(t).name}.` });
    if (t.status === 'pending') return sendJson(res, 400, { error: `${currentAttempt(t).name} har allerede levert denne og venter på godkjenning.` });
    const pending = state.tasks.filter((x) => x.status === 'pending' && currentAttempt(x).name === p.name).length;
    if (pending >= MAX_PENDING_TASKS) return sendJson(res, 400, { error: `Du kan ha maks ${MAX_PENDING_TASKS} oppgaver som venter på godkjenning om gangen.` });
    const text = String(body.text || '').trim().slice(0, 500);
    if (t.proof === 'photo' && !body.image) return sendJson(res, 400, { error: 'Denne oppgaven krever et bilde som bevis 📸' });
    if (t.proof === 'text' && !text && !body.image) return sendJson(res, 400, { error: 'Skriv hva du gjorde som bevis.' });

    const url = body.image ? saveImage(body.image, 'tasks') : null;
    t.attempts.push({ name: p.name, status: 'pending', text, url, at: Date.now() });
    t.status = 'pending';
    saveState();
    broadcast('tasks', {});
    sendJson(res, 200, { task: taskView(t, p) });
  },

  'POST /api/tasks/withdraw': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const t = state.tasks.find((x) => x.id === body.id && x.status === 'pending');
    const cur = t && currentAttempt(t);
    if (!cur || cur.name !== p.name) return sendJson(res, 400, { error: 'Fant ikke innleveringen din.' });
    deleteImage(cur.url);
    t.attempts.pop();
    t.status = 'open';
    saveState();
    broadcast('tasks', {});
    sendJson(res, 200, { ok: true });
  },

  'POST /api/admin/task-review': (req, res, body) => {
    if (!checkAdmin(body)) return sendJson(res, 403, { error: 'Feil passord.' });
    const t = state.tasks.find((x) => x.id === body.id && x.status === 'pending');
    if (!t) return sendJson(res, 400, { error: 'Fant ikke innleveringen.' });
    const cur = currentAttempt(t);
    cur.reviewedAt = Date.now();
    if (body.approve) {
      cur.status = 'approved';
      t.status = 'done';
      const p = findParticipant(cur.name);
      if (p) addSpins(p, t.reward);
    } else {
      // Avvist: oppgaven blir åpen for alle igjen
      cur.status = 'rejected';
      cur.reason = String(body.reason || '').trim().slice(0, 200);
      deleteImage(cur.url);
      cur.url = null;
      t.status = 'open';
    }
    saveState();
    broadcast('tasks', {});
    sendJson(res, 200, { ok: true });
  },

  'POST /api/admin/task-add': (req, res, body) => {
    if (!checkAdmin(body)) return sendJson(res, 403, { error: 'Feil passord.' });
    const title = String(body.title || '').trim();
    if (title.length < 3) return sendJson(res, 400, { error: 'Oppgaven trenger en tittel.' });
    state.tasks.push(newTask({ ...body, title }));
    saveState();
    broadcast('tasks', {});
    sendJson(res, 200, { ok: true });
  },

  'POST /api/admin/task-delete': (req, res, body) => {
    if (!checkAdmin(body)) return sendJson(res, 403, { error: 'Feil passord.' });
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
      blackjack: p ? bjView(state.blackjack[p.name]) : null,
      log: state.casinoLog.slice(-10).reverse(),
      avatars: avatars(),
    });
  },

  'POST /api/casino/roulette': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const bet = parseBet(p, body.amount);
    let kind;
    if (body.type === 'number') {
      const n = Number(body.number);
      if (!Number.isInteger(n) || n < 0 || n > 36) return sendJson(res, 400, { error: 'Velg et tall fra 0 til 36.' });
      kind = { label: `Tallet ${n}`, pays: 35, wins: (x) => x === n };
    } else {
      kind = ROULETTE_BETS[body.type];
      if (!kind) return sendJson(res, 400, { error: 'Ukjent innsats.' });
    }
    const number = randomInt(37);
    const won = kind.wins(number);
    const net = won ? bet * kind.pays : -bet;
    addSpins(p, net);
    logCasino(p.name, 'roulette', bet, net, `${kind.label} → ${number}`);
    saveState();
    sendJson(res, 200, { number, color: number === 0 ? 'green' : RED_NUMBERS.has(number) ? 'red' : 'black', won, net, me: meView(p) });
  },

  'POST /api/casino/bj/deal': (req, res, body) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const cur = state.blackjack[p.name];
    if (cur && cur.status === 'playing') return sendJson(res, 400, { error: 'Du har allerede en hånd i spill.' });
    const bet = parseBet(p, body.amount);
    addSpins(p, -bet); // innsatsen trekkes med en gang
    const deck = newDeck();
    const h = { bet, deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], status: 'playing', doubled: false };
    state.blackjack[p.name] = h;
    // Blackjack på første to kort avgjøres med en gang
    if (isBlackjack(h.player) || isBlackjack(h.dealer)) settleBlackjack(p, h, { dealerPlays: false });
    saveState();
    sendJson(res, 200, { blackjack: bjView(h), me: meView(p) });
  },

  'POST /api/casino/bj/hit': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const h = activeHand(p);
    h.player.push(h.deck.pop());
    const v = handValue(h.player);
    if (v > 21) settleBlackjack(p, h, { dealerPlays: false });
    else if (v === 21) settleBlackjack(p, h);
    saveState();
    sendJson(res, 200, { blackjack: bjView(h), me: meView(p) });
  },

  'POST /api/casino/bj/stand': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const h = activeHand(p);
    settleBlackjack(p, h);
    saveState();
    sendJson(res, 200, { blackjack: bjView(h), me: meView(p) });
  },

  'POST /api/casino/bj/double': (req, res) => {
    const p = currentParticipant(req);
    if (!p) return sendJson(res, 401, { error: 'Du må registrere deg først.' });
    const h = activeHand(p);
    if (h.player.length !== 2 || h.doubled) return sendJson(res, 400, { error: 'Du kan bare doble på de to første kortene.' });
    if (spinsLeft(p) < h.bet) return sendJson(res, 400, { error: `Du trenger ${h.bet} spinn til for å doble.` });
    addSpins(p, -h.bet);
    h.bet *= 2;
    h.doubled = true;
    h.player.push(h.deck.pop()); // ett kort, så står du
    settleBlackjack(p, h, { dealerPlays: handValue(h.player) <= 21 });
    saveState();
    sendJson(res, 200, { blackjack: bjView(h), me: meView(p) });
  },

  // ---- Admin: gi eller ta spinn ----
  'POST /api/admin/players': (req, res, body) => {
    if (!checkAdmin(body)) return sendJson(res, 403, { error: 'Feil passord.' });
    sendJson(res, 200, {
      players: state.participants
        .map((p) => ({ name: p.name, avatar: p.avatar || null, spinsLeft: spinsLeft(p) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'no')),
      log: state.spinLog.slice(-20).reverse(),
    });
  },

  'POST /api/admin/spins': (req, res, body) => {
    if (!checkAdmin(body)) return sendJson(res, 403, { error: 'Feil passord.' });
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
    state.spinLog.push({ name: p.name, delta, at: Date.now() });
    if (state.spinLog.length > 50) state.spinLog = state.spinLog.slice(-50);
    saveState();
    sendJson(res, 200, { name: p.name, delta, spinsLeft: spinsLeft(p) });
  },

  'POST /api/admin/login': (req, res, body) => {
    if (!checkAdmin(body)) return sendJson(res, 403, { error: 'Feil passord.' });
    sendJson(res, 200, {
      ok: true,
      participants: state.participants.map((p) => ({
        name: p.name,
        tickets: p.tickets,
        spinsUsed: p.spins.length,
        spinsAllowed: spinsAllowed(p),
        bestScore: p.bestScore || 0,
        spinWins: p.spins.filter(Boolean).length,
        avatar: p.avatar || null,
      })),
      stories: (pruneStories(), state.stories.map((x) => ({ id: x.id, name: x.name, url: x.url, caption: x.caption, at: x.at }))),
      chat: state.chat.slice(-50).reverse(),
      moggPodium: moggPodium(),
      tasks: state.tasks.map(adminTaskView),
    });
  },

  'POST /api/admin/draw': (req, res, body) => {
    if (!checkAdmin(body)) return sendJson(res, 403, { error: 'Feil passord.' });
    if (state.draw) return sendJson(res, 400, { error: 'Loddtrekningen er allerede gjennomført.' });

    const pool = DRAW_FROM === 'assigned'
      ? [...usedTickets()]
      : Array.from({ length: TOTAL_TICKETS }, (_, i) => i + 1);
    if (!pool.length) return sendJson(res, 400, { error: 'Ingen lodd å trekke blant ennå.' });
    state.draw = {
      drawnAt: new Date().toISOString(),
      winningTickets: pickRandom(pool, WINNING_TICKETS).sort((a, b) => a - b),
    };
    saveState();
    sendJson(res, 200, { draw: publicDraw() });
  },

  'POST /api/admin/reset-draw': (req, res, body) => {
    if (!checkAdmin(body)) return sendJson(res, 403, { error: 'Feil passord.' });
    state.draw = null;
    saveState();
    sendJson(res, 200, { ok: true });
  },

  'POST /api/admin/reset-all': (req, res, body) => {
    if (!checkAdmin(body)) return sendJson(res, 403, { error: 'Feil passord.' });
    state = freshState();
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
