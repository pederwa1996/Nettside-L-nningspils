'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// ---- Lagring ----
function freshState() {
  return { participants: [], draw: null, duels: [] };
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return freshState();
  }
}

let state = loadState();
state.duels = state.duels || [];
const games = new Map(); // aktive spill: gameId -> { token, start }

function saveState() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
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
      if (raw.length > 10000) {
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
};

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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
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
      draw: publicDraw(),
      leaderboard: leaderboard(),
      incomingDuels: me ? state.duels.filter((d) => d.status === 'pending' && d.opponent === me.name).length : 0,
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

    const used = usedTickets();
    const free = [];
    for (let i = 1; i <= TOTAL_TICKETS; i++) if (!used.has(i)) free.push(i);
    if (free.length < TICKETS_PER_PERSON) return sendJson(res, 409, { error: 'Beklager, alle loddene er delt ut.' });

    const participant = {
      name,
      token: crypto.randomBytes(24).toString('hex'),
      ip,
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
      })),
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
    sendJson(res, 200, { ok: true });
  },
};

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  const handler = routes[`${req.method} ${pathname}`];
  if (!handler) {
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Ukjent endepunkt' });
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

server.listen(PORT, () => {
  console.log(`🍺 Lønningspils kjører på http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.log('⚠️  Bruker standard admin-passord "pils123". Sett ADMIN_PASSWORD!');
});
