'use strict';

// Felles bord i kasinoet: blackjack-bordet (5 plasser) og rouletten (ett hjul for alle).
// Det finnes bare ett av hvert. Vil man spille, må man inn på bordet; andre kan se på.
// All logikk, alle kort og alle tall ligger på serveren. Bordene lagres i state.bjTable og
// state.rouletteTable, og en runde som var i gang ved omstart avbrytes med pengene tilbake.

const BJ_SEATS = 5;
const BJ_BET_MS = Number(process.env.BJ_BET_MS) || 15000; // innsatsrunde etter første innsats
const BJ_TURN_MS = Number(process.env.BJ_TURN_MS) || 20000; // tid per spiller
const BJ_RESULT_MS = Number(process.env.BJ_RESULT_MS) || 6000;
const BJ_DEALER_STEP_MS = 700; // dealeren trekker ett kort om gangen så alle ser det

const RL_BET_MS = Number(process.env.RL_BET_MS) || 15000; // innsatsrunde etter første innsats
const RL_SPIN_MS = 6000; // hjulet spinner
const RL_RESULT_MS = 6000;

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const RL_BETS = {
  red: { label: 'Rød', wins: (n) => RED.has(n) },
  black: { label: 'Svart', wins: (n) => n !== 0 && !RED.has(n) },
  even: { label: 'Partall', wins: (n) => n !== 0 && n % 2 === 0 },
  odd: { label: 'Oddetall', wins: (n) => n % 2 === 1 },
};

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.r === 'A') {
      total += 11;
      aces++;
    } else if (['J', 'Q', 'K'].includes(c.r)) total += 10;
    else total += Number(c.r);
  }
  while (total > 21 && aces) {
    total -= 10;
    aces--;
  }
  return total;
}
const isBlackjack = (cards) => cards.length === 2 && handValue(cards) === 21;

function createTables(ctx) {
  // ctx: state(), save(), broadcast(event, data), findParticipant(name), addFlus(p, n),
  //      shuffle(arr), randomInt(n), minBet, maxBet, onWin(name, game, payout, net, detail)
  const timers = { bj: null, rl: null };

  // =========================================================
  // Blackjack
  // =========================================================
  function bjt() {
    const s = ctx.state();
    if (!s.bjTable) s.bjTable = { seats: Array(BJ_SEATS).fill(null), round: null, lastResult: null };
    return s.bjTable;
  }
  const bjNotify = () => {
    ctx.save();
    ctx.broadcast('bj', {});
  };
  const bjSeatOf = (name) => bjt().seats.findIndex((s) => s && s.name === name);

  function bjSchedule(ms, fn) {
    clearTimeout(timers.bj);
    timers.bj = setTimeout(fn, Math.max(0, ms));
  }

  function bjDeck() {
    const deck = [];
    for (let n = 0; n < 2; n++) for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
    return ctx.shuffle(deck);
  }

  function bjSit(p, seat) {
    const t = bjt();
    seat = Math.floor(Number(seat));
    if (!(seat >= 0 && seat < BJ_SEATS)) throw new Error('Ugyldig plass.');
    if (bjSeatOf(p.name) >= 0) throw new Error('Du sitter allerede ved bordet.');
    if (t.seats[seat]) throw new Error('Plassen er tatt.');
    t.seats[seat] = { name: p.name, idle: 0, strikes: 0 };
    bjNotify();
  }

  function bjLeave(p) {
    const t = bjt();
    const i = bjSeatOf(p.name);
    if (i < 0) throw new Error('Du sitter ikke ved bordet.');
    const r = t.round;
    if (r && r.phase === 'betting' && r.bets[i]) {
      ctx.addFlus(p, r.bets[i]); // innsatsen tilbake før kortene er delt ut
      delete r.bets[i];
    }
    if (r && r.phase === 'playing' && r.hands[i]) {
      t.seats[i].leaving = true; // spilleren står og forlater bordet etter runden
      if (r.hands[i].status === 'playing') bjStand(i);
    } else t.seats[i] = null;
    bjNotify();
  }

  function bjBet(p, amount) {
    const t = bjt();
    const i = bjSeatOf(p.name);
    if (i < 0) throw new Error('Sett deg ved bordet først.');
    let r = t.round;
    if (r && r.phase !== 'betting') throw new Error('Runden er i gang. Vent til neste.');
    const bet = Math.floor(Number(amount));
    if (!Number.isFinite(bet) || bet < ctx.minBet) throw new Error(`Minste innsats er ${ctx.minBet} cash.`);
    if (bet > ctx.maxBet) throw new Error(`Maks innsats er ${ctx.maxBet} cash.`);
    const had = r ? r.bets[i] || 0 : 0;
    if (bet > (p.flus || 0) + had) throw new Error(`Du har bare ${(p.flus || 0) + had} cash.`);
    if (!r) {
      r = t.round = { id: `${Date.now()}`, phase: 'betting', bets: {}, bettingEndsAt: Date.now() + BJ_BET_MS };
      bjSchedule(BJ_BET_MS, bjDeal);
    }
    ctx.addFlus(p, had - bet); // bytt ut en tidligere innsats
    r.bets[i] = bet;
    t.seats[i].idle = 0;
    // Har alle ved bordet satset, deles det ut med en gang
    const seated = t.seats.map((s, k) => (s ? k : -1)).filter((k) => k >= 0);
    if (seated.every((k) => r.bets[k])) {
      r.bettingEndsAt = Date.now() + 1500;
      bjSchedule(1500, bjDeal);
    }
    bjNotify();
  }

  function bjDeal() {
    const t = bjt();
    const r = t.round;
    if (!r || r.phase !== 'betting') return;
    const seats = Object.keys(r.bets).map(Number).filter((i) => t.seats[i]).sort((a, b) => a - b);
    // De som satt uten å satse: tell opp, og reis dem etter tre runder
    t.seats.forEach((s, i) => {
      if (s && !r.bets[i]) {
        s.idle = (s.idle || 0) + 1;
        if (s.idle >= 3) t.seats[i] = null;
      }
    });
    if (!seats.length) {
      t.round = null;
      return bjNotify();
    }
    r.deck = bjDeck();
    r.hands = {};
    seats.forEach((i) => (r.hands[i] = { name: t.seats[i].name, bet: r.bets[i], cards: [], status: 'playing', doubled: false }));
    for (let k = 0; k < 2; k++) seats.forEach((i) => r.hands[i].cards.push(r.deck.pop()));
    r.dealer = [r.deck.pop(), r.deck.pop()];
    seats.forEach((i) => {
      if (isBlackjack(r.hands[i].cards)) r.hands[i].status = 'blackjack';
    });
    r.phase = 'playing';
    r.order = seats;
    r.turn = -1;
    // Dealer har blackjack: ingen spiller, rett til oppgjør
    if (isBlackjack(r.dealer)) return bjDealer();
    bjNextTurn();
  }

  function bjNextTurn() {
    const t = bjt();
    const r = t.round;
    const next = r.order.find((i) => r.hands[i].status === 'playing');
    if (next === undefined) return bjDealer();
    r.turn = next;
    r.deadline = Date.now() + BJ_TURN_MS;
    bjSchedule(BJ_TURN_MS, () => {
      // Tiden er ute: står automatisk
      const s = t.seats[next];
      if (s) s.strikes = (s.strikes || 0) + 1;
      bjStand(next);
    });
    bjNotify();
  }

  function bjStand(i) {
    const r = bjt().round;
    if (!r || r.phase !== 'playing' || !r.hands[i]) return;
    if (r.hands[i].status === 'playing') r.hands[i].status = 'stand';
    if (r.turn === i) bjNextTurn();
  }

  function bjAct(p, action) {
    const t = bjt();
    const r = t.round;
    const i = bjSeatOf(p.name);
    if (!r || r.phase !== 'playing' || r.turn !== i || i < 0) throw new Error('Det er ikke din tur.');
    const h = r.hands[i];
    t.seats[i].strikes = 0;
    if (action === 'hit') {
      h.cards.push(r.deck.pop());
      const v = handValue(h.cards);
      if (v > 21) h.status = 'bust';
      else if (v === 21) h.status = 'stand';
      if (h.status !== 'playing') return bjNextTurn();
      // Ny tid for neste valg
      r.deadline = Date.now() + BJ_TURN_MS;
      bjSchedule(BJ_TURN_MS, () => bjStand(i));
      return bjNotify();
    }
    if (action === 'stand') return bjStand(i);
    if (action === 'double') {
      if (h.cards.length !== 2) throw new Error('Du kan bare doble på de to første kortene.');
      if ((p.flus || 0) < h.bet) throw new Error(`Du trenger ${h.bet} cash til for å doble.`);
      ctx.addFlus(p, -h.bet);
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(r.deck.pop());
      h.status = handValue(h.cards) > 21 ? 'bust' : 'stand';
      return bjNextTurn();
    }
    throw new Error('Ukjent handling.');
  }

  // Dealeren snur kortet og trekker til 17, ett kort om gangen
  function bjDealer() {
    const r = bjt().round;
    r.phase = 'dealer';
    r.turn = -1;
    r.deadline = 0;
    const anyAlive = r.order.some((i) => ['stand', 'blackjack'].includes(r.hands[i].status));
    const step = () => {
      if (anyAlive && handValue(r.dealer) < 17 && !isBlackjack(r.dealer)) {
        r.dealer.push(r.deck.pop());
        bjNotify();
        bjSchedule(BJ_DEALER_STEP_MS, step);
      } else bjSettle();
    };
    bjNotify();
    bjSchedule(BJ_DEALER_STEP_MS, step);
  }

  function bjSettle() {
    const t = bjt();
    const r = t.round;
    const dv = handValue(r.dealer);
    const dealerBJ = isBlackjack(r.dealer);
    const results = [];
    r.order.forEach((i) => {
      const h = r.hands[i];
      const pv = handValue(h.cards);
      let result;
      let payout = 0;
      if (h.status === 'bust') result = 'bust';
      else if (h.status === 'blackjack' && !dealerBJ) {
        result = 'blackjack';
        payout = h.bet + Math.max(1, Math.floor(h.bet * 1.5));
      } else if (dealerBJ && h.status !== 'blackjack') result = 'dealer-blackjack';
      else if (dealerBJ) {
        result = 'push';
        payout = h.bet;
      } else if (dv > 21) {
        result = 'dealer-bust';
        payout = h.bet * 2;
      } else if (pv > dv) {
        result = 'win';
        payout = h.bet * 2;
      } else if (pv === dv) {
        result = 'push';
        payout = h.bet;
      } else result = 'lose';
      const p = ctx.findParticipant(h.name);
      if (p && payout) ctx.addFlus(p, payout);
      h.result = result;
      h.payout = payout;
      if (p) ctx.onWin(h.name, 'blackjack', payout > h.bet ? payout : 0, payout - h.bet, result);
      results.push({ seat: i, name: h.name, result, bet: h.bet, payout, value: pv });
    });
    r.phase = 'result';
    r.resultUntil = Date.now() + BJ_RESULT_MS;
    t.lastResult = { id: r.id, results };
    bjNotify();
    bjSchedule(BJ_RESULT_MS, () => {
      // Rydd opp: de som gikk eller sov for lenge, forlater bordet
      t.seats.forEach((s, i) => {
        if (s && (s.leaving || (s.strikes || 0) >= 2)) t.seats[i] = null;
      });
      t.round = null;
      bjNotify();
    });
  }

  function bjView(viewer, avatars) {
    const t = bjt();
    const r = t.round;
    const mySeat = viewer ? bjSeatOf(viewer.name) : -1;
    const showDealer = r && ['dealer', 'result'].includes(r.phase);
    return {
      seats: t.seats.map((s, i) => {
        if (!s) return null;
        const h = r && r.hands && r.hands[i];
        return {
          name: s.name,
          avatar: avatars[s.name] || null,
          bet: h ? h.bet : r && r.bets ? r.bets[i] || 0 : 0,
          cards: h ? h.cards : null,
          value: h ? handValue(h.cards) : null,
          status: h ? h.status : null,
          result: h ? h.result || null : null,
          payout: h ? h.payout || 0 : 0,
        };
      }),
      phase: r ? r.phase : 'waiting',
      roundId: r ? r.id : null,
      dealer: r && r.dealer ? (showDealer ? r.dealer : [r.dealer[0], { hidden: true }]) : [],
      dealerValue: r && r.dealer ? (showDealer ? handValue(r.dealer) : handValue([r.dealer[0]])) : null,
      turn: r && r.phase === 'playing' ? r.turn : -1,
      deadline: r && r.phase === 'playing' ? r.deadline : 0,
      bettingEndsAt: r && r.phase === 'betting' ? r.bettingEndsAt : 0,
      mySeat,
      canDouble: !!(r && r.phase === 'playing' && r.turn === mySeat && r.hands[mySeat].cards.length === 2 && viewer && (viewer.flus || 0) >= r.hands[mySeat].bet),
      minBet: ctx.minBet,
      maxBet: ctx.maxBet,
    };
  }

  // =========================================================
  // Roulette
  // =========================================================
  function rlt() {
    const s = ctx.state();
    if (!s.rouletteTable) s.rouletteTable = { phase: 'open', bets: [], history: [], last: null };
    return s.rouletteTable;
  }
  const rlNotify = () => {
    ctx.save();
    ctx.broadcast('roulette', {});
  };

  function rlSchedule(ms, fn) {
    clearTimeout(timers.rl);
    timers.rl = setTimeout(fn, Math.max(0, ms));
  }

  function rlBet(p, type, amount) {
    const t = rlt();
    if (!RL_BETS[type]) throw new Error('Velg rød, svart, partall eller oddetall.');
    if (!['open', 'betting'].includes(t.phase)) throw new Error('Hjulet spinner. Vent til neste runde.');
    const bet = Math.floor(Number(amount));
    if (!Number.isFinite(bet) || bet < ctx.minBet) throw new Error(`Minste innsats er ${ctx.minBet} cash.`);
    const mine = t.bets.filter((b) => b.name === p.name).reduce((sum, b) => sum + b.amount, 0);
    if (mine + bet > ctx.maxBet) throw new Error(`Du kan satse maks ${ctx.maxBet} cash per runde (du har satset ${mine}).`);
    if (bet > (p.flus || 0)) throw new Error(`Du har bare ${p.flus || 0} cash.`);
    ctx.addFlus(p, -bet);
    const same = t.bets.find((b) => b.name === p.name && b.type === type);
    if (same) same.amount += bet;
    else t.bets.push({ name: p.name, type, amount: bet });
    if (t.phase === 'open') {
      t.phase = 'betting';
      t.round = `${Date.now()}`;
      t.spinAt = Date.now() + RL_BET_MS;
      rlSchedule(RL_BET_MS, rlSpin);
    }
    rlNotify();
  }

  function rlClear(p) {
    const t = rlt();
    if (t.phase !== 'betting') throw new Error('Du kan bare ta tilbake innsatser før hjulet spinner.');
    const mine = t.bets.filter((b) => b.name === p.name);
    if (!mine.length) throw new Error('Du har ingen innsatser denne runden.');
    ctx.addFlus(p, mine.reduce((sum, b) => sum + b.amount, 0));
    t.bets = t.bets.filter((b) => b.name !== p.name);
    rlNotify();
  }

  function rlSpin() {
    const t = rlt();
    if (t.phase !== 'betting') return;
    t.number = ctx.randomInt(37);
    t.phase = 'spinning';
    t.resultAt = Date.now() + RL_SPIN_MS;
    rlNotify();
    rlSchedule(RL_SPIN_MS, rlSettle);
  }

  function rlSettle() {
    const t = rlt();
    const n = t.number;
    const winners = {};
    t.bets.forEach((b) => {
      if (!RL_BETS[b.type].wins(n)) return;
      const p = ctx.findParticipant(b.name);
      if (p) ctx.addFlus(p, b.amount * 2);
      winners[b.name] = (winners[b.name] || 0) + b.amount * 2;
    });
    // Logg én gang per spiller (gevinst minus det de satset totalt)
    const staked = {};
    t.bets.forEach((b) => (staked[b.name] = (staked[b.name] || 0) + b.amount));
    Object.keys(staked).forEach((name) => {
      const won = winners[name] || 0;
      ctx.onWin(name, 'roulette', won, won - staked[name], `${n}`);
    });
    t.history.unshift(n);
    t.history = t.history.slice(0, 12);
    t.last = { round: t.round, number: n, bets: t.bets, winners };
    t.phase = 'result';
    t.resultUntil = Date.now() + RL_RESULT_MS;
    rlNotify();
    rlSchedule(RL_RESULT_MS, () => {
      t.phase = 'open';
      t.bets = [];
      t.number = null;
      rlNotify();
    });
  }

  function rlView(viewer, avatars) {
    const t = rlt();
    const showNumber = ['spinning', 'result'].includes(t.phase);
    const totals = {};
    Object.keys(RL_BETS).forEach((k) => (totals[k] = { total: 0, players: [] }));
    t.bets.forEach((b) => {
      totals[b.type].total += b.amount;
      totals[b.type].players.push({ name: b.name, avatar: avatars[b.name] || null, amount: b.amount });
    });
    return {
      phase: t.phase,
      round: t.round || null,
      spinAt: t.phase === 'betting' ? t.spinAt : 0,
      resultAt: t.phase === 'spinning' ? t.resultAt : 0,
      number: showNumber ? t.number : null,
      bets: totals,
      myBets: viewer ? t.bets.filter((b) => b.name === viewer.name) : [],
      history: t.history,
      last: t.phase === 'result' && t.last ? { number: t.last.number, myWin: viewer ? t.last.winners[viewer.name] || 0 : 0, winners: t.last.winners } : null,
      minBet: ctx.minBet,
      maxBet: ctx.maxBet,
    };
  }

  // =========================================================
  // Etter omstart: avbryt runder som var i gang, med innsatsen tilbake
  // =========================================================
  function restore() {
    const b = bjt();
    const r = b.round;
    // En runde som allerede er gjort opp (resultat vises) skal ikke betales tilbake
    if (r && r.phase !== 'result') {
      if (r.hands) {
        Object.values(r.hands).forEach((h) => {
          const p = ctx.findParticipant(h.name);
          if (p) ctx.addFlus(p, h.bet);
        });
      } else {
        Object.entries(r.bets).forEach(([i, amount]) => {
          const seat = b.seats[i];
          const p = seat && ctx.findParticipant(seat.name);
          if (p) ctx.addFlus(p, amount);
        });
      }
    }
    b.round = null;
    b.seats.forEach((seat, i) => seat && seat.leaving && (b.seats[i] = null));
    const t = rlt();
    if (['betting', 'spinning'].includes(t.phase)) {
      t.bets.forEach((x) => {
        const p = ctx.findParticipant(x.name);
        if (p) ctx.addFlus(p, x.amount);
      });
    }
    t.phase = 'open';
    t.bets = [];
    t.number = null;
    ctx.save();
  }

  function rename(oldName, newName) {
    bjt().seats.forEach((s) => s && s.name === oldName && (s.name = newName));
    const r = bjt().round;
    if (r && r.hands) Object.values(r.hands).forEach((h) => h.name === oldName && (h.name = newName));
    rlt().bets.forEach((b) => b.name === oldName && (b.name = newName));
  }

  return {
    bj: { sit: bjSit, leave: bjLeave, bet: bjBet, act: bjAct, view: bjView, seatOf: bjSeatOf },
    roulette: { bet: rlBet, clear: rlClear, view: rlView },
    restore,
    rename,
  };
}

module.exports = { createTables, handValue, BJ_SEATS };
