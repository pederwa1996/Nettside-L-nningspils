'use strict';

// Pokerbordet i kasinoet: tegner bordet, sender handlinger og oppdateres live.
(function () {
  const $ = (id) => document.getElementById(id);
  const SEATS = 9;
  let t = null; // bordet slik serveren viser det for meg
  let me = null;
  let celebrated; // id på siste hånd vi har feiret (undefined = ikke lastet ennå)
  let busy = false;
  let buyInSeat = -1;
  let tick = null;
  let raiseOpen = false;
  const fx = window.cardFx('poker');

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

  const card = (c, size, key) => fx.card(c, size, key);

  function msg(text, kind = '') {
    $('pk-msg').textContent = text;
    $('pk-msg').className = 'result ' + kind;
  }

  const PHASE = { preflop: 'Før floppen', flop: 'Floppen', turn: 'Turn', river: 'River' };

  // Plassene står i en ellipse rundt bordet. Sitter du, står du alltid nederst.
  function seatPos(seat) {
    const v = t.mySeat >= 0 ? (seat - t.mySeat + SEATS) % SEATS : seat;
    const angle = (Math.PI / 2) + (v * 2 * Math.PI) / SEATS;
    return { x: 50 + 42 * Math.cos(angle), y: 50 + 44 * Math.sin(angle) };
  }

  function render() {
    if (!t) return;
    fx.begin();
    const seatsEl = $('pk-seats');
    seatsEl.innerHTML = '';
    const winners = new Set(t.result ? t.result.winners.map((w) => w.seat) : []);
    t.seats.forEach((s, i) => {
      const pos = seatPos(i);
      const wrap = el('div', 'pk-seat');
      wrap.style.left = `${pos.x}%`;
      wrap.style.top = `${pos.y}%`;
      if (!s) {
        wrap.classList.add('empty');
        if (t.mySeat < 0 && me) {
          const b = el('button', 'pk-sit', '+');
          b.type = 'button';
          b.title = 'Sett deg her';
          b.addEventListener('click', () => openBuyIn(i));
          wrap.appendChild(b);
        } else wrap.appendChild(el('div', 'pk-empty-dot'));
        seatsEl.appendChild(wrap);
        return;
      }
      if (i === t.toAct) wrap.classList.add('turn');
      if (s.folded) wrap.classList.add('folded');
      if (winners.has(i)) wrap.classList.add('winner');
      if (i === t.mySeat) wrap.classList.add('mine');
      const av = el('div', 'pk-avatar');
      av.appendChild(avatarEl(s.avatar, s.name, 32));
      if (i === t.button) av.appendChild(el('span', 'pk-dealer', 'D'));
      wrap.appendChild(av);
      if (i === t.toAct && t.deadline) {
        const bar = el('div', 'pk-timer');
        bar.appendChild(el('span'));
        wrap.appendChild(bar);
      }
      wrap.appendChild(el('div', 'pk-name', s.name.split(' ')[0]));
      wrap.appendChild(el('div', 'pk-chips', s.allIn ? 'ALL IN' : `${s.chips}`));
      if (s.last && t.phase !== 'result') wrap.appendChild(el('div', 'pk-last', s.last));
      if (s.shownHand) wrap.appendChild(el('div', 'pk-last shown', s.shownHand));
      // Kort (ikke mine, de vises stort under bordet)
      if (s.cards && i !== t.mySeat) {
        const cards = el('div', 'pk-seat-cards');
        s.cards.forEach((c, j) => cards.appendChild(card(c, 'tiny', `seat${i}:${j}`)));
        wrap.appendChild(cards);
      }
      seatsEl.appendChild(wrap);
      // Innsats denne runden: en sjetong mellom plassen og midten
      if (s.bet > 0) {
        const chip = el('div', 'pk-bet', String(s.bet));
        chip.style.left = `${50 + (pos.x - 50) * 0.55}%`;
        chip.style.top = `${50 + (pos.y - 50) * 0.55}%`;
        seatsEl.appendChild(chip);
      }
    });

    // Midten: kortene på bordet, potten og status
    const board = $('pk-board');
    board.innerHTML = '';
    for (let i = 0; i < 5; i++) board.appendChild(t.board[i] ? card(t.board[i], '', `board${i}`) : el('div', 'pk-card slot'));
    $('pk-pot').textContent = t.pot ? `🪙 ${t.pot}` : '';
    let status = '';
    if (t.phase === 'result' && t.result) {
      status = t.result.winners
        .map((w) => `🏆 ${w.name} vant ${w.amount}${w.hand ? ` med ${w.hand.toLowerCase()}` : ''}`)
        .join('\n');
    } else if (t.phase === 'waiting') {
      const seated = t.seats.filter(Boolean).length;
      status = seated < 2 ? 'Venter på spillere … (minst 2)' : 'Ny hånd starter snart …';
    } else status = PHASE[t.phase] || '';
    $('pk-status').textContent = status;

    // Vant jeg potten? Feire én gang per hånd (ikke for en hånd som var ferdig da siden ble åpnet)
    if (t.result && t.result.id !== celebrated) {
      const mine = t.result.winners.find((w) => w.seat === t.mySeat);
      if (mine && celebrated !== undefined && window.celebrate) {
        celebrate({ tier: mine.amount >= 200 ? 'big' : 'win', amount: mine.amount, title: 'POTTEN ER DIN!', voice: 'v_potten', icon: '♠️', sub: mine.hand ? `Med ${mine.hand.toLowerCase()}` : 'Alle de andre kastet seg' });
      }
      celebrated = t.result.id;
    } else if (!t.result && celebrated === undefined) celebrated = null;

    // Mine kort og handlinger
    const mine = t.mySeat >= 0 ? t.seats[t.mySeat] : null;
    $('pk-mine').classList.toggle('hidden', !mine);
    $('pk-leave').classList.toggle('hidden', !mine);
    if (mine) {
      const mc = $('pk-my-cards');
      mc.innerHTML = '';
      (mine.cards || []).forEach((c, j) => mc.appendChild(card(c, 'big', `mine${j}`)));
      $('pk-my-hand').textContent = mine.folded ? 'Kastet' : t.myHand || (mine.inHand ? '' : 'Neste hånd');
      $('pk-my-hand').classList.toggle('dim', !!mine.folded || !t.myHand);
      $('pk-my-info').textContent = `🪙 ${mine.chips} sjetonger`;
    }
    fx.end();

    // Handlinger: bare når det er min tur
    const l = t.legal;
    $('pk-actions').classList.toggle('hidden', !l);
    if (!l) raiseOpen = false;
    if (l) {
      $('pk-call').textContent = l.canCheck ? 'Sjekk' : `Syn ${l.toCall}`;
      $('pk-raise-open').disabled = !l.canRaise;
      $('pk-raise-open').classList.toggle('open', raiseOpen);
      $('pk-raise-box').classList.toggle('hidden', !(raiseOpen && l.canRaise));
      const r = $('pk-raise-range');
      r.min = l.minRaiseTo;
      r.max = l.maxRaiseTo;
      if (!(Number(r.value) >= l.minRaiseTo && Number(r.value) <= l.maxRaiseTo)) r.value = l.minRaiseTo;
      renderPresets(l);
      showRaise();
    }
    // Sitter jeg, men det er ikke min tur: vis hvem vi venter på
    const waiting = mine && !l && t.toAct >= 0 && t.seats[t.toAct] && mine.inHand && !mine.folded;
    $('pk-wait').classList.toggle('hidden', !waiting);
    if (waiting) $('pk-wait').textContent = `Venter på ${t.seats[t.toAct].name.split(' ')[0]} …`;

    // Info for tilskuere
    const free = t.seats.filter((s) => !s).length;
    let info = `Blinds ${t.blinds.small}/${t.blinds.big} · Innkjøp ${t.minBuyIn}–${t.maxBuyIn} cash`;
    if (t.mySeat < 0) {
      if (!me) info = 'Registrer deg for å spille. Du kan se på.';
      else if (!free) info = '👀 Bordet er fullt. Du ser på, og kan sette deg når en plass blir ledig.';
      else info = `👀 Du ser på. Trykk + på en ledig plass for å sette deg. ${info}`;
    }
    $('pk-info').textContent = info;
    updateTimer();

    // Lyd: kort som deles ut og sjetonger på bordet
    if (window.sfx && document.body.dataset.tab === 'poker') {
      sfx.watch('pk-chips', t.pot + t.seats.reduce((n, s) => n + (s ? s.bet || 0 : 0), 0), 'chip');
    }
  }

  function updateTimer() {
    if (!t || !t.deadline) return;
    const pct = `${(Math.max(0, t.deadline - Date.now()) / 30000) * 100}%`;
    const bar = document.querySelector('.pk-timer span');
    if (bar) bar.style.width = pct;
    $('pk-turn-bar').style.width = pct;
  }

  // ---------- Høyne: snarveier og finjustering ----------
  function renderPresets(l) {
    // Potten (alt som er satset) og hva bordet står i nå
    const myBet = t.seats[t.mySeat] ? t.seats[t.mySeat].bet || 0 : 0;
    const current = myBet + l.toCall;
    const after = t.pot + l.toCall; // potten etter at jeg har synt
    const clamp = (v) => Math.min(l.maxRaiseTo, Math.max(l.minRaiseTo, Math.round(v / 5) * 5));
    const opts = [
      ['Min', l.minRaiseTo],
      ['½ pott', clamp(current + after / 2)],
      ['Pott', clamp(current + after)],
      ['All in', l.maxRaiseTo],
    ];
    const wrap = $('pk-presets');
    wrap.innerHTML = '';
    const cur = Number($('pk-raise-range').value);
    opts.forEach(([label, v], i) => {
      if (i > 0 && i < 3 && (v <= l.minRaiseTo || v >= l.maxRaiseTo)) return; // like Min eller All in: hopp over
      const b = el('button', `tc-preset${v === cur ? ' active' : ''}`, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        $('pk-raise-range').value = v;
        renderPresets(l);
        showRaise();
      });
      wrap.appendChild(b);
    });
  }

  function showRaise() {
    const l = t && t.legal;
    if (!l) return;
    const v = Number($('pk-raise-range').value);
    const all = v >= l.maxRaiseTo;
    $('pk-raise').innerHTML = all ? `ALL IN · ${v}` : `Høyne til <span id="pk-raise-to">${v}</span>`;
    $('pk-raise').classList.toggle('allin', all);
  }

  // ---------- Innkjøp ----------
  function openBuyIn(seat) {
    buyInSeat = seat;
    const max = Math.min(t.maxBuyIn, me.flus);
    if (max < t.minBuyIn) return msg(`Du trenger minst ${t.minBuyIn} cash for å sette deg. Du har ${me.flus}.`, 'lose');
    const r = $('pk-buyin-range');
    r.min = t.minBuyIn;
    r.max = max;
    r.value = Math.min(Math.max(200, t.minBuyIn), max);
    $('pk-buyin-seat').textContent = seat + 1;
    renderBuyIn();
    $('pk-buyin').classList.remove('hidden');
    $('pk-buyin').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderBuyIn() {
    const r = $('pk-buyin-range');
    const min = Number(r.min);
    const max = Number(r.max);
    $('pk-buyin-amount').textContent = r.value;
    const wrap = $('pk-buyin-presets');
    wrap.innerHTML = '';
    [...new Set([min, 200, 500, max])].filter((v) => v >= min && v <= max).sort((a, b) => a - b).forEach((v) => {
      const b = el('button', `tc-preset${v === Number(r.value) ? ' active' : ''}`, v === max ? `Maks ${v}` : v === min ? `Min ${v}` : String(v));
      b.type = 'button';
      b.addEventListener('click', () => {
        r.value = v;
        renderBuyIn();
      });
      wrap.appendChild(b);
    });
  }

  $('pk-buyin-range').addEventListener('input', renderBuyIn);
  $('pk-buyin-cancel').addEventListener('click', () => $('pk-buyin').classList.add('hidden'));
  $('pk-buyin-ok').addEventListener('click', () => send('/api/poker/sit', { seat: buyInSeat, buyIn: Number($('pk-buyin-range').value) }, () => $('pk-buyin').classList.add('hidden')));
  $('pk-leave').addEventListener('click', () => {
    if (confirm('Reise deg fra bordet? Sjetongene går tilbake som cash. Er du med i en hånd, kaster du den.')) send('/api/poker/leave', {});
  });

  // ---------- Handlinger ----------
  $('pk-fold').addEventListener('click', () => send('/api/poker/action', { action: 'fold' }));
  $('pk-call').addEventListener('click', () => send('/api/poker/action', { action: t.legal && t.legal.canCheck ? 'check' : 'call' }));
  $('pk-raise-open').addEventListener('click', () => {
    raiseOpen = !raiseOpen;
    render();
  });
  $('pk-raise-range').addEventListener('input', () => {
    if (t && t.legal) renderPresets(t.legal);
    showRaise();
  });
  const nudge = (dir) => {
    const r = $('pk-raise-range');
    const step = Math.max(5, (t && t.blinds ? t.blinds.big : 10));
    r.value = Math.min(Number(r.max), Math.max(Number(r.min), Number(r.value) + dir * step));
    if (t && t.legal) renderPresets(t.legal);
    showRaise();
  };
  $('pk-minus').addEventListener('click', () => nudge(-1));
  $('pk-plus').addEventListener('click', () => nudge(1));
  $('pk-raise').addEventListener('click', () => {
    const l = t && t.legal;
    const v = Number($('pk-raise-range').value);
    raiseOpen = false;
    if (l && v >= l.maxRaiseTo) send('/api/poker/action', { action: 'allin' });
    else send('/api/poker/action', { action: 'raise', amount: v });
  });

  async function send(path, body, onOk) {
    if (busy) return;
    busy = true;
    msg('');
    try {
      const r = await api(path, body);
      t = r.table;
      me = r.me;
      if (onOk) onOk();
      render();
      updateWallet();
    } catch (err) {
      msg(err.message, 'lose');
    }
    busy = false;
  }

  // Lommeboka øverst i kasinoet
  function updateWallet() {
    if (!me) return;
    const f = $('my-flus');
    if (f) f.textContent = me.flus;
  }

  async function refresh() {
    try {
      const r = await api('/api/poker');
      t = r.table;
      me = r.me;
      render();
      updateWallet();
    } catch (err) {
      console.error(err);
    }
  }

  window.refreshPoker = refresh;
  onLive('poker', () => !busy && refresh());
  setInterval(() => document.visibilityState === 'visible' && !$('tab-poker').classList.contains('hidden') && refresh(), 8000);
  clearInterval(tick);
  tick = setInterval(updateTimer, 250);
  refresh();
})();
