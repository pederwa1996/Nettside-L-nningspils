'use strict';

// Pokerbordet i kasinoet: tegner bordet, sender handlinger og oppdateres live.
(function () {
  const $ = (id) => document.getElementById(id);
  const SEATS = 9;
  let t = null; // bordet slik serveren viser det for meg
  let me = null;
  let busy = false;
  let buyInSeat = -1;
  let tick = null;

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
      av.appendChild(avatarEl(s.avatar, s.name, 40));
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
        s.cards.forEach((c) => cards.appendChild(card(c, 'tiny')));
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
    for (let i = 0; i < 5; i++) board.appendChild(t.board[i] ? card(t.board[i]) : el('div', 'pk-card slot'));
    $('pk-pot').textContent = t.pot ? `Pott: ${t.pot}` : '';
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

    // Mine kort og handlinger
    const mine = t.mySeat >= 0 ? t.seats[t.mySeat] : null;
    $('pk-mine').classList.toggle('hidden', !mine);
    $('pk-leave').classList.toggle('hidden', !mine);
    if (mine) {
      const mc = $('pk-my-cards');
      mc.innerHTML = '';
      (mine.cards || []).forEach((c) => mc.appendChild(card(c, 'big')));
      $('pk-my-info').textContent = mine.folded ? 'Du har kastet denne hånden' : mine.inHand ? `Du har ${mine.chips} i sjetonger` : `Du har ${mine.chips} i sjetonger · venter på neste hånd`;
    }
    const l = t.legal;
    $('pk-actions').classList.toggle('hidden', !l);
    if (l) {
      $('pk-call').textContent = l.canCheck ? 'Sjekk' : `Syn ${l.toCall}`;
      $('pk-raise-box').classList.toggle('hidden', !l.canRaise);
      const r = $('pk-raise-range');
      r.min = l.minRaiseTo;
      r.max = l.maxRaiseTo;
      if (!(Number(r.value) >= l.minRaiseTo && Number(r.value) <= l.maxRaiseTo)) r.value = l.minRaiseTo;
      $('pk-raise-to').textContent = r.value;
    }

    // Info for tilskuere
    const free = t.seats.filter((s) => !s).length;
    let info = `Blinds ${t.blinds.small}/${t.blinds.big} · Innkjøp ${t.minBuyIn}–${t.maxBuyIn} flus`;
    if (t.mySeat < 0) {
      if (!me) info = 'Registrer deg for å spille. Du kan se på.';
      else if (!free) info = '👀 Bordet er fullt. Du ser på, og kan sette deg når en plass blir ledig.';
      else info = `👀 Du ser på. Trykk + på en ledig plass for å sette deg. ${info}`;
    }
    $('pk-info').textContent = info;
    updateTimer();
  }

  function updateTimer() {
    const bar = document.querySelector('.pk-timer span');
    if (!bar || !t || !t.deadline) return;
    const left = Math.max(0, t.deadline - Date.now());
    bar.style.width = `${(left / 30000) * 100}%`;
  }

  // ---------- Innkjøp ----------
  function openBuyIn(seat) {
    buyInSeat = seat;
    const max = Math.min(t.maxBuyIn, me.flus);
    if (max < t.minBuyIn) return msg(`Du trenger minst ${t.minBuyIn} flus for å sette deg. Du har ${me.flus}.`, 'lose');
    const r = $('pk-buyin-range');
    r.min = t.minBuyIn;
    r.max = max;
    r.value = Math.min(Math.max(200, t.minBuyIn), max);
    $('pk-buyin-amount').textContent = r.value;
    $('pk-buyin-seat').textContent = seat + 1;
    $('pk-buyin').classList.remove('hidden');
  }

  $('pk-buyin-range').addEventListener('input', () => ($('pk-buyin-amount').textContent = $('pk-buyin-range').value));
  $('pk-buyin-cancel').addEventListener('click', () => $('pk-buyin').classList.add('hidden'));
  $('pk-buyin-ok').addEventListener('click', () => send('/api/poker/sit', { seat: buyInSeat, buyIn: Number($('pk-buyin-range').value) }, () => $('pk-buyin').classList.add('hidden')));
  $('pk-leave').addEventListener('click', () => {
    if (confirm('Reise deg fra bordet? Sjetongene går tilbake som flus. Er du med i en hånd, kaster du den.')) send('/api/poker/leave', {});
  });

  // ---------- Handlinger ----------
  $('pk-fold').addEventListener('click', () => send('/api/poker/action', { action: 'fold' }));
  $('pk-call').addEventListener('click', () => send('/api/poker/action', { action: t.legal && t.legal.canCheck ? 'check' : 'call' }));
  $('pk-raise-range').addEventListener('input', () => ($('pk-raise-to').textContent = $('pk-raise-range').value));
  $('pk-raise').addEventListener('click', () => send('/api/poker/action', { action: 'raise', amount: Number($('pk-raise-range').value) }));
  $('pk-allin').addEventListener('click', () => {
    if (confirm('All in?')) send('/api/poker/action', { action: 'allin' });
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
