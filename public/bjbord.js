'use strict';

// Felles blackjack-bord i kasinoet: 5 plasser rundt et bord, dealeren øverst.
// Man må sette seg for å spille; alle andre ser på. Oppdateres live.
(function () {
  const $ = (id) => document.getElementById(id);
  const SEATS = 5;
  // Plassene i en bue under dealeren (prosent av bordet)
  const POS = [
    { x: 11, y: 52 },
    { x: 29, y: 70 },
    { x: 50, y: 77 },
    { x: 71, y: 70 },
    { x: 89, y: 52 },
  ];
  const CHIPS = [10, 25, 50, 100, 200];
  let t = null;
  let me = null;
  let bet = 25;
  let busy = false;
  let tick = null;
  let celebrated; // runde-id vi har feiret (undefined = ikke lastet ennå)

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {});
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
    return json;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function card(c, size = '') {
    const d = el('div', `pk-card ${size}`);
    if (!c || c.hidden) {
      d.classList.add('back');
      return d;
    }
    if (c.s === '♥' || c.s === '♦') d.classList.add('red');
    d.append(el('span', 'pk-rank', c.r), el('span', 'pk-suit', c.s));
    return d;
  }

  function msg(text, kind = '') {
    $('bj-msg').textContent = text;
    $('bj-msg').className = `result ${kind}`;
  }

  const secs = (at) => Math.max(0, Math.ceil((at - Date.now()) / 1000));
  const RESULT = {
    blackjack: ['BLACKJACK!', 'win'],
    win: ['Vant', 'win'],
    'dealer-bust': ['Vant', 'win'],
    push: ['Likt', ''],
    lose: ['Tapte', 'lose'],
    bust: ['Over 21', 'lose'],
    'dealer-blackjack': ['Tapte', 'lose'],
  };

  function statusText() {
    if (t.phase === 'waiting') return t.seats.some(Boolean) ? 'Plasser innsatsen for å starte runden' : 'Ledig bord. Sett deg og spill!';
    if (t.phase === 'betting') return `Innsatser … deler ut om ${secs(t.bettingEndsAt)} s`;
    if (t.phase === 'playing') {
      const s = t.seats[t.turn];
      return s ? `${t.turn === t.mySeat ? 'Din tur' : `${s.name.split(' ')[0]} sin tur`} · ${secs(t.deadline)} s` : '';
    }
    if (t.phase === 'dealer') return 'Dealeren trekker …';
    return t.dealerValue > 21 ? 'Dealeren gikk over 21! 💥' : `Dealeren fikk ${t.dealerValue}`;
  }

  function render() {
    if (!t) return;
    // Dealer
    const dc = $('bj-dealer-cards');
    dc.innerHTML = '';
    t.dealer.forEach((c) => dc.appendChild(card(c)));
    $('bj-dealer-value').textContent = t.dealerValue === null ? '' : t.dealerValue;
    $('bj-status').textContent = statusText();

    // Plassene
    const seatsEl = $('bj-seats');
    seatsEl.innerHTML = '';
    t.seats.forEach((s, i) => {
      const wrap = el('div', 'bj-seat');
      wrap.style.left = `${POS[i].x}%`;
      wrap.style.top = `${POS[i].y}%`;
      if (!s) {
        wrap.classList.add('empty');
        if (t.mySeat < 0 && me) {
          const b = el('button', 'pk-sit', '+');
          b.type = 'button';
          b.title = 'Sett deg her';
          b.addEventListener('click', () => send('/api/bj/sit', { seat: i }, 'Velkommen til bordet! Velg innsats og trykk «Sats».'));
          wrap.appendChild(b);
        } else wrap.appendChild(el('div', 'pk-empty-dot'));
        seatsEl.appendChild(wrap);
        return;
      }
      if (i === t.mySeat) wrap.classList.add('mine');
      if (i === t.turn) wrap.classList.add('turn');
      if (s.result) wrap.classList.add(`res-${RESULT[s.result][1] || 'push'}`);
      if (s.cards) {
        const cards = el('div', 'bj-seat-cards');
        s.cards.forEach((c) => cards.appendChild(card(c, 'tiny')));
        wrap.appendChild(cards);
      }
      const av = el('div', 'pk-avatar');
      av.appendChild(avatarEl(s.avatar, s.name, 32));
      wrap.appendChild(av);
      wrap.appendChild(el('div', 'pk-name', i === t.mySeat ? 'Deg' : s.name.split(' ')[0]));
      if (s.value !== null) wrap.appendChild(el('div', 'bj-val', s.value > 21 ? `${s.value} 💥` : String(s.value)));
      if (s.result) {
        const [label, cls] = RESULT[s.result];
        wrap.appendChild(el('div', `bj-res ${cls}`, s.payout > s.bet ? `${label} +${s.payout}` : label));
      } else if (s.bet) wrap.appendChild(el('div', 'pk-chips', `🪙 ${s.bet}`));
      if (i === t.turn && t.deadline) {
        const bar = el('div', 'pk-timer');
        const fill = el('span');
        fill.style.width = `${Math.min(100, ((t.deadline - Date.now()) / 20000) * 100)}%`;
        bar.appendChild(fill);
        wrap.appendChild(bar);
      }
      seatsEl.appendChild(wrap);
    });

    // Kontroller
    const seated = t.mySeat >= 0;
    const mine = seated ? t.seats[t.mySeat] : null;
    const canBet = seated && ['waiting', 'betting'].includes(t.phase);
    $('bj-bet').classList.toggle('hidden', !canBet);
    if (canBet) renderChips(mine.bet);
    $('bj-actions').classList.toggle('hidden', !(t.phase === 'playing' && t.turn === t.mySeat && seated));
    $('bj-double').classList.toggle('hidden', !t.canDouble);
    $('bj-leave').classList.toggle('hidden', !seated);
    const watchers = t.seats.filter(Boolean).length;
    $('bj-info').textContent = seated
      ? `Du sitter ved bordet. ${watchers} av ${SEATS} plasser er tatt.`
      : me ? `👀 Du ser på. Trykk + på en ledig plass for å sette deg. Innsats ${t.minBet}–${t.maxBet} cash.` : 'Registrer deg for å spille. Du kan se på.';

    // Feiring når runden er ferdig
    if (t.phase === 'result' && t.roundId !== celebrated) {
      if (celebrated !== undefined && mine && mine.result && window.celebrate) {
        const [label] = RESULT[mine.result];
        if (mine.payout > mine.bet) {
          celebrate({ tier: mine.result === 'blackjack' || mine.payout >= 200 ? 'big' : 'win', amount: mine.payout, title: mine.result === 'blackjack' ? 'BLACKJACK!' : 'DU VANT!', icon: '🃏', sub: mine.result === 'dealer-bust' ? 'Dealeren gikk over 21!' : `${mine.value} mot dealerens ${t.dealerValue}` });
        } else if (mine.payout < mine.bet) {
          msg(`${label}. Du tapte ${mine.bet} cash.`, 'lose');
          if (window.loseNudge) loseNudge($('bj-msg'));
        } else msg('Likt med dealeren. Du får innsatsen tilbake.');
      }
      celebrated = t.roundId;
    } else if (t.phase !== 'result' && celebrated === undefined) celebrated = null;
  }

  function renderChips(current) {
    const wrap = $('bj-chips');
    wrap.innerHTML = '';
    const cash = me ? me.flus + (current || 0) : 0;
    CHIPS.filter((c) => c >= t.minBet && c <= t.maxBet).forEach((c) => {
      const b = el('button', `chip${c === bet ? ' active' : ''}`, String(c));
      b.type = 'button';
      b.disabled = c > cash;
      b.addEventListener('click', () => {
        bet = c;
        renderChips(current);
      });
      wrap.appendChild(b);
    });
    $('bj-bet-amount').textContent = bet;
    $('bj-bet-btn').textContent = current ? `Endre innsats til ${bet}` : `Sats ${bet} cash`;
  }

  async function send(path, body, okText) {
    if (busy) return;
    busy = true;
    try {
      const r = await api(path, body);
      t = r.table;
      me = r.me;
      if (window.casinoSetWallet) window.casinoSetWallet(r.me);
      if (okText) msg(okText, 'win');
      render();
    } catch (err) {
      msg(err.message, 'lose');
    }
    busy = false;
  }

  $('bj-bet-btn').addEventListener('click', () => send('/api/bj/bet', { amount: bet }, ''));
  $('bj-hit').addEventListener('click', () => send('/api/bj/act', { action: 'hit' }));
  $('bj-stand').addEventListener('click', () => send('/api/bj/act', { action: 'stand' }));
  $('bj-double').addEventListener('click', () => send('/api/bj/act', { action: 'double' }));
  $('bj-leave').addEventListener('click', () => {
    if (confirm('Reise deg fra bordet? Er du med i en runde, står du og går etterpå.')) send('/api/bj/leave', {}, 'Du har forlatt bordet.');
  });

  async function load() {
    try {
      const r = await api('/api/bj');
      t = r.table;
      me = r.me;
      if (r.me && window.casinoSetWallet) window.casinoSetWallet(r.me);
      render();
    } catch { /* ignorer */ }
  }
  window.refreshBj = load;

  onLive('bj', () => !busy && load());
  // Nedtellinger og tidsstolper
  clearInterval(tick);
  tick = setInterval(() => {
    if (t && ['betting', 'playing'].includes(t.phase) && document.body.dataset.tab === 'blackjack') render();
  }, 1000);
  load();
})();
