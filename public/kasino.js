'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  let data = null;
  let bet = 10;
  let betType = 'red';
  let busy = false;
  let rotation = 0;

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {});
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
    return json;
  }

  const flusWord = (n) => `${Math.abs(n)} flus`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setWallet(me) {
    data.me = me;
    $('my-spins').textContent = me.spinsLeft;
    $('my-flus').textContent = me.flus;
    $('my-beers').textContent = me.beersOwed;
    document.querySelectorAll('.spin-price').forEach((el) => (el.textContent = data.spinPrice));
    $('slot-pull').disabled = busy || me.spinsLeft < 1;
    $('slot-pull-flus').disabled = busy || me.flus < data.spinPrice;
    renderChips();
  }

  // ---------- Innsats (flus) ----------
  const CHIPS = [10, 25, 50, 100, 200];

  function renderChips() {
    const wrap = $('bet-chips');
    wrap.innerHTML = '';
    const flus = data.me ? data.me.flus : 0;
    const chips = CHIPS.filter((c) => c >= data.minBet && c <= data.maxBet);
    if (!chips.includes(bet)) bet = chips[0];
    chips.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (c === bet ? ' active' : '');
      b.textContent = c;
      b.disabled = c > flus;
      b.addEventListener('click', () => {
        bet = c;
        renderChips();
      });
      wrap.appendChild(b);
    });
    $('bet').textContent = bet;
  }

  // ---------- Automat ----------
  const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '7️⃣', '💎', '🍺'];
  const SYMBOL_H = 84;
  const strips = [...document.querySelectorAll('.reel .strip')];

  function setReel(strip, symbols) {
    strip.innerHTML = '';
    symbols.forEach((s) => {
      const d = document.createElement('div');
      d.className = 'symbol';
      d.textContent = s;
      strip.appendChild(d);
    });
  }

  function initReels() {
    strips.forEach((st) => setReel(st, [SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]]));
  }

  // Ruller hvert hjul gjennom tilfeldige symboler og stopper på resultatet, ett etter ett
  function spinReels(result) {
    return Promise.all(strips.map((st, i) => {
      const filler = Array.from({ length: 18 + i * 6 }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
      const current = st.lastElementChild ? st.lastElementChild.textContent : SYMBOLS[0];
      setReel(st, [current, ...filler, result[i]]);
      st.style.transition = 'none';
      st.style.transform = 'translateY(0)';
      void st.offsetHeight; // tving omtegning før animasjonen starter
      const dur = 1.2 + i * 0.5;
      st.style.transition = `transform ${dur}s cubic-bezier(0.12, 0.7, 0.2, 1)`;
      st.style.transform = `translateY(-${(filler.length + 1) * SYMBOL_H}px)`;
      return sleep(dur * 1000 + 50);
    })).then(() => strips.forEach((st, i) => {
      st.style.transition = 'none';
      st.style.transform = 'translateY(0)';
      setReel(st, [result[i]]);
    }));
  }

  async function pullSlot(pay) {
    if (busy) return;
    busy = true;
    $('slot-pull').disabled = true;
    $('slot-pull-flus').disabled = true;
    $('slot-result').textContent = '';
    $('slot-result').className = 'result';
    document.querySelector('.slot-machine').classList.remove('jackpot');
    try {
      const r = await api('/api/casino/slot', { pay });
      await spinReels(r.reels);
      setWallet(r.me);
      if (r.beer) {
        $('slot-result').textContent = '🍺🍺🍺 TRE PILS PÅ RAD! Du har vunnet en pils! Hent den i baren 🍻';
        $('slot-result').classList.add('win');
        document.querySelector('.slot-machine').classList.add('jackpot');
        if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
      } else if (r.flus) {
        $('slot-result').textContent = `🎉 Du vant ${flusWord(r.flus)}!`;
        $('slot-result').classList.add('win');
      } else {
        $('slot-result').textContent = 'Ingen gevinst denne gangen.';
        $('slot-result').classList.add('lose');
      }
    } catch (err) {
      $('slot-result').textContent = err.message;
      $('slot-result').classList.add('lose');
    }
    busy = false;
    if (data.me) setWallet(data.me);
    loadLog();
  }

  $('slot-pull').addEventListener('click', () => pullSlot('spin'));
  $('slot-pull-flus').addEventListener('click', () => pullSlot('flus'));

  function renderPaytable(table) {
    const ul = $('paytable');
    ul.innerHTML = '';
    table.forEach((o) => {
      const li = document.createElement('li');
      const sym = o.id === 'cherry2' ? '🍒🍒 (to kirsebær)' : o.symbol.repeat(3);
      li.innerHTML = '<span class="pt-sym"></span><span class="pt-win"></span>';
      li.querySelector('.pt-sym').textContent = sym;
      li.querySelector('.pt-win').textContent = o.beer ? '1 pils 🍺' : `${o.flus} flus`;
      ul.appendChild(li);
    });
  }

  // ---------- Roulette ----------
  const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const colorOf = (n) => (n === 0 ? '#1f9d55' : RED.has(n) ? '#c0392b' : '#1b1e2e');

  function drawRoulette() {
    const canvas = $('roulette');
    const ctx = canvas.getContext('2d');
    const r = canvas.width / 2;
    const seg = (Math.PI * 2) / ORDER.length;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ORDER.forEach((n, i) => {
      const start = -Math.PI / 2 + i * seg - seg / 2;
      ctx.beginPath();
      ctx.moveTo(r, r);
      ctx.arc(r, r, r - 6, start, start + seg);
      ctx.closePath();
      ctx.fillStyle = colorOf(n);
      ctx.fill();
      ctx.strokeStyle = '#c9a227';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.translate(r, r);
      ctx.rotate(start + seg / 2 + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(n), 0, -r + 40);
      ctx.restore();
    });
    ctx.beginPath();
    ctx.arc(r, r, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#5a3d1a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r, r, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#c9a227';
    ctx.fill();
  }

  function spinTo(number) {
    const segDeg = 360 / ORDER.length;
    const idx = ORDER.indexOf(number);
    const jitter = (Math.random() - 0.5) * segDeg * 0.6;
    const wanted = (360 - idx * segDeg + jitter + 360) % 360;
    const current = ((rotation % 360) + 360) % 360;
    rotation += 360 * 5 + ((wanted - current + 360) % 360);
    $('roulette').style.transform = `rotate(${rotation}deg)`;
    return sleep(5200);
  }

  $('bet-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.bet-opt');
    if (!b) return;
    betType = b.dataset.type;
    document.querySelectorAll('.bet-opt').forEach((x) => x.classList.toggle('selected', x === b));
    $('bet-number').classList.toggle('hidden', betType !== 'number');
  });

  $('roulette-spin').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    $('roulette-spin').disabled = true;
    $('roulette-result').textContent = '';
    $('roulette-result').className = 'result';
    try {
      const r = await api('/api/casino/roulette', { type: betType, number: Number($('bet-number').value), amount: bet });
      await spinTo(r.number);
      setWallet(r.me);
      const colorName = r.color === 'green' ? 'grønn' : r.color === 'red' ? 'rød' : 'svart';
      $('roulette-result').textContent = r.won
        ? `🎉 ${r.number} ${colorName}! Du vant ${flusWord(r.net)}!`
        : `${r.number} ${colorName}. Du tapte ${flusWord(r.net)} 😢`;
      $('roulette-result').classList.add(r.won ? 'win' : 'lose');
    } catch (err) {
      $('roulette-result').textContent = err.message;
      $('roulette-result').classList.add('lose');
    }
    busy = false;
    $('roulette-spin').disabled = false;
    loadLog();
  });

  // ---------- Blackjack ----------
  function cardEl(c, delay) {
    const d = document.createElement('div');
    if (c.hidden) {
      d.className = 'playing-card back';
    } else {
      d.className = 'playing-card' + (c.s === '♥' || c.s === '♦' ? ' red' : '');
      d.innerHTML = '<span class="pc-corner"></span><span class="pc-suit"></span>';
      d.querySelector('.pc-corner').textContent = `${c.r}${c.s}`;
      d.querySelector('.pc-suit').textContent = c.s;
    }
    if (delay) d.style.animationDelay = `${delay}ms`;
    return d;
  }

  const RESULT_TEXT = {
    blackjack: (n) => [`🃏 BLACKJACK! Du vant ${flusWord(n)}!`, 'win'],
    win: (n) => [`🎉 Du vant ${flusWord(n)}!`, 'win'],
    'dealer-bust': (n) => [`💥 Dealer gikk over 21! Du vant ${flusWord(n)}!`, 'win'],
    push: () => ['🤝 Uavgjort. Du får innsatsen tilbake.', ''],
    lose: (n) => [`Dealer vant. Du tapte ${flusWord(n)} 😢`, 'lose'],
    bust: (n) => [`💥 Over 21! Du tapte ${flusWord(n)} 😢`, 'lose'],
    'dealer-blackjack': (n) => [`Dealer fikk blackjack. Du tapte ${flusWord(n)} 😢`, 'lose'],
  };

  let shownCards = { dealer: 0, player: 0 };

  function renderBlackjack(h, animate) {
    const playing = h && h.status === 'playing';
    $('bj-deal').classList.toggle('hidden', playing);
    $('bj-hit').classList.toggle('hidden', !playing);
    $('bj-stand').classList.toggle('hidden', !playing);
    $('bj-double').classList.toggle('hidden', !playing || !h.canDouble);
    $('bj-deal').textContent = h ? 'Ny runde 🃏' : 'Del ut 🃏';
    if (!h) {
      $('dealer-cards').innerHTML = '';
      $('player-cards').innerHTML = '';
      $('dealer-value').textContent = '';
      $('player-value').textContent = '';
      return;
    }
    // Animer bare kortene som er nye siden sist
    ['dealer', 'player'].forEach((who) => {
      const wrap = $(`${who}-cards`);
      wrap.innerHTML = '';
      h[who].forEach((c, i) => {
        const isNew = animate && (i >= shownCards[who] || (who === 'dealer' && i === 1 && !c.hidden));
        const el = cardEl(c, isNew ? (i - Math.min(i, shownCards[who])) * 180 : 0);
        if (isNew) el.classList.add('deal');
        wrap.appendChild(el);
      });
      shownCards[who] = h[who].filter((c) => !c.hidden).length;
    });
    $('dealer-value').textContent = h.dealerValue;
    $('player-value').textContent = h.playerValue;
    if (h.status === 'done') {
      const [text, cls] = RESULT_TEXT[h.result](h.net);
      $('bj-result').textContent = text;
      $('bj-result').className = `result ${cls}`;
    } else {
      $('bj-result').textContent = `Innsats: ${flusWord(h.bet)}`;
      $('bj-result').className = 'result';
    }
  }

  async function bjAction(path, body) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('.bj-actions button').forEach((b) => (b.disabled = true));
    try {
      if (path === '/api/casino/bj/deal') shownCards = { dealer: 0, player: 0 };
      const r = await api(path, body || {});
      setWallet(r.me);
      renderBlackjack(r.blackjack, true);
      if (r.blackjack.status === 'done') loadLog();
    } catch (err) {
      $('bj-result').textContent = err.message;
      $('bj-result').className = 'result lose';
    }
    busy = false;
    document.querySelectorAll('.bj-actions button').forEach((b) => (b.disabled = false));
  }

  $('bj-deal').addEventListener('click', () => bjAction('/api/casino/bj/deal', { amount: bet }));
  $('bj-hit').addEventListener('click', () => bjAction('/api/casino/bj/hit'));
  $('bj-stand').addEventListener('click', () => bjAction('/api/casino/bj/stand'));
  $('bj-double').addEventListener('click', () => bjAction('/api/casino/bj/double'));

  // ---------- Felles ----------
  const TAB_HASH = { slot: 'automat', roulette: 'roulette', blackjack: 'blackjack', bar: 'baren' };

  function showTab(name) {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
    Object.keys(TAB_HASH).forEach((t) => $(`tab-${t}`).classList.toggle('hidden', t !== name));
    $('bet-card').classList.toggle('hidden', name === 'slot' || name === 'bar');
    history.replaceState(null, '', `#${TAB_HASH[name]}`);
    // Baren har sin egen oversikt over flus og bestillinger: hent den på nytt
    if (name === 'bar' && window.refreshBar) window.refreshBar();
    // Oppdater lommeboken når man kommer tilbake fra baren (flus kan ha blitt brukt der)
    if (name !== 'bar') api('/api/casino').then((d) => d.me && setWallet(d.me)).catch(() => {});
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  function renderLog(log) {
    const ul = $('casino-log');
    ul.innerHTML = '';
    if (!log.length) ul.innerHTML = '<li class="muted">Ingen har spilt ennå.</li>';
    log.forEach((e) => {
      const li = document.createElement('li');
      const icon = { roulette: '🎡', blackjack: '🃏', slot: '🎰' }[e.game];
      let text;
      if (e.game === 'slot') {
        text = `${icon} ${e.name}: ${e.detail}`;
        li.className = 'won';
      } else {
        li.className = e.net > 0 ? 'won' : e.net < 0 ? 'lost' : '';
        const res = e.net > 0 ? `vant ${flusWord(e.net)}` : e.net < 0 ? `tapte ${flusWord(e.net)}` : 'gikk i null';
        text = `${icon} ${e.name} ${res}${e.game === 'roulette' ? ` (${e.detail})` : ''}`;
      }
      li.textContent = text;
      ul.appendChild(li);
    });
  }

  async function loadLog() {
    try {
      const d = await api('/api/casino');
      renderLog(d.log);
    } catch { /* ignorer */ }
  }

  async function init() {
    data = await api('/api/casino');
    $('not-joined').classList.toggle('hidden', !!data.me);
    $('casino').classList.toggle('hidden', !data.me);
    renderLog(data.log);
    if (!data.me) return;
    setWallet(data.me);
    renderPaytable(data.slotTable);
    initReels();
    drawRoulette();
    document.querySelector('.bet-opt[data-type="red"]').classList.add('selected');
    const fromHash = Object.keys(TAB_HASH).find((t) => `#${TAB_HASH[t]}` === location.hash);
    if (data.blackjack) {
      shownCards = { dealer: 9, player: 9 };
      renderBlackjack(data.blackjack, false);
    } else renderBlackjack(null);
    // Lenken bestemmer fanen (f.eks. #baren). Ellers: fortsett en uferdig blackjack-hånd.
    if (fromHash) showTab(fromHash);
    else if (data.blackjack && data.blackjack.status === 'playing') showTab('blackjack');
  }

  init();
  setInterval(() => !busy && loadLog(), 10000);
})();
