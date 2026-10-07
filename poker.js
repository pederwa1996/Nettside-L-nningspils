'use strict';

// Texas Hold'em for ett bord med 9 plasser. All logikk og alle kort ligger på serveren.
// Bordet lagres i state.poker: { seats: [ {name, chips, strikes} | null ], hand, button, lastResult }

const SEATS = 9;
const TURN_MS = Number(process.env.POKER_TURN_MS) || 30000; // tid per handling
const RESULT_MS = Number(process.env.POKER_RESULT_MS) || 6000; // hvor lenge resultatet vises før neste hånd
const START_DELAY_MS = Number(process.env.POKER_START_MS) || 3000;

const SUITS = ['♠', '♥', '♦', '♣'];
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const HAND_NAMES = ['Høyt kort', 'Ett par', 'To par', 'Tre like', 'Straight', 'Flush', 'Hus', 'Fire like', 'Straight flush'];

// ---------- Håndevaluering ----------
// Returnerer [kategori, ...tiebreakers] for fem kort. Høyere er bedre (sammenlign med compareScore).
function score5(cards) {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks.join() === '14,5,4,3,2') straightHigh = 5; // A-2-3-4-5
  }
  const counts = {};
  ranks.forEach((r) => (counts[r] = (counts[r] || 0) + 1));
  // Sorter etter antall, så etter verdi
  const groups = Object.entries(counts).map(([r, n]) => [Number(r), n]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map((g) => g[0]);
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, ...byGroup];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, ...byGroup];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, ...byGroup];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...byGroup];
  if (groups[0][1] === 2) return [1, ...byGroup];
  return [0, ...ranks];
}

function compareScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Beste fem av sju kort
function bestHand(cards) {
  let best = null;
  let bestCards = null;
  for (let a = 0; a < cards.length; a++) {
    for (let b = a + 1; b < cards.length; b++) {
      const five = cards.filter((_, i) => i !== a && i !== b);
      const s = score5(five);
      if (!best || compareScore(s, best) > 0) {
        best = s;
        bestCards = five;
      }
    }
  }
  return { score: best, name: HAND_NAMES[best[0]], cards: bestCards };
}

// ---------- Bordet ----------
function createPoker(ctx) {
  // ctx: { state(), save(), broadcast(), findParticipant(name), addFlus(p, n), randomInt(n), shuffle(arr),
  //        onWin(name, won, net, handName), blinds: {small, big}, minBuyIn, maxBuyIn }
  let timer = null;
  let nextTimer = null;

  const table = () => ctx.state().poker;
  const seats = () => table().seats;
  const hand = () => table().hand;
  const notify = () => {
    ctx.save();
    ctx.broadcast('poker', {});
  };

  function seatOf(name) {
    return seats().findIndex((s) => s && s.name === name);
  }

  function newDeck() {
    const deck = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ r, s });
    return ctx.shuffle(deck);
  }

  // Neste plass etter `from` som oppfyller test (går rundt bordet)
  function nextSeat(from, test) {
    for (let i = 1; i <= SEATS; i++) {
      const idx = (from + i + SEATS) % SEATS;
      if (test(idx)) return idx;
    }
    return -1;
  }

  const inHand = (i) => !!(hand() && hand().players[i]);
  const live = (i) => inHand(i) && !hand().players[i].folded;
  const canAct = (i) => live(i) && !hand().players[i].allIn;

  function clearTimers() {
    clearTimeout(timer);
    timer = null;
  }

  // ---------- Starte hånd ----------
  function scheduleNextHand(delay = START_DELAY_MS) {
    clearTimeout(nextTimer);
    nextTimer = setTimeout(startHand, delay);
    table().nextHandAt = Date.now() + delay;
  }

  function startHand() {
    const t = table();
    if (t.hand) return;
    // Spillere uten sjetonger reiser seg
    seats().forEach((s, i) => {
      if (s && s.chips <= 0) seats()[i] = null;
    });
    const eligible = seats().map((s, i) => (s && s.chips > 0 ? i : -1)).filter((i) => i >= 0);
    t.nextHandAt = null;
    if (eligible.length < 2) {
      notify();
      return;
    }
    t.lastResult = null;
    t.button = nextSeat(t.button ?? -1, (i) => eligible.includes(i));
    const h = {
      id: Date.now(),
      deck: newDeck(),
      board: [],
      phase: 'preflop',
      players: {},
      currentBet: 0,
      minRaise: ctx.blinds.big,
      toAct: -1,
      deadline: 0,
    };
    eligible.forEach((i) => (h.players[i] = { name: seats()[i].name, cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, last: '' }));
    t.hand = h;

    const headsUp = eligible.length === 2;
    const sb = headsUp ? t.button : nextSeat(t.button, (i) => i in h.players);
    const bb = nextSeat(sb, (i) => i in h.players);
    post(sb, ctx.blinds.small, 'Liten blind');
    post(bb, ctx.blinds.big, 'Stor blind');
    h.currentBet = Math.max(h.players[sb].bet, h.players[bb].bet);
    for (let round = 0; round < 2; round++) eligible.forEach((i) => h.players[i].cards.push(h.deck.pop()));
    h.toAct = nextSeat(bb, canAct);
    if (h.toAct < 0 || bettingDone()) return advance();
    startTurn();
    notify();
  }

  function post(i, amount, label) {
    const s = seats()[i];
    const p = hand().players[i];
    const a = Math.min(amount, s.chips);
    s.chips -= a;
    p.bet += a;
    p.total += a;
    p.last = label;
    if (s.chips === 0) p.allIn = true;
  }

  function startTurn() {
    clearTimers();
    const h = hand();
    h.deadline = Date.now() + TURN_MS;
    const id = h.id;
    const seat = h.toAct;
    timer = setTimeout(() => {
      const cur = hand();
      if (!cur || cur.id !== id || cur.toAct !== seat) return;
      const s = seats()[seat];
      if (s) s.strikes = (s.strikes || 0) + 1;
      const p = cur.players[seat];
      if (p.bet >= cur.currentBet) doAction(seat, 'check');
      else doAction(seat, 'fold');
      // To tidsavbrudd på rad: reis deg fra bordet
      if (s && s.strikes >= 2) leaveSeat(seat);
      notify();
    }, TURN_MS);
  }

  // ---------- Handlinger ----------
  function legal(i) {
    const h = hand();
    if (!h || h.toAct !== i || !canAct(i)) return null;
    const p = h.players[i];
    const chips = seats()[i].chips;
    const toCall = Math.min(h.currentBet - p.bet, chips);
    const maxTo = p.bet + chips;
    const minTo = Math.min(h.currentBet + h.minRaise, maxTo);
    return {
      canCheck: toCall === 0,
      toCall,
      canRaise: maxTo > h.currentBet,
      minRaiseTo: Math.max(minTo, h.currentBet === 0 ? Math.min(ctx.blinds.big, maxTo) : minTo),
      maxRaiseTo: maxTo,
    };
  }

  function doAction(i, action, amount) {
    const h = hand();
    const p = h.players[i];
    const s = seats()[i];
    const l = legal(i);
    if (!l) throw new Error('Det er ikke din tur.');
    if (action === 'fold') {
      p.folded = true;
      p.last = 'Kaster';
    } else if (action === 'check') {
      if (!l.canCheck) throw new Error('Du kan ikke sjekke, du må syne eller kaste.');
      p.last = 'Sjekk';
    } else if (action === 'call') {
      const a = l.toCall;
      s.chips -= a;
      p.bet += a;
      p.total += a;
      if (s.chips === 0) p.allIn = true;
      p.last = p.allIn ? 'All in' : a ? `Syner ${a}` : 'Sjekk';
    } else if (action === 'raise' || action === 'allin') {
      if (!l.canRaise) throw new Error('Du kan ikke høyne nå.');
      let to = action === 'allin' ? l.maxRaiseTo : Math.floor(Number(amount));
      if (!Number.isFinite(to)) throw new Error('Ugyldig beløp.');
      to = Math.min(to, l.maxRaiseTo);
      if (to < l.minRaiseTo && to !== l.maxRaiseTo) throw new Error(`Minste høyning er til ${l.minRaiseTo}.`);
      const add = to - p.bet;
      s.chips -= add;
      p.bet = to;
      p.total += add;
      if (s.chips === 0) p.allIn = true;
      const raiseSize = to - h.currentBet;
      if (to > h.currentBet) {
        // En full høyning åpner runden igjen for alle andre
        if (raiseSize >= h.minRaise) h.minRaise = raiseSize;
        h.currentBet = to;
        Object.entries(h.players).forEach(([j, q]) => {
          if (Number(j) !== i && !q.folded && !q.allIn) q.acted = false;
        });
      }
      p.last = p.allIn ? 'All in' : h.currentBet === to && raiseSize ? `Høyner til ${to}` : `Syner ${add}`;
    } else throw new Error('Ukjent handling.');
    p.acted = true;
    advance();
  }

  function bettingDone() {
    const h = hand();
    const actors = Object.keys(h.players).map(Number).filter(canAct);
    if (actors.length === 0) return true;
    if (actors.length === 1) {
      const p = h.players[actors[0]];
      // Siste spiller med sjetonger trenger bare å syne en eventuell innsats
      return p.bet >= h.currentBet && (p.acted || Object.keys(h.players).filter((j) => live(Number(j))).length > 1);
    }
    return actors.every((j) => h.players[j].acted && h.players[j].bet === h.currentBet);
  }

  function advance() {
    clearTimers();
    const h = hand();
    const remaining = Object.keys(h.players).map(Number).filter(live);
    if (remaining.length === 1) return finish(remaining);
    if (!bettingDone()) {
      h.toAct = nextSeat(h.toAct, canAct);
      startTurn();
      return;
    }
    // Ny gate
    Object.values(h.players).forEach((p) => {
      p.bet = 0;
      p.acted = false;
      if (!p.folded && !p.allIn) p.last = '';
    });
    h.currentBet = 0;
    h.minRaise = ctx.blinds.big;
    if (h.phase === 'preflop') {
      h.board.push(h.deck.pop(), h.deck.pop(), h.deck.pop());
      h.phase = 'flop';
    } else if (h.phase === 'flop') {
      h.board.push(h.deck.pop());
      h.phase = 'turn';
    } else if (h.phase === 'turn') {
      h.board.push(h.deck.pop());
      h.phase = 'river';
    } else return finish(remaining);
    // Kan færre enn to spillere handle, deles resten av kortene ut automatisk
    if (Object.keys(h.players).map(Number).filter(canAct).length < 2) return advance();
    h.toAct = nextSeat(table().button, canAct);
    startTurn();
  }

  // ---------- Oppgjør (med sidepotter) ----------
  function finish(remaining) {
    clearTimers();
    const t = table();
    const h = t.hand;
    const entries = Object.entries(h.players).map(([i, p]) => ({ i: Number(i), p }));
    const showdown = remaining.length > 1;
    if (showdown) while (h.board.length < 5) h.board.push(h.deck.pop());
    const evals = {};
    if (showdown) remaining.forEach((i) => (evals[i] = bestHand([...h.players[i].cards, ...h.board])));

    const won = {};
    const levels = [...new Set(entries.map((e) => e.p.total))].filter((x) => x > 0).sort((a, b) => a - b);
    let prev = 0;
    for (const level of levels) {
      const amount = entries.reduce((sum, e) => sum + Math.max(0, Math.min(e.p.total, level) - prev), 0);
      let eligible = remaining.filter((i) => h.players[i].total >= level);
      if (!eligible.length) eligible = remaining; // f.eks. når den som la mest har kastet
      let winners = eligible;
      if (showdown && eligible.length > 1) {
        let best = null;
        eligible.forEach((i) => {
          const c = best ? compareScore(evals[i].score, best) : 1;
          if (c > 0) {
            best = evals[i].score;
            winners = [i];
          } else if (c === 0) winners.push(i);
        });
      }
      // Del likt, eventuell rest til første vinner etter dealer
      const share = Math.floor(amount / winners.length);
      let rest = amount - share * winners.length;
      const ordered = winners.slice().sort((a, b) => ((a - t.button + SEATS) % SEATS) - ((b - t.button + SEATS) % SEATS));
      ordered.forEach((i) => {
        won[i] = (won[i] || 0) + share + (rest > 0 ? 1 : 0);
        if (rest > 0) rest--;
      });
      prev = level;
    }

    const result = { board: h.board.slice(), winners: [], shown: {}, showdown };
    Object.entries(won).forEach(([i, amount]) => {
      i = Number(i);
      const name = h.players[i].name;
      const s = seats()[i] && seats()[i].name === name ? seats()[i] : null;
      const net = amount - h.players[i].total;
      if (s) s.chips += amount;
      else {
        // Spilleren har gått fra bordet: gevinsten går rett i lommeboka
        const p = ctx.findParticipant(h.players[i].name);
        if (p) ctx.addFlus(p, amount);
      }
      result.winners.push({ seat: i, name, amount, hand: showdown ? evals[i].name : null, best: showdown ? evals[i].cards : null });
      if (net > 0) ctx.onWin(name, amount, net, showdown ? evals[i].name : null);
    });
    if (showdown) remaining.forEach((i) => (result.shown[i] = { cards: h.players[i].cards, hand: evals[i].name }));
    t.lastResult = result;
    t.hand = null;
    t.resultUntil = Date.now() + RESULT_MS;
    scheduleNextHand(RESULT_MS);
    notify();
  }

  // ---------- Sitte / reise seg ----------
  function sit(p, seatIdx, buyIn) {
    if (seatOf(p.name) >= 0) throw new Error('Du sitter allerede ved bordet.');
    if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx >= SEATS) throw new Error('Ugyldig plass.');
    if (seats()[seatIdx]) throw new Error('Plassen er opptatt.');
    if (hand() && hand().players[seatIdx]) throw new Error('Plassen blir ledig etter denne hånden.');
    const amount = Math.floor(Number(buyIn));
    if (!Number.isFinite(amount) || amount < ctx.minBuyIn || amount > ctx.maxBuyIn) {
      throw new Error(`Innkjøp må være mellom ${ctx.minBuyIn} og ${ctx.maxBuyIn} cash.`);
    }
    if ((p.flus || 0) < amount) throw new Error(`Du har bare ${p.flus || 0} cash.`);
    ctx.addFlus(p, -amount);
    seats()[seatIdx] = { name: p.name, chips: amount, strikes: 0 };
    if (!hand()) scheduleNextHand();
    notify();
  }

  function leaveSeat(i) {
    const s = seats()[i];
    if (!s) return;
    const h = hand();
    if (h && h.players[i]) {
      if (!h.players[i].folded) {
        h.players[i].folded = true;
        h.players[i].last = 'Gikk';
      }
    }
    const p = ctx.findParticipant(s.name);
    if (p) ctx.addFlus(p, s.chips);
    seats()[i] = null;
    if (h && h.toAct === i) advance();
    else if (h) {
      const remaining = Object.keys(h.players).map(Number).filter(live);
      if (remaining.length === 1) finish(remaining);
    }
  }

  function leave(p) {
    const i = seatOf(p.name);
    if (i < 0) throw new Error('Du sitter ikke ved bordet.');
    leaveSeat(i);
    notify();
  }

  function act(p, action, amount) {
    const i = seatOf(p.name);
    if (i < 0) throw new Error('Du sitter ikke ved bordet.');
    if (!hand()) throw new Error('Ingen hånd i spill.');
    doAction(i, action, amount);
    if (seats()[i]) seats()[i].strikes = 0; // egen handling nullstiller tidsavbrudd
    notify();
  }

  // Etter omstart: en hånd som var i gang avbrytes, og alle får innsatsen tilbake
  function restore() {
    const t = table();
    if (t.hand) {
      Object.entries(t.hand.players).forEach(([i, pl]) => {
        const s = t.seats[i];
        if (s && s.name === pl.name) s.chips += pl.total;
        else {
          const p = ctx.findParticipant(pl.name);
          if (p) ctx.addFlus(p, pl.total);
        }
      });
      t.hand = null;
    }
    if (t.seats.filter((s) => s && s.chips > 0).length >= 2) scheduleNextHand();
  }

  // Det en bestemt person får se (bare egne kort, andres vises ved showdown)
  function view(viewer, avatars) {
    const t = table();
    const h = t.hand;
    const mySeat = viewer ? seatOf(viewer.name) : -1;
    const label = (c) => ({ r: RANK_LABEL[c.r] || String(c.r), s: c.s });
    return {
      seats: t.seats.map((s, i) => {
        if (!s) return null;
        const pl = h && h.players[i];
        const shown = !h && t.lastResult && t.lastResult.shown[i];
        let cards = null;
        if (pl) cards = i === mySeat ? pl.cards.map(label) : pl.folded ? null : [{ hidden: true }, { hidden: true }];
        if (shown) cards = shown.cards.map(label);
        return {
          name: s.name,
          avatar: avatars[s.name] || null,
          chips: s.chips,
          bet: pl ? pl.bet : 0,
          folded: pl ? pl.folded : false,
          allIn: pl ? pl.allIn : false,
          last: pl ? pl.last : '',
          inHand: !!pl,
          cards,
          shownHand: shown ? shown.hand : null,
        };
      }),
      button: t.button ?? -1,
      phase: h ? h.phase : t.lastResult ? 'result' : 'waiting',
      board: h ? h.board.map(label) : t.lastResult ? t.lastResult.board.map(label) : [],
      pot: h ? Object.values(h.players).reduce((sum, pl) => sum + pl.total, 0) : 0,
      toAct: h ? h.toAct : -1,
      deadline: h ? h.deadline : 0,
      mySeat,
      legal: h && mySeat >= 0 ? legal(mySeat) : null,
      result: !h && t.lastResult
        ? { ...t.lastResult, board: undefined, shown: undefined, winners: t.lastResult.winners.map((w) => ({ ...w, best: w.best ? w.best.map(label) : null })) }
        : null,
      nextHandAt: t.nextHandAt || null,
      blinds: ctx.blinds,
      minBuyIn: ctx.minBuyIn,
      maxBuyIn: ctx.maxBuyIn,
    };
  }

  return { sit, leave, act, view, restore, seatOf };
}

module.exports = { createPoker, bestHand, score5, compareScore, SEATS };
